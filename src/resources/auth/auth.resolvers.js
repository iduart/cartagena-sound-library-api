const bcript = require('bcryptjs');
const AuthModel = require('./auth.model');
const UserModel = require('../users/user.model');

const usernameExists = async (username) => {
  const auth = await AuthModel.findOne({ username });
  return !!auth;
}

const authResolvers = {
  Mutation: {
    async register(_, { input }) {
      const { username, password, name } = input;
      
      // verify if exists
      const userExists = await usernameExists(username)
      if (userExists) {
        throw Error("El usuario no está disponible");
      }

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
    },
    async login(_, { username, password }) {
      const auth = await AuthModel.findOne({ username });
      if (!auth) {
        throw Error("Usuario o contraseña incorrecta")
      }
      if (!bcript.compareSync(password, auth.password)) {
        throw Error("Usuario o contraseña incorrecta")
      }
      
      return `JWT for ${auth.username}`;
    }
  }
}

module.exports = authResolvers;