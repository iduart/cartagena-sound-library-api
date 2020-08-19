const { gql } = require('apollo-server');

const deviceType = gql`
  type Device {
    _id: ID!
    code: String!
    favorites: [String],
  }

  extend type Query {
    deviceFavoritesSoundsIds(deviceId: String!): [String]!
    deviceFavoritesSounds(deviceId: String!, offset: Int!): [Sound]!
  }

  extend type Mutation {
    toogleDeviceFavorite(deviceId: String!, soundId: String!): String!
  }
`;

module.exports = deviceType;