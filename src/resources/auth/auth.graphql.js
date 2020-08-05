const { gql } = require('apollo-server');

const authType = gql`
  input credentialsInput {
    name: String!
    username: EmailAddress!
    password: String!
  }

  extend type Mutation {
    register(input: credentialsInput!): String!
  }
`;

module.exports = authType;