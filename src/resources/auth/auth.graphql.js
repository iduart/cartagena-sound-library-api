const { gql } = require('apollo-server');

const authType = gql`
  input registerInput {
    name: String!
    username: EmailAddress!
    password: String!
  }

  extend type Mutation {
    register(input: registerInput!): String!
    login(username: String!, password: String!): String!
  }
`;

module.exports = authType;