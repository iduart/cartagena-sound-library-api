const youtubedl = require('youtube-dl')
const AWS = require('aws-sdk');
const stream = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const request = require('request');
const moment = require('moment');
const SoundModel = require('../sound.model');

const TEMP_BUCKET = "cartagena-sound-library-temporary-folder";
const SOUNDS_BUCKET = "cartagena-sound-library-sound-list";
const THUMBNAILS_BUCKET = "cartagena-sound-library-thumbnails";

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

const S3Upload = (passtrough, filename, bucket) =>
  new AWS.S3.ManagedUpload({
    params: {
      ACL: "public-read",
      Bucket: bucket,
      Key: filename,
      Body: passtrough,
    },
    partSize: 1024 * 1024 * 10 // 64 MB in bytes
  });

const processThumbnail = (thumbnailUrl, thumbnailFilename, isPreview) => new Promise((resolve, reject) => {
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

  const bucket = isPreview ? TEMP_BUCKET : THUMBNAILS_BUCKET;
  const upload = S3Upload(passtrough, thumbnailFilename, bucket);

  upload.send((err, data) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
})

const processAudio = (videoUrl, from = '00:00:00', duration = 7, filename, isPreview) => new Promise((resolve, reject) => {
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

  const bucket = isPreview ? TEMP_BUCKET : SOUNDS_BUCKET;
  const upload = S3Upload(passtrough, filename, bucket);

  upload.send((err, data) => {
    if (err) {
      reject(err);
    } else {
      resolve(data);
    }
  });
})

async function createSound(_, { input }) {
  const { url, from, to, name, author, deviceId, isPreview } = input;
  let newSound = {};

  if (!isPreview) {
    newSound = new SoundModel({
      name,
      author,
      tags: [],
    });
  }

  const videoInfo = await getVideoUrl(url);
  const thumbnailUrl = videoInfo.thumbnails[0];

  const duration = getDuration(from, to);

  const soundFilename = newSound._id ? `${newSound._id}.mp3` : `${deviceId}.mp3`;
  const thumbnailFilename = newSound._id ? `${newSound._id}.png` : `${deviceId}.png`;

  const soundFileData = await processAudio(videoInfo.url, from, duration, soundFilename, isPreview);
  const thumbnailFileData = await processThumbnail(thumbnailUrl, thumbnailFilename, isPreview);

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
  }
}

module.exports = createSound;