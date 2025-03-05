const fs = require("fs");
const ytdl = require("@distube/ytdl-core");
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

const s3Client = new S3Client({
  region: "us-east-2",
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const agent = ytdl.createAgent([
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245101,
    hostOnly: false,
    httpOnly: false,
    name: "__Secure-1PAPISID",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value: "0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5",
    id: 1,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245504,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-1PSID",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlw5nuxwhVDtFHacutpthi6mwACgYKAWYSARASFQHGX2MiT0H_FYjDcNm9B7QGtIMDeRoVAUF8yKpQWHLVNQfcqp7XDds4PljC0076",
    id: 2,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1772728801.384426,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-1PSIDCC",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "AKEyXzWIfrKmrN_RmUmhbDSCupq7fZ73HzDj4CtP-g7w4V5wrHykqH9ftA0HSdYURnVHzOcRRQ",
    id: 3,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1772728476.309419,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-1PSIDTS",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "sidts-CjEBEJ3XV9D5pNUcHUIRgCFYUOCdp8ndicVAHpivuTGqh7LxNElX6H31z7wXJIPjg8xUEAA",
    id: 4,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245134,
    hostOnly: false,
    httpOnly: false,
    name: "__Secure-3PAPISID",
    path: "/",
    sameSite: "no_restriction",
    secure: true,
    session: false,
    storeId: "0",
    value: "0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5",
    id: 5,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245534,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-3PSID",
    path: "/",
    sameSite: "no_restriction",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlwCoZhD8dbYW041T-a0UPtTwACgYKARYSARASFQHGX2MizafdLWISOo72kYRR5U5fEBoVAUF8yKqpTdnEdQmHyZ83HvEvcQWS0076",
    id: 6,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1772728801.384491,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-3PSIDCC",
    path: "/",
    sameSite: "no_restriction",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "AKEyXzUpt45HALMitfolAz46KCr5dvbjRYGMrphjuHFJiwfG30cIVRqq8B9I4vzK03iyg-thASI",
    id: 7,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1772728476.309764,
    hostOnly: false,
    httpOnly: true,
    name: "__Secure-3PSIDTS",
    path: "/",
    sameSite: "no_restriction",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "sidts-CjEBEJ3XV9D5pNUcHUIRgCFYUOCdp8ndicVAHpivuTGqh7LxNElX6H31z7wXJIPjg8xUEAA",
    id: 8,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245026,
    hostOnly: false,
    httpOnly: false,
    name: "APISID",
    path: "/",
    sameSite: "unspecified",
    secure: false,
    session: false,
    storeId: "0",
    value: "vwEfBRHu9RUXqsvZ/AB7VUOTVaFEFEM5ph",
    id: 9,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.244894,
    hostOnly: false,
    httpOnly: true,
    name: "HSID",
    path: "/",
    sameSite: "unspecified",
    secure: false,
    session: false,
    storeId: "0",
    value: "Ap6Y8t1BYw1qlkxuw",
    id: 10,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1742907046.245373,
    hostOnly: false,
    httpOnly: true,
    name: "LOGIN_INFO",
    path: "/",
    sameSite: "no_restriction",
    secure: true,
    session: false,
    storeId: "0",
    value:
      "AFmmF2swRQIgFnrbbJjXxC9cAvZuh1Yv1svtZfJvilXExEw4P7ZjursCIQCVMWoVrzZnlKaLJUsObLOUQ0S_sRaUUpFpEVJouvXCww:QUQ3MjNmd2haQ1Z5S1cxMHZNaC11SGMxVmhTN1pYb19NQUVTbkN6U1lwTU5qNnNpQ3J4anMyRElURmxULXRSZTB3QUI1T2MyLUk1SWxUc0lLbTBHRlJTRDBoUExzcTY2NDhtWVNzSm9RcGtqZkVhUnRqajNGOVdmR2Q2VlVkb1FwLVpaUDRJT2NNYVhvbWtlSElQNWpRaHRKVUdjalVyYm5R",
    id: 11,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1775752799.028849,
    hostOnly: false,
    httpOnly: false,
    name: "PREF",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value: "f6=40000080&f7=100&tz=America.Bogota&f4=4000000",
    id: 12,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245061,
    hostOnly: false,
    httpOnly: false,
    name: "SAPISID",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value: "0V5G3zxiz3i9a8YU/AjLs1FU9PxQBsHrj5",
    id: 13,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.245473,
    hostOnly: false,
    httpOnly: false,
    name: "SID",
    path: "/",
    sameSite: "unspecified",
    secure: false,
    session: false,
    storeId: "0",
    value:
      "g.a000tQgFWxCPVreQnyhb37qDvgfugEGHmP36QYnLM-bMThGcGPlwv-aXwOoD-aG30LQxLX67HAACgYKAVQSARASFQHGX2MiwpZERt6yi26gyGXEvcRLHRoVAUF8yKoMbGa2q8mTFdhe5kOQJzZ30076",
    id: 14,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1772728801.384251,
    hostOnly: false,
    httpOnly: false,
    name: "SIDCC",
    path: "/",
    sameSite: "unspecified",
    secure: false,
    session: false,
    storeId: "0",
    value:
      "AKEyXzWK-75HMD2HUU6fFZqPgDmdkfetPH4Cxq8mb1xoEi-yCr14SVzUjmlSxOg4JgGtFvkceg",
    id: 15,
  },
  {
    domain: ".youtube.com",
    expirationDate: 1773617154.244989,
    hostOnly: false,
    httpOnly: true,
    name: "SSID",
    path: "/",
    sameSite: "unspecified",
    secure: true,
    session: false,
    storeId: "0",
    value: "ALiHGNCVWenymm8-p",
    id: 16,
  },
]);

const getDuration = (from, to) => {
  const TIME_FORMAT = "hh:mm:ss.SS";
  const fromTime = moment(from, TIME_FORMAT);
  const toTime = moment(to, TIME_FORMAT);
  const diff = toTime.diff(fromTime);
  const duration = moment.duration(diff);
  return duration.asSeconds();
};

const getVideoInfo = async (url) => {
  try {
    return ytdl.getInfo(url, { agent });
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

    console.log("videoInfo", videoInfo);

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
