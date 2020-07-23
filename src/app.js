const express = require('express');
const morgan = require('morgan');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const cors = require('cors')
const graphqlHTTP = require('express-graphql');
const schema = require('./resources');

require('dotenv').config();

const middlewares = require('./middlewares');

const app = express();

app.use(morgan('dev'));
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json());
app.use(cors());

app.use('/graphql', graphqlHTTP({
  schema,
  graphiql: true
}))

app.use(middlewares.notFound);
app.use(middlewares.errorHandler);

module.exports = app;
