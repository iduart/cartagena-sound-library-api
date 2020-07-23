const { ApolloServer } = require("apollo-server");
const merge = require('lodash.merge');

// Types definitions
const userType = require('./resources/users/user.graphql');
// Resolvers
const userResolver = require('./resources/users/user.resolvers');

const resolvers = merge(
  {},
  userResolver,
);

const server = new ApolloServer({
  typeDefs: [
    userType,
  ],
  resolvers,
});

module.exports = server;