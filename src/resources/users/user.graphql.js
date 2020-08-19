const { gql } = require("apollo-server");

const userType = gql`
  type User {
    _id: ID!
    name: String!
    email: EmailAddress!
    createdAt: String!
    updatedAt: String!
  }

  extend type Query {
    me: User
  }
`;

module.exports = userType;