const { gql } = require("apollo-server");

const userType = gql`
  type User {
    id: ID!
    name: String!
    createdAt: String!
    updatedAt: String!
  }

  extend type Query {
    me: User
  }
`;

module.exports = userType;