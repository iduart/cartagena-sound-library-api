const youtubedl = require('youtube-dl')
const AWS = require('aws-sdk');
const stream = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const request = require('request');
const moment = require('moment');

const TEMP_BUCKET_NAME = "cartagena-sound-library-temporary-folder";

const getDuration = (from, to) => {
  const TIME_FORMAT = 'hh:mm:ss.SS';
  const fromTime = moment(from, TIME_FORMAT);
  const toTime = moment(to, TIME_FORMAT);
  
  const diff = toTime.diff(fromTime);
  
  const duration = moment.duration(diff);

  return duration.asSeconds();
}

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
      ACL: "public-read",
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

  const duration = getDuration(from, to);

  const soundFilename = `${deviceId}.mp3`;
  const thumbnailFilename = `${deviceId}.png`;

  const soundFileData = await processAudio(videoInfo.url, from, duration, soundFilename);
  const thumbnailFileData = await processThumbnail(thumbnailUrl, thumbnailFilename);

  return {
    _id: deviceId,
    name,
    sound: soundFileData.Location,
    author,
    thumbnail: thumbnailFileData.Location,
  }
}

module.exports = previewSound;