const stream = require('stream');
const youtubedl = require('youtube-dl')
const AWS = require('aws-sdk');
const ffmpeg = require('fluent-ffmpeg');
const SoundModel = require('../sound.model');

const getVideoInfo = (url) => {
  return new Promise((resolve, reject) => { 
    youtubedl.getInfo(url, (err, info) => {
      if (err) {
        reject(err);
      }
      resolve(info);
    });
  })
}

// const getSoundInstance = () => {
//   return new SoundModel({
//     name,
//     sound,
//     thumbnail,
//     tags,
//     author,
//   });
// }

async function createSound(_, { input = {} }) {
  const { name, author, url, from, to } = input;
  const passtrough = new stream.PassThrough();
  
  // const url = "https://www.youtube.com/watch?v=RtWQAVzgYtg";
  const videoInfo = await getVideoInfo(url);

  var command = ffmpeg()
  .input(videoInfo.url)
  .noVideo()
  .format('mp3')
  .audioCodec('libmp3lame')
  .seekInput(from)
  .duration(to)
  .pipe(passtrough);

  command.on('progress', function(progress) {
    console.log('Processing: ' + progress.percent + '% done');
  });

  command.on('end', function(stdout, stderr) {
    console.log('Transcoding succeeded!');
  });

  const upload = new AWS.S3.ManagedUpload({
    params: {
      Bucket: 'cartagena-sound-library-temporary-folder',
      Key: 'test1.mp3',
      Body: passtrough
    },
    partSize: 1024 * 1024 * 64 // 64 MB in bytes
  });

  upload.send((err) => {
    if (err) {
      console.log('error', err);
    } else {
      console.log('done');
    }
  });
}

module.exports = createSound;