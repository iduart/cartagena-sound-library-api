const mongoose = require('mongoose');
const app = require('./app');

const {
  PORT,
  MONGO_HOST,
  MONGO_USER,
  MONGO_PASSWORD,
  MONGO_DATABASE
} = process.env;

// Initialize and connect DB (mongo)
async function main() {
  try {
    // await mongoose.connect(
    //   `mongodb+srv://${MONGO_USER}:${MONGO_PASSWORD}@${MONGO_HOST}/${MONGO_DATABASE}?retryWrites=true`,
    //   {
    //     keepAliveInitialDelay: 3000,
    //     useNewUrlParser: true
    //   }
    // );
    // console.log("Connected to mongo");
    // Run the http server
    const port = PORT || 8000;
    app.listen(port, () => {
      console.log(`Listening: http://localhost:${port}`);
    });
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
