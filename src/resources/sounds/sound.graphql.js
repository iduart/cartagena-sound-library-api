const { gql } = require('apollo-server');

const soundType = gql`
  input addSoundInputFromAdmin {
    name: String!
    sound: String!
    thumbnail: String!
    tags: [String]
    author: String
  }

  input addSoundInput {
    url: String!
    from: String!
    to: String!
    name: String!
    author: String!
  }

  input filtersInput {
    id: String
    name: String
    author: String
    search: String
  }

  type Sound {
    _id: ID!
    name: String!
    sound: String!
    tags: [String]
    author: String!
    thumbnail: String
    createdAt: String!
    updatedAt: String!
  }

  extend type Query {
    sounds(filters: filtersInput, offset: Int! ): [Sound]
  }

  extend type Mutation {
    createSound(input: addSoundInput!): Sound!
    createSoundFromAdmin(input: addSoundInputFromAdmin!): Sound!
    removeSound(id: String!): String
  }
`;

module.exports = soundType;