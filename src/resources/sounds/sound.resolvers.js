const SoundModel = require('./sound.model');

const soundResolver = {
  Query: {
    sounds(){
      return []
    }
  },
  Mutation: {
    createSound(_, { input }) {
      const { name, sound, thumbnail } = input;
      const newSound = new SoundModel({ 
        name, 
        sound,
        thumbnail
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