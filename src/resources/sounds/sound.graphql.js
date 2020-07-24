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

  input addSoundInput {
    name: String!
    sound: String!
    thumbnail: String!
  }

  input removeSoundInput {
    id: String!
  }

  extend type Mutation {
    createSound(input: addSoundInput): Sound!
    removeSound(input: removeSoundInput): String
  }
`;

module.exports = soundType;