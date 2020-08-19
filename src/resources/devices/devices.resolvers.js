const DeviceModel = require('./devices.model');

const getDevice = async (deviceId) => {
  let device;
  const existingDevice = await DeviceModel.findOne({ code: deviceId });
  if (existingDevice) {
    device = existingDevice;
  } else {
    device = new DeviceModel({ code: deviceId });
    await device.save();
  }

  return device;
}

const deviceResolver = {
  Query: {
    async deviceFavoritesSoundsIds(_, { deviceId }) {
      const device = await DeviceModel.findOne({ code: deviceId });
      return device.favorites && device.favorites.length ? device.favorites : [];
    },
    async deviceFavoritesSounds(_, args) {
      const limit = 20;
      const offset = args.offset || 0;

      const aggregation = [
        {
          "$unwind": "$favorites"
        },
        {
          "$lookup": {
            "from": "sounds",
            "localField": "favorites",
            "foreignField": "_id",
            "as": "sound"
          }
        },
        {
          "$unwind": "$sound"
        },
        {
          "$match": {
            "code": args.deviceId
          }
        },
        {"$skip": offset },
        {"$limit": limit }
      ]
      const favoritesSounds = await DeviceModel.aggregate(aggregation);

      if (!favoritesSounds || !favoritesSounds.length) {
        return [];
      }

      const sounds = favoritesSounds.map(favorite => favorite.sound);
      return sounds;
    }
  },
  Mutation: {
    async toogleDeviceFavorite(_, { deviceId, soundId }) {
      const device = await getDevice(deviceId);
      if (!device) {
        return '';
      }
      
      const favorites = device.favorites && device.favorites.length ? [...device.favorites] : [];
      const favoriteIndex = favorites.findIndex(favorite => favorite.equals(soundId));

      if (favoriteIndex > -1) {
        await DeviceModel.update({ code: deviceId }, { $pull: { "favorites": soundId }});
      } else {
        await DeviceModel.update({ code: deviceId }, { $push: { "favorites": soundId }});
      }

      return `ok`;
    }
  }
} 

module.exports = deviceResolver;