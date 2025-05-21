const fs = require("fs");
const ytdl = require("@distube/ytdl-core");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const stream = require("stream");
const ffmpeg = require("fluent-ffmpeg");
const sharp = require("sharp");
const request = require("request");
const moment = require("moment");
const youtubedl = require("youtube-dl-exec");
const SoundModel = require("../sound.model");

const {
  TEMP_BUCKET,
  SOUNDS_BUCKET,
  THUMBNAILS_BUCKET,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
} = process.env;

const s3Client = new S3Client({
  region: "us-east-2",
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const getDuration = (from, to) => {
  const TIME_FORMAT = "hh:mm:ss.SS";
  const fromTime = moment(from, TIME_FORMAT);
  const toTime = moment(to, TIME_FORMAT);
  const diff = toTime.diff(fromTime);
  const duration = moment.duration(diff);
  return duration.asSeconds();
};

// const getVideoInfo = (url) => {
//   return new Promise((resolve, reject) => {
//     youtubedl.getInfo(url, (err, info) => {
//       if (err) {
//         reject(err);
//       }
//       resolve(info);
//     });
//   });
// };

const getVideoInfo = async (url) => {
  try {
    return youtubedl(
      "https://www.tiktok.com/@lmp_edit7/video/7495325207717072150",
      {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
      }
    );
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
  isPreview,
  videoUrl,
  headers,
  cookies
) => {
  if (!audioUrl || !filename) {
    throw new Error("Missing videoUrl or filename");
  }

  try {
    const ffmpegHeaders = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .concat([`Cookie: ${cookies}`])
      .join("\r\n");

    // Create a PassThrough stream to pipe ffmpeg output into.
    const passThrough = new stream.PassThrough();

    ffmpeg(videoUrl)
      .inputOptions(["-headers", ffmpegHeaders])
      .setStartTime(from)
      .setDuration(duration)
      .format("mp3")
      .audioCodec("libmp3lame")
      .on("start", (cmd) => console.log("FFmpeg started with:", cmd))
      .on("error", (err) => {
        console.error("Error processing audio segment:", err.message);
        passThrough.destroy(err);
      })
      .on("end", () => {
        console.log("Audio segment successfully processed.");
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

    const videoInfo = await getVideoInfo(
      "https://www.tiktok.com/@lmp_edit7/video/7495325207717072150"
    );

    console.log("videoInfo", videoInfo);

    const thumbnailUrl = videoInfo.thumbnail;

    const soundFilename = newSound._id
      ? `${newSound._id}.mp3`
      : `${deviceId}.mp3`;

    const thumbnailFilename = newSound._id
      ? `${newSound._id}.png`
      : `${deviceId}.png`;

    const audioFormat = videoInfo.formats.find(
      (f) => f.acodec !== "none" && f.vcodec !== "none" && f.url
    );
    if (!audioFormat) {
      throw new Error("Audio-only format (itag 140) not found.");
    }
    const audioUrl = audioFormat.url;

    const download = videoInfo.requested_downloads?.[0];
    if (!download?.url) {
      throw new Error("No downloadable URL found in requested_downloads.");
    }

    const videoUrl = download.url;
    const headers = download.http_headers || {};
    const cookies = download.cookies || "";

    const soundFileData = await processAudio(
      audioUrl,
      from,
      duration,
      soundFilename,
      isPreview,
      videoUrl,
      headers,
      cookies
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
