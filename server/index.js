const path = require('path');
const express = require('express');
const apiRouter = require('./routes/api');

function createServer() {
  const app = express();

  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: true, limit: '3mb' }));

  app.use('/api', apiRouter);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

module.exports = { createServer };
