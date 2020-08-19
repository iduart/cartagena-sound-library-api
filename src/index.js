require('dotenv').config();
const server = require('./server');
const mongoose = require('mongoose');

const {
  PORT,
  MONGO_HOST,
  MONGO_USER,
  MONGO_PASSWORD,
  MONGO_DATABASE
} = process.env;

let mongoConnectionString;
if (MONGO_USER && MONGO_PASSWORD) {
  mongoConnectionString = `mongodb+srv://${MONGO_USER}:${MONGO_PASSWORD}@${MONGO_HOST}/${MONGO_DATABASE}?retryWrites=true`;
} else {
  mongoConnectionString = `mongodb://${MONGO_HOST}/${MONGO_DATABASE}?retryWrites=true`;
}

// Initialize and connect DB (mongo)
async function main() {
  try {
    await mongoose.connect(
      mongoConnectionString,
      {
        keepAliveInitialDelay: 3000,
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    );
    console.log("Connected to mongo");

    const port = PORT || 8000;
    server.listen(port).then(({ url }) => console.log(`Server running at ${ url } `));
  } catch (err) {
    // Emit the error and stop the server
    console.error(err);
    process.exit(1);
  }
}

process.on('uncaughtException', function(error) {
  process.exit(1);
});

main();
