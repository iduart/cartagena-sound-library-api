const SoundModel = require('./sound.model');
const createSound = require('./resolvers/createSound');

const soundResolver = {
  Query: {
    async sounds(_, args) {
      const { filters } = args;
      let formattedFilters = {};
      const limit = 20;
      const offset = args.offset || 0;

      if (filters.search) {
        formattedFilters = {
          ...formattedFilters,
          $text: {
            $search: filters.search,
          }
        }
      }
      const sounds = await SoundModel.find(formattedFilters).limit(limit).skip(offset).sort({ createdAt: -1 });
      return sounds;
    }
  },
  Mutation: {
    createSound,
    createSoundFromAdmin(_, { input }) {
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
      // const response = await SoundModel.remove({ _id: id });
      // return response.deletedCount;
      return 'success';
    }
  }
}

module.exports = soundResolver;