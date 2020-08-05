const bcript = require('bcryptjs');
const AuthModel = require('./auth.model');
const UserModel = require('../users/user.model');

const authResolvers = {
  Mutation: {
    register(_, { input }) {
      const { username, password, name } = input;
      const salt = bcript.genSaltSync(10);
      const hashedPassword = bcript.hashSync(password, salt);

      const auth = new AuthModel({
        username,
        password: hashedPassword
      })

      const user = new UserModel({
        identityProviderId: auth._id,
        name,
        email: username
      })

      auth.save();
      user.save();

      return `${name} registered`;
    }
  }
}

module.exports = authResolvers;