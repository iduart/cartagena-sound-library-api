const { Schema, model } = require('mongoose');

const DeviceSchema = Schema({
  code: String,
  favorites: [{ type: Schema.Types.ObjectId, ref: 'Sound' }]
}, { timestamps: true });

module.exports = model('Device', DeviceSchema);