const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('Coral Bot is online!');
});

function keepAlive() {
  app.listen(port, () => {
    console.log(`Keep-alive server is running on port ${port}`);
  });
}

module.exports = keepAlive;
