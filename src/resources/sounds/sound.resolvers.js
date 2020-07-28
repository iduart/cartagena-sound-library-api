const SoundModel = require('./sound.model');

const soundResolver = {
  Query: {
    async sounds() {
      const sounds = await SoundModel.find();
      return sounds;
    }
  },
  Mutation: {
    createSound(_, { input }) {
      const { name, sound, thumbnail, tags = [], author } = input;
      const newSound = new SoundModel({ 
        name, 
        sound,
        thumbnail,
        tags,
        author,
      });
      newSound.save();
      return newSound;
    },
    async removeSound(_, { input }) {
      const response = await SoundModel.remove({ _id: input.id });
      return response.deletedCount;
    }
  }
}

module.exports = soundResolver;