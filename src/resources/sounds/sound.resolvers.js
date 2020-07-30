const SoundModel = require('./sound.model');

const soundResolver = {
  Query: {
    async sounds(_, { input = {} }) {
      let filters = {};

      if (input.search) {
        filters = {
          ...filters,
          $text: {
            $search: input.search
          }
        }
      }

      const sounds = await SoundModel.find(filters);
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
    async removeSound(_, { id }) {
      const response = await SoundModel.remove({ _id: id });
      return response.deletedCount;
    }
  }
}

module.exports = soundResolver;