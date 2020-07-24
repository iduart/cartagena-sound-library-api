const { gql } = require('apollo-server');

const soundType = gql`
  type Sound {
    _id: ID!
    name: String!
    sound: String!
    thumbnail: String
    createdAt: String!
    updatedAt: String!
  }

  extend type Query {
    sounds: [Sound]
  }
`;

module.exports = soundType;