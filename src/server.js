const { ApolloServer, gql } = require("apollo-server");
const { EmailAddressResolver } = require('graphql-scalars');
const merge = require('lodash.merge');

// Types definitions
const userType = require('./resources/users/user.graphql');
const authType = require('./resources/auth/auth.graphql');
const soundType = require('./resources/sounds/sound.graphql');
// Resolvers
const userResolver = require('./resources/users/user.resolvers');
const authResolver = require('./resources/auth/auth.resolvers');
const soundResolver = require('./resources/sounds/sound.resolvers');

const resolvers = merge(
  {
    EmailAddress: EmailAddressResolver,
  },
  userResolver,
  authResolver,
  soundResolver,
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

const server = new ApolloServer({
  typeDefs: [
    mainTypes,
    userType,
    authType,
    soundType,
  ],
  resolvers,
});

module.exports = server;