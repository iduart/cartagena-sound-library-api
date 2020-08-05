const { Schema, model } = require('mongoose');

const AuthSchema = Schema({
  username: String,
  password: String,
}, { timestamps: true });

module.exports = model('Auth', AuthSchema);