const { join } = require('path'); 
const { loadSchemaSync } = require('@graphql-tools/load');
const { mergeSchemas } = require('@graphql-tools/merge');
const { GraphQLFileLoader } = require('@graphql-tools/graphql-file-loader');
const merge = require('lodash.merge');

const defaultFileLoader = { loaders: [new GraphQLFileLoader()] };

// Schemas import
const UserSchema = loadSchemaSync(join(__dirname, './users/user.graphql'), defaultFileLoader);

// Resolvers
const resolvers = merge({});

// Merge schemas imported and resolvers
const schemas = mergeSchemas({
  schemas: [
    UserSchema,
  ],
  resolvers
});

module.exports = schemas;
