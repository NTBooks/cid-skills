const { createServer } = require('../../server');
const { loadDotEnv } = require('../../lib/config');
const { ensureDataDir } = require('../../lib/storage');

async function runWebstart(portArg, ui) {
  await ensureDataDir();

  const env = await loadDotEnv();
  const port = portArg || parseInt(process.env.PORT, 10) || parseInt(env.PORT, 10) || 8163;
  const app = createServer();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      if (ui) {
        ui.ok('Web UI running at: ' + ui.url('http://localhost:' + port));
        ui.dim('Press Ctrl+C to stop.');
        ui.raw('');
      } else {
        const log = require('../log');
        log.ok('Web UI running at: ' + log.url('http://localhost:' + port));
        log.dim('Press Ctrl+C to stop.');
        console.log('');
      }
    });
    server.on('error', (err) => {
      const log = ui || require('../log');
      if (err.code === 'EADDRINUSE') {
        log.fail('Port ' + port + ' is already in use. Try a different port: dsoul webstart <port>');
      } else {
        log.fail('Server error: ' + err.message);
      }
      reject(err);
    });
    process.on('SIGINT', () => {
      const log = ui || require('../log');
      if (ui) ui.raw(''); else console.log('');
      if (ui) ui.info('Shutting down...'); else log.info('Shutting down...');
      server.close();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      server.close();
      process.exit(0);
    });
  });
}

module.exports = { runWebstart };
