const youtubedl = require('youtube-dl')
const AWS = require('aws-sdk');
const stream = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const request = require('request');

const TEMP_BUCKET_NAME = "cartagena-sound-library-temporary-folder";

const getVideoUrl = (url) => {
  return new Promise((resolve, reject) => {
    youtubedl.getInfo(url, (err, info) => {
      if (err) {
        reject(err);
      }
      resolve(info);
    });
  })
}

const processThumbnail = (thumbnailUrl, thumbnailFilename) => new Promise((resolve, reject) => {
  if (!thumbnailUrl || !thumbnailFilename) {
    return;
  }

  const passtrough = new stream.PassThrough();

  const resizedImage =
    sharp()
      .resize(74, 74)
      .png();

  request(thumbnailUrl)
    .pipe(resizedImage)
    .pipe(passtrough);

  const upload = new AWS.S3.ManagedUpload({
    params: {
      ACL: "public-read",
      Bucket: TEMP_BUCKET_NAME,
      Key: thumbnailFilename,
      Body: passtrough,
    },
    partSize: 1024 * 1024 * 10 // 64 MB in bytes
  });

  upload.send((err, data) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
})

const processAudio = (videoUrl, from = '00:00:00', duration = 7, filename) => new Promise((resolve, reject) => {
  if (!videoUrl || !filename) {
    return;
  }

  const passtrough = new stream.PassThrough();

  ffmpeg()
    .input(videoUrl)
    .noVideo()
    .format('mp3')
    .audioCodec('libmp3lame')
    .seekInput(from)
    .duration(duration)
    .pipe(passtrough);

  const upload = new AWS.S3.ManagedUpload({
    params: {
      ACL: "public-read-write",
      Bucket: TEMP_BUCKET_NAME,
      Key: filename,
      Body: passtrough,
    },
    partSize: 1024 * 1024 * 64 // 64 MB in bytes
  });

  upload.send((err, data) => {
    if (err) {
      console.log(err);
      reject(err);
    } else {
      resolve(data);
    }
  });
})

async function previewSound(_, { input }) {
  const { url, from, to, name, author, deviceId } = input;

  const videoInfo = await getVideoUrl(url);
  const thumbnailUrl = videoInfo.thumbnails[0];

  //get duration substracting to - from 
  const duration = 7;
  const soundFilename = `${deviceId}.mp3`;
  const thumbnailFilename = `${deviceId}.png`;

  const soundFileData = await processAudio(videoInfo.url, from, duration, soundFilename);
  const thumbnailFileData = await processThumbnail(thumbnailUrl, thumbnailFilename);

  return {
    _id: deviceId+'1',
    name,
    sound: soundFileData.Location,
    author,
    thumbnail: thumbnailFileData.Location,
  }
}

module.exports = previewSound;