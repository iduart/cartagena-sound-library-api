const { Schema, model } = require("mongoose");

const UserSchema = new Schema({
  identityProviderId: {
    type: Schema.Types.ObjectId,
    ref: 'Auth'
  },
  name: String,
  email: String,
  favorites: [{ type: Schema.Types.ObjectId, ref: 'Sound' }],
  sounds: [{ type: Schema.Types.ObjectId, ref: 'Sound' }]
}, { timestamps: true });

module.exports = model("User", UserSchema);
