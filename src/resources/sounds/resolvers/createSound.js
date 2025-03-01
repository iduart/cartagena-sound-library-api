const ytdl = require("ytdl-core");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const stream = require("stream");
const ffmpeg = require("fluent-ffmpeg");
const sharp = require("sharp");
const request = require("request");
const moment = require("moment");
const SoundModel = require("../sound.model");

const {
  TEMP_BUCKET,
  SOUNDS_BUCKET,
  THUMBNAILS_BUCKET,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
} = process.env;

const COOKIE_HEADER = `HSID=Ap6Y8t1BYw1qlkxuw; SSID=ALiHGNCVWenymm8-p; APISID=vwEfBRHu9RUXqsvZ/AB7VUOTVaFEFEM5ph; SAPISID=0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5; __Secure-1PAPISID=0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5; __Secure-3PAPISID=0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5; LOGIN_INFO=AFmmF2swRQIgFnrbbJjXxC9cAvZuh1Yv1svtZfJvilXExEw4P7ZjursCIQCVMWoVrzZnlKaLJUsObLOUQ0S_sRaUUpFpEVJouvXCww:QUQ3MjNmd2haQ1Z5S1cxMHZNaC11SGMxVmhTN1pYb19NQUVTbkN6U1lwTU5qNnNpQ3J4anMyRElURmxULXRSZTB3QUI1T2MyLUk1SWxUc0lLbTBHRlJTRDBoUExzcTY2NDhtWVNzSm9RcGtqZkVhUnRqajNGOVdmR2Q2VlVkb1FwLVpaUDRJT2NNYVhvbWtlSElQNWpRaHRKVUdjalVyYm5R; VISITOR_INFO1_LIVE=5U3l_NENuA4; VISITOR_PRIVACY_METADATA=CgJDTxIEGgAgOA%3D%3D; SID=g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlwv-aXwOoD-aG30LQxLX67HAACgYKAVQSARASFQHGX2MiwpZERt6yi26gyGXEvcRLHRoVAUF8yKoMbGa2q8mTFdhe5kOQJzZ30076; __Secure-1PSID=g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlw5nuxwhVDtFHacutpthi6mwACgYKAWYSARASFQHGX2MiT0H_FYjDcNm9B7QGtIMDeRoVAUF8yKpQWHLVNQfcqp7XDds4PljC0076; __Secure-3PSID=g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlwCoZhD8dbYW041T-a0UPtTwACgYKARYSARASFQHGX2MizafdLWISOo72kYRR5U5fEBoVAUF8yKqpTdnEdQmHyZ83HvEvcQWS0076; YSC=AJfDKLrBOTY; PREF=f6=40000080&f7=100&tz=America.Bogota&f4=4000000; __Secure-ROLLOUT_TOKEN=CNW6h83Kn5W81wEQ9OOXktbrigMYlrn7wYToiwM%3D; __Secure-1PSIDTS=sidts-CjEBEJ3XV4VdFbtt0cMPphKv82ZPULDG6GLtgyLxNR6ikAWTl6-4EVg03UAPZGbN-0HBEAA; __Secure-3PSIDTS=sidts-CjEBEJ3XV4VdFbtt0cMPphKv82ZPULDG6GLtgyLxNR6ikAWTl6-4EVg03UAPZGbN-0HBEAA; ST-sbra4i=session_logininfo=AFmmF2swRQIhAJg2sbtTXnnrDoIt4FdBoYgHugo9OltqndgEK5fRavU8AiAd2ovL4d33EVPRGandIOfjE-lndI80tg76gTNT9zqQqQ%3AQUQ3MjNmd0dGZVRqRGotSmNrOEstVzB4Y2NBTG1yVnEyeHFCaUZpQU5tZmc3UUI3ZTY1bEZzY19kYkZXVV9xblM5SXVlQ2kzeGVxRHE3UHM2T3VZTGhQSElEUGhYX1UxVDQ1eUktMTBaWXg4eXF2eTRPal9sUmFRS0pUejBhUm4zdHYzMjdJQnA0VDQ2dW9vS3IxWEdIbmExUnA2NUItRUF3; ST-183jmdn=session_logininfo=AFmmF2swRQIgFnrbbJjXxC9cAvZuh1Yv1svtZfJvilXExEw4P7ZjursCIQCVMWoVrzZnlKaLJUsObLOUQ0S_sRaUUpFpEVJouvXCww%3AQUQ3MjNmd2haQ1Z5S1cxMHZNaC11SGMxVmhTN1pYb19NQUVTbkN6U1lwTU5qNnNpQ3J4anMyRElURmxULXRSZTB3QUI1T2MyLUk1SWxUc0lLbTBHRlJTRDBoUExzcTY2NDhtWVNzSm9RcGtqZkVhUnRqajNGOVdmR2Q2VlVkb1FwLVpaUDRJT2NNYVhvbWtlSElQNWpRaHRKVUdjalVyYm5R; SIDCC=AKEyXzXFEYgdzL2n1zaRsqDXXA7Rz9AcAbeLbl6eN7M3ZNrYWoSuw55vQlaj8fFTzV6-IJ4upQ; __Secure-1PSIDCC=AKEyXzW7s_LAjkhh-hnKVF-ezgfJ3zHM-vZgtSTsWAebhG27TBkWRO7zhksM88TvWdyCFjBvfA; __Secure-3PSIDCC=AKEyXzUROJUx5xppFapbgt28NG-o1W3KC7BSEknGwet_rL4h8RQ4UyVduKxaT6PH7wn8Jl_hpI8; ST-1b=disableCache=true&itct=CBYQsV4iEwiH1KPo7umLAxXg65QJHV-0GvY%3D&csn=5TOuPIhoUbtd_WVw&session_logininfo=AFmmF2swRQIgFnrbbJjXxC9cAvZuh1Yv1svtZfJvilXExEw4P7ZjursCIQCVMWoVrzZnlKaLJUsObLOUQ0S_sRaUUpFpEVJouvXCww%3AQUQ3MjNmd2haQ1Z5S1cxMHZNaC11SGMxVmhTN1pYb19NQUVTbkN6U1lwTU5qNnNpQ3J4anMyRElURmxULXRSZTB3QUI1T2MyLUk1SWxUc0lLbTBHRlJTRDBoUExzcTY2NDhtWVNzSm9RcGtqZkVhUnRqajNGOVdmR2Q2VlVkb1FwLVpaUDRJT2NNYVhvbWtlSElQNWpRaHRKVUdjalVyYm5R&endpoint=%7B%22clickTrackingParams%22%3A%22CBYQsV4iEwiH1KPo7umLAxXg65QJHV-0GvY%3D%22%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2F%22%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_BROWSE%22%2C%22rootVe%22%3A3854%2C%22apiUrl%22%3A%22%2Fyoutubei%2Fv1%2Fbrowse%22%7D%7D%2C%22browseEndpoint%22%3A%7B%22browseId%22%3A%22FEwhat_to_watch%22%7D%7D; ST-yve142=session_logininfo=AFmmF2swRQIgFnrbbJjXxC9cAvZuh1Yv1svtZfJvilXExEw4P7ZjursCIQCVMWoVrzZnlKaLJUsObLOUQ0S_sRaUUpFpEVJouvXCww%3AQUQ3MjNmd2haQ1Z5S1cxMHZNaC11SGMxVmhTN1pYb19NQUVTbkN6U1lwTU5qNnNpQ3J4anMyRElURmxULXRSZTB3QUI1T2MyLUk1SWxUc0lLbTBHRlJTRDBoUExzcTY2NDhtWVNzSm9RcGtqZkVhUnRqajNGOVdmR2Q2VlVkb1FwLVpaUDRJT2NNYVhvbWtlSElQNWpRaHRKVUdjalVyYm5R`;

const s3Client = new S3Client({
  region: "us-east-2",
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

// Helper function to parse the cookie header into an array of {name, value} objects
function parseCookieHeader(cookieHeader) {
  return cookieHeader.split(";").map((cookieStr) => {
    const [name, ...rest] = cookieStr.trim().split("=");
    const value = rest.join("=");
    return { name, value };
  });
}

const getDuration = (from, to) => {
  const TIME_FORMAT = "hh:mm:ss.SS";
  const fromTime = moment(from, TIME_FORMAT);
  const toTime = moment(to, TIME_FORMAT);
  const diff = toTime.diff(fromTime);
  const duration = moment.duration(diff);
  return duration.asSeconds();
};

const cookiesArray = parseCookieHeader(COOKIE_HEADER);

// Create an agent using the new cookie format
const agent = ytdl.createAgent(cookiesArray);

const getVideoInfo = async (url) => {
  try {
    // Use getInfo with the agent option to authenticate using your cookies
    const info = await ytdl.getInfo(url, { agent });
    console.log("title:", info.videoDetails.title);
    console.log("rating:", info.player_response.videoDetails.averageRating);
    console.log("uploaded by:", info.videoDetails.author.name);
    return info;
  } catch (err) {
    console.error("Error fetching video info:", err);
  }
};

async function uploadToS3(stream, filename, bucket) {
  const parallelUploads3 = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: filename,
      Body: stream,
      ACL: "public-read",
    },
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
  audioUrl,
  from = "00:00:00",
  duration = 7,
  filename,
  isPreview
) => {
  if (!audioUrl || !filename) {
    throw new Error("Missing videoUrl or filename");
  }

  try {
    // Create a PassThrough stream to pipe ffmpeg output into.
    const passThrough = new stream.PassThrough();

    ffmpeg(audioUrl)
      .setStartTime(from)
      .setDuration(duration)
      .format("mp3")
      .audioCodec("libmp3lame")
      .on("end", () => {
        console.log("Segment extracted successfully.");
      })
      .on("error", (err) => {
        console.error("Error processing audio segment:", err);
        passThrough.destroy(err);
      })
      .writeToStream(passThrough, { end: true });

    const bucket = isPreview ? TEMP_BUCKET : SOUNDS_BUCKET;
    return await uploadToS3(passThrough, filename, bucket);
  } catch (error) {
    console.log("error", error);
  }
};

async function createSound(_, { input }) {
  try {
    const { url, from, to, name, author, deviceId, isPreview } = input;
    let newSound = {};

    const duration = getDuration(from, to);
    if (!duration || duration > 100 || duration < 0) {
      throw Error(`Invalid Duration ${duration}`);
    }

    if (!isPreview) {
      newSound = new SoundModel({
        name,
        author,
        tags: [],
      });
    }

    const videoInfo = await getVideoInfo(url);
    return;

    const thumbnailUrl = videoInfo.videoDetails.thumbnails[0].url;

    const soundFilename = newSound._id
      ? `${newSound._id}.mp3`
      : `${deviceId}.mp3`;

    const thumbnailFilename = newSound._id
      ? `${newSound._id}.png`
      : `${deviceId}.png`;

    const audioFormat = videoInfo.formats.find((f) => f.itag === 140);
    if (!audioFormat) {
      throw new Error("Audio-only format (itag 140) not found.");
    }
    const audioUrl = audioFormat.url;

    const soundFileData = await processAudio(
      audioUrl,
      from,
      duration,
      soundFilename,
      isPreview
    );

    const thumbnailFileData = await processThumbnail(
      thumbnailUrl,
      thumbnailFilename,
      isPreview
    );

    if (newSound._id) {
      newSound.sound = soundFileData.Location;
      newSound.thumbnail = thumbnailFileData.Location;
      newSound.save();
    }

    return {
      _id: newSound._id || deviceId,
      name,
      sound: soundFileData.Location,
      author,
      tags: [],
      thumbnail: thumbnailFileData.Location,
    };
  } catch (error) {
    console.log("error", error);
  }
}

module.exports = createSound;
