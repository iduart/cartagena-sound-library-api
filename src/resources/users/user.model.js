const { Schema, model } = require("mongoose");

const UserSchema = new Schema({
  name: String,

}, { timestamps: true });

module.exports = model("User", UserSchema);
