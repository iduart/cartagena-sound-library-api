const { ApolloServer, gql } = require("apollo-server");
const { EmailAddressResolver } = require('graphql-scalars');
const merge = require('lodash.merge');

// Types definitions
const userType = require('./resources/users/user.graphql');
const authType = require('./resources/auth/auth.graphql');
const soundType = require('./resources/sounds/sound.graphql');
const deviceType = require('./resources/devices/devices.graphql');
// Resolvers
const userResolver = require('./resources/users/user.resolvers');
const authResolver = require('./resources/auth/auth.resolvers');
const soundResolver = require('./resources/sounds/sound.resolvers');
const deviceResolver = require('./resources/devices/devices.resolvers');

const resolvers = merge(
  {
    EmailAddress: EmailAddressResolver,
  },
  userResolver,
  authResolver,
  soundResolver,
  deviceResolver,
);

/* We can only have one "Query" and one "Mutation"
 So we write main ones and we use extend keyword in 
 Each individual file */
const mainTypes = gql`
  scalar EmailAddress

  type Query{
    _empty: String
  }
  type Mutation {
    _empty: String
  }
`;

// Caddy terminates TLS and proxies to localhost, so req.connection always sees
// 127.0.0.1. The real caller is the first entry of X-Forwarded-For.
const clientIp = (req) => {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req.connection && req.connection.remoteAddress) || null;
};

const server = new ApolloServer({
  typeDefs: [
    mainTypes,
    userType,
    authType,
    soundType,
    deviceType,
  ],
  resolvers,
  context: ({ req }) => ({ clientIp: clientIp(req) }),
});

module.exports = server;