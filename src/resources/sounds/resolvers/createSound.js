const fs = require("fs");
const os = require("os");
const path = require("path");
const youtubedl = require("youtube-dl-exec");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const stream = require("stream");
const ffmpeg = require("fluent-ffmpeg");
const sharp = require("sharp");
const request = require("request");
const moment = require("moment");
const SoundModel = require("../sound.model");
const { acquireExtractionSlot } = require("../../../rateLimit");

const {
  TEMP_BUCKET,
  SOUNDS_BUCKET,
  THUMBNAILS_BUCKET,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  S3_USE_ACL,
  YT_COOKIES_FILE,
  YT_PROXY,
  YT_PLAYER_CLIENTS,
} = process.env;

// On EC2 the instance role supplies credentials through the SDK's default
// provider chain, so only pass explicit keys when they are actually set --
// handing the client `undefined` credentials makes every request fail.
const s3Client = new S3Client({
  region: AWS_REGION || "us-east-2",
  ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

// YouTube rotates session cookies (__Secure-1PSIDTS in particular) on every
// few requests, and yt-dlp writes the rotated jar back to whatever file it was
// given. If that file is read-only -- baked into an image, mounted from a
// config store -- the rotation is lost, YouTube sees a stale session and kills
// it within minutes. So work from a writable copy.
let runtimeCookiesPath = null;
const writableCookiesFile = () => {
  if (!YT_COOKIES_FILE) return null;
  if (runtimeCookiesPath) return runtimeCookiesPath;

  if (!fs.existsSync(YT_COOKIES_FILE)) {
    console.warn(`YT_COOKIES_FILE set but not found: ${YT_COOKIES_FILE}`);
    return null;
  }

  try {
    const target = path.join(os.tmpdir(), "yt-cookies-runtime.txt");
    fs.copyFileSync(YT_COOKIES_FILE, target);
    runtimeCookiesPath = target;
    console.log(`Using writable cookie jar at ${target} so rotations persist`);
  } catch (err) {
    console.warn(
      `Could not create a writable cookie copy (${err.message}); using ` +
        "the original, which may expire quickly if it is read-only"
    );
    runtimeCookiesPath = YT_COOKIES_FILE;
  }

  return runtimeCookiesPath;
};

// Player clients are tried in order. A single client can start getting refused
// part-way through the day, so never depend on just one.
//
// Order matters and was measured from EC2, not guessed: "default" and
// "android_vr" both yield itag 140 URLs that googlevideo serves, while "tv"
// (TVHTML5) yields URLs that come back 403 from this host every time. It stays
// in the list as a last resort in case the others break, but it must not be
// the first thing a retry reaches for.
const DEFAULT_PLAYER_CLIENTS = ["default", "android_vr", "tv"];

const playerClients = () =>
  YT_PLAYER_CLIENTS
    ? YT_PLAYER_CLIENTS.split(",").map((c) => c.trim()).filter(Boolean)
    : DEFAULT_PLAYER_CLIENTS;

// Errors worth trying another client or another attempt for, as opposed to
// "this video does not exist", which will never succeed.
const isTransient = (details) =>
  /sign in to confirm|not a bot|429|too many requests|rate.?limit|temporarily|timed out|timeout|connection|failed to extract|unable to download|requested format is not available|no supported javascript/i.test(
    details
  );

const isBotBlock = (details) =>
  /sign in to confirm|not a bot|login required|age-restricted/i.test(details);

// No client or retry will rescue these, so fail fast instead of burning through
// the whole ladder.
const isPermanent = (details) =>
  /video unavailable|private video|removed by the uploader|does not exist|is not a valid url|unsupported url|members-only/i.test(
    details
  );

// YouTube treats requests from datacenter ranges (EC2) far more harshly than
// residential ones, so everything that helps get past that is configurable
// per-environment instead of hardcoded: a cookies file exported from a logged
// in browser, an outbound proxy, and the player clients yt-dlp impersonates.
const ytdlpOptions = (playerClient, proxy) => {
  const options = {
    dumpSingleJson: true,
    noWarnings: true,
    noPlaylist: true,
    retries: 3,
    socketTimeout: 30,
    extractorArgs: `youtube:player_client=${playerClient}`,
  };

  const cookies = writableCookiesFile();
  if (cookies) {
    options.cookies = cookies;
  }

  if (proxy) {
    options.proxy = proxy;
  }

  return options;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// googlevideo binds every media URL to the IP that resolved it, so the metadata
// call and the ffmpeg download must leave through the SAME address. A rotating
// residential proxy changes IP between those two calls, which yields a 403 on
// the download even though extraction succeeded.
//
// The fix is a sticky session: providers encode it as a suffix on the proxy
// password. IPRoyal uses `_session-<id>_lifetime-<n>m`; override the template
// for a provider with different syntax, or set it empty to disable stickiness.
const SESSION_SUFFIX_TEMPLATE =
  process.env.YT_PROXY_SESSION_SUFFIX === undefined
    ? "_session-{session}_lifetime-10m"
    : process.env.YT_PROXY_SESSION_SUFFIX;

const newSessionId = () =>
  `csl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Injects the session suffix into the password component of the proxy URL.
const proxyForSession = (sessionId) => {
  if (!YT_PROXY) return null;
  if (!SESSION_SUFFIX_TEMPLATE) return YT_PROXY;

  const suffix = SESSION_SUFFIX_TEMPLATE.replace("{session}", sessionId);

  try {
    const parsed = new URL(YT_PROXY);
    if (!parsed.password) return YT_PROXY; // nothing to attach the session to
    parsed.password = `${parsed.password}${suffix}`;
    return parsed.toString();
  } catch (err) {
    console.warn(`YT_PROXY is not a valid URL, using it unmodified: ${err.message}`);
    return YT_PROXY;
  }
};

// S3 rejections surface through the same promise as streaming errors, but a
// fresh YouTube URL cannot fix a credentials or bucket problem.
const isS3Failure = (err) =>
  Boolean(
    (err && err.$metadata) ||
      /AccessKey|credential|SignatureDoesNotMatch|NoSuchBucket|AccessDenied|ExpiredToken/i.test(
        (err && (err.name || err.message)) || ""
      )
  );

const getDuration = (from, to) => {
  const TIME_FORMAT = "hh:mm:ss.SS";
  const fromTime = moment(from, TIME_FORMAT);
  const toTime = moment(to, TIME_FORMAT);
  const diff = toTime.diff(fromTime);
  const duration = moment.duration(diff);
  return duration.asSeconds();
};

// Walks the client list, and gives each client a second attempt after a short
// backoff. This is what keeps extraction working hours into a deploy rather
// than only for the first few requests.
const getVideoInfo = async (url, { exclude = [], proxy = null } = {}) => {
  const all = playerClients();
  // When a stream URL is refused we retry, and repeating the client that just
  // handed us a dead URL is the least useful thing to do.
  const remaining = all.filter((c) => !exclude.includes(c));
  const clients = remaining.length ? remaining : all;
  const attemptsPerClient = 2;
  let lastDetails = "no attempt was made";
  let sawBotBlock = false;

  for (const client of clients) {
    for (let attempt = 1; attempt <= attemptsPerClient; attempt += 1) {
      try {
        const info = await youtubedl(url, ytdlpOptions(client, proxy));

        // A response with no usable audio stream means this client was served a
        // degraded payload; treat it like a failure so the next one is tried.
        if (!hasUsableAudio(info)) {
          throw new Error(`client "${client}" returned no playable audio format`);
        }

        if (client !== clients[0] || attempt > 1) {
          console.log(`Extraction recovered using client "${client}" (attempt ${attempt})`);
        }
        // Recorded so a stream-level retry can pick a different client.
        info.__playerClient = client;
        return info;
      } catch (err) {
        lastDetails = err.stderr || err.message || String(err);

        if (isPermanent(lastDetails)) {
          throw new Error(`yt-dlp cannot read this video: ${lastDetails}`);
        }

        sawBotBlock = sawBotBlock || isBotBlock(lastDetails);
        console.warn(
          `yt-dlp client "${client}" attempt ${attempt} failed: ${lastDetails.slice(0, 300)}`
        );

        if (!isTransient(lastDetails)) break; // permanent, move on
        if (attempt < attemptsPerClient) await sleep(1500 * attempt);
      }
    }
  }

  // The failure that only shows up on EC2. Say so explicitly rather than
  // letting it surface as a generic extraction error.
  if (sawBotBlock) {
    throw new Error(
      "YouTube refused the request as an unauthenticated bot on every player " +
        `client (${clients.join(", ")}). This host's IP is likely flagged, which is ` +
        "common on EC2. Set YT_COOKIES_FILE to a cookies.txt exported from a " +
        `logged-in browser, or route through YT_PROXY. yt-dlp said: ${lastDetails}`
    );
  }

  throw new Error(
    `yt-dlp could not read the video after trying ${clients.join(", ")}: ${lastDetails}`
  );
};

// itag 140 (m4a, 128kbps) is the format this API has always used. Fall back to
// any other audio-only stream so a missing 140 does not fail the whole request.
// A format only counts if it carries a resolved `url`; when yt-dlp cannot solve
// the signature challenge it still lists formats, but without playable URLs.
const findAudioFormat = (videoInfo) => {
  const audioOnly = ((videoInfo && videoInfo.formats) || []).filter(
    (f) =>
      f.url &&
      f.acodec &&
      f.acodec !== "none" &&
      (!f.vcodec || f.vcodec === "none")
  );

  if (!audioOnly.length) return null;

  const byBitrate = (a, b) => (a.abr || 0) - (b.abr || 0);

  return (
    audioOnly.find((f) => String(f.format_id) === "140") ||
    audioOnly.filter((f) => f.ext === "m4a").sort(byBitrate).pop() ||
    audioOnly.sort(byBitrate).pop()
  );
};

const hasUsableAudio = (videoInfo) => Boolean(findAudioFormat(videoInfo));

const pickAudioFormat = (videoInfo) => {
  const format = findAudioFormat(videoInfo);
  if (!format) {
    throw new Error("No audio-only format available for this video.");
  }
  return format;
};

const pickThumbnailUrl = (videoInfo) => {
  const thumbnails = videoInfo.thumbnails || [];
  const url =
    videoInfo.thumbnail ||
    (thumbnails.length ? thumbnails[thumbnails.length - 1].url : null);

  if (!url) {
    throw new Error("No thumbnail available for this video.");
  }

  return url;
};

const CONTENT_TYPES = {
  ".mp3": "audio/mpeg",
  ".png": "image/png",
};

async function uploadToS3(stream, filename, bucket) {
  const params = {
    Bucket: bucket,
    Key: filename,
    Body: stream,
    // Without this S3 stores everything as application/octet-stream, which
    // stops browsers and the webview from playing the audio inline.
    ContentType:
      CONTENT_TYPES[path.extname(filename).toLowerCase()] ||
      "application/octet-stream",
  };

  // Buckets created since April 2023 default to "bucket owner enforced", which
  // disables ACLs entirely -- sending one fails with AccessControlListNotSupported.
  // Public read access comes from a bucket policy instead. Set S3_USE_ACL=true
  // only for an older bucket that still has ACLs turned on.
  if (S3_USE_ACL === "true") {
    params.ACL = "public-read";
  }

  const parallelUploads3 = new Upload({
    client: s3Client,
    params,
    partSize: 1024 * 1024 * 10, // 10 MB parts
  });
  return parallelUploads3.done();
}

const processThumbnail = (thumbnailUrl, thumbnailFilename, isPreview) =>
  new Promise((resolve, reject) => {
    if (!thumbnailUrl || !thumbnailFilename) {
      return reject(new Error("Missing thumbnailUrl or thumbnailFilename"));
    }

    const passThrough = new stream.PassThrough();
    const resizedImage = sharp().resize(74, 74).png();

    // Attach error listeners to catch stream errors
    resizedImage.on("error", (err) => {
      console.error("Sharp error:", err);
      reject(err);
    });
    passThrough.on("error", (err) => {
      console.error("PassThrough error:", err);
      reject(err);
    });

    request(thumbnailUrl)
      .on("error", reject)
      .pipe(resizedImage)
      .pipe(passThrough);

    const bucket = isPreview ? TEMP_BUCKET : THUMBNAILS_BUCKET;

    uploadToS3(passThrough, thumbnailFilename, bucket)
      .then(resolve)
      .catch(reject);
  });

const processAudio = async (
  audioFormat,
  from = "00:00:00",
  duration = 7,
  filename,
  isPreview,
  proxy = null
) => {
  if (!audioFormat || !audioFormat.url || !filename) {
    throw new Error("Missing audio format or filename");
  }

  // Create a PassThrough stream to pipe ffmpeg output into.
  const passThrough = new stream.PassThrough();

  // googlevideo rejects requests whose headers do not match the ones the URL
  // was issued for, so replay the headers yt-dlp used.
  const headerLines = Object.entries(audioFormat.http_headers || {})
    .map(([key, value]) => `${key}: ${value}\r\n`)
    .join("");

  // Count what ffmpeg actually produces. S3 will happily complete a multipart
  // upload of an empty stream, so a failed ffmpeg run otherwise looks like a
  // successful upload of a 0-byte file -- and the record gets saved pointing
  // at silence.
  let bytesWritten = 0;
  passThrough.on("data", (chunk) => {
    bytesWritten += chunk.length;
  });

  const command = ffmpeg(audioFormat.url);
  if (headerLines) {
    command.inputOptions(["-headers", headerLines]);
  }
  // Same exit IP as the metadata call, or googlevideo answers 403.
  if (proxy) {
    command.inputOptions(["-http_proxy", proxy]);
  }

  const ffmpegDone = new Promise((resolve, reject) => {
    command
      .on("start", (cmdline) => {
        // Credentials are redacted; the point is to confirm -http_proxy and -ss
        // actually reach ffmpeg.
        console.log(
          "ffmpeg:",
          cmdline.replace(/\/\/[^@\s]+@/g, "//***@").slice(0, 300)
        );
      })
      // seekInput places -ss BEFORE -i, so ffmpeg issues an HTTP range request
      // rather than downloading and discarding everything up to `from`. On a
      // 20-minute video that is the difference between ~150KB and ~20MB of
      // metered proxy traffic.
      .seekInput(from)
      .duration(duration)
      .format("mp3")
      .audioCodec("libmp3lame")
      .on("end", () => {
        console.log("Segment extracted successfully.");
        resolve();
      })
      .on("error", (err) => {
        console.error("Error processing audio segment:", err.message);
        passThrough.destroy(err);
        reject(err);
      });
  });

  const bucket = isPreview ? TEMP_BUCKET : SOUNDS_BUCKET;
  const upload = uploadToS3(passThrough, filename, bucket);
  // Claim the rejection now so destroying the stream cannot raise an unhandled
  // rejection while we are still waiting on ffmpeg.
  upload.catch(() => {});

  command.writeToStream(passThrough, { end: true });

  // S3 may have completed a 0-byte object before the failure surfaced; leaving
  // it behind would masquerade as a real sound at a real URL.
  const discardEmptyUpload = async () => {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: filename })
      );
    } catch (err) {
      console.warn(`Could not remove empty upload ${filename}: ${err.message}`);
    }
  };

  try {
    await ffmpegDone;
  } catch (err) {
    await upload.catch(() => {});
    await discardEmptyUpload();
    throw err;
  }

  const result = await upload;

  if (bytesWritten === 0) {
    await discardEmptyUpload();
    throw new Error(
      `ffmpeg produced no audio for ${filename}; refusing to keep an empty upload`
    );
  }

  return result;
};

async function createSound(_, { input }, context) {
  const { url, from, to, name, author, deviceId, isPreview } = input;

  const duration = getDuration(from, to);
  if (!duration || duration > 100 || duration < 0) {
    throw Error(`Invalid Duration ${duration}`);
  }

  // Claimed before any expensive work starts. Previews count too: they run the
  // same extraction and are the easier endpoint to abuse.
  const release = acquireExtractionSlot({
    deviceId,
    ip: context && context.clientIp,
  });

  try {
    return await runCreateSound(input, duration);
  } finally {
    release();
  }
}

async function runCreateSound(input, duration) {
  const { url, from, to, name, author, deviceId, isPreview } = input;
  let newSound = {};

  if (!isPreview) {
    newSound = new SoundModel({
      name,
      author,
      tags: [],
    });
  }

  // One sticky proxy session per request, shared by extraction and download so
  // both leave through the same IP.
  const session = newSessionId();
  const proxy = proxyForSession(session);

  let videoInfo = await getVideoInfo(url, { proxy });
  let audioFormat = pickAudioFormat(videoInfo);

  console.log(
    `Extracting "${videoInfo.title}" using format ${audioFormat.format_id} (${audioFormat.ext})`
  );

  const soundFilename = newSound._id ? `${newSound._id}.mp3` : `${deviceId}.mp3`;

  const thumbnailFilename = newSound._id
    ? `${newSound._id}.png`
    : `${deviceId}.png`;

  let soundFileData;
  try {
    soundFileData = await processAudio(
      audioFormat,
      from,
      duration,
      soundFilename,
      isPreview,
      proxy
    );
  } catch (err) {
    // An S3 problem will not be fixed by a fresh YouTube URL.
    if (isS3Failure(err)) throw err;

    // A stream URL that resolved a moment ago can still be refused by
    // googlevideo. Re-extract once with a fresh URL before giving up.
    console.warn(`Audio streaming failed, re-extracting once: ${err.message}`);
    // A fresh session too: if the exit IP itself is the problem, reusing it
    // would reproduce the same failure.
    const retryProxy = proxyForSession(newSessionId());
    videoInfo = await getVideoInfo(url, {
      exclude: [videoInfo.__playerClient],
      proxy: retryProxy,
    });
    audioFormat = pickAudioFormat(videoInfo);
    console.log(
      `Retrying with client "${videoInfo.__playerClient}" format ${audioFormat.format_id}`
    );
    soundFileData = await processAudio(
      audioFormat,
      from,
      duration,
      soundFilename,
      isPreview,
      retryProxy
    );
  }

  const thumbnailFileData = await processThumbnail(
    pickThumbnailUrl(videoInfo),
    thumbnailFilename,
    isPreview
  );

  if (newSound._id) {
    newSound.sound = soundFileData.Location;
    newSound.thumbnail = thumbnailFileData.Location;
    await newSound.save();
  }

  return {
    _id: newSound._id || deviceId,
    name,
    sound: soundFileData.Location,
    author,
    tags: [],
    thumbnail: thumbnailFileData.Location,
  };
}

module.exports = createSound;
