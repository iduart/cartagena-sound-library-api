const { Schema, model } = require('mongoose');

const SoundSchema = Schema({
  name: String,
  sound: String,
  thumbnail: String,
  uploadedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  }
}, { timestamps: true });

module.exports = model("Sound", SoundSchema);