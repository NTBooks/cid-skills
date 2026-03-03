const { createServer } = require('../../server');
const { loadDotEnv } = require('../../lib/config');
const { ensureDataDir } = require('../../lib/storage');

async function tryListen(app, startPort, maxTries) {
  for (let i = 0; i < maxTries; i++) {
    const port = startPort + i;
    const result = await new Promise((resolve) => {
      const server = app.listen(port, () => resolve({ ok: true, server, port }));
      server.once('error', (err) =>
        err.code === 'EADDRINUSE' ? resolve({ ok: false }) : resolve({ ok: false, err })
      );
    });
    if (result.ok) return result;
    if (result.err) throw result.err;
  }
  return { ok: false };
}

async function runWebstart(portArg, ui) {
  await ensureDataDir();

  const env = await loadDotEnv();
  const startPort = portArg || parseInt(process.env.PORT, 10) || parseInt(env.PORT, 10) || 8148;
  const app = createServer();

  const result = await tryListen(app, startPort, portArg ? 1 : 10);

  if (!result.ok) {
    const log = ui || require('../log');
    const rangeMsg = portArg ? `Port ${startPort}` : `Ports ${startPort}–${startPort + 9}`;
    log.fail(rangeMsg + ' are all in use. Try: dsoul webstart <port>');
    throw new Error('No port available');
  }

  const { server, port } = result;
  const url = 'http://localhost:' + port;

  if (ui) {
    ui.ok('Web UI running at: ' + ui.url(url));
    if (port !== startPort) ui.dim('(port ' + startPort + ' was in use, using ' + port + ')');
    ui.dim('Press Ctrl+C to stop.');
    ui.raw('');
  } else {
    const log = require('../log');
    log.ok('Web UI running at: ' + log.url(url));
    if (port !== startPort) log.dim('(port ' + startPort + ' was in use, using ' + port + ')');
    log.dim('Press Ctrl+C to stop.');
    console.log('');
  }

  import('open').then((m) => (m.default || m)(url)).catch(() => {});

  // Explicitly ref the server so it keeps the event loop alive even if other
  // handles (stdin, timers) are released.
  server.ref();

  return new Promise((resolve) => {
    process.on('SIGINT', () => {
      const log = ui || require('../log');
      if (ui) ui.raw(''); else console.log('');
      if (ui) ui.info('Shutting down...'); else log.info('Shutting down...');
      server.close();
      resolve();
    });
    process.on('SIGTERM', () => {
      server.close();
      resolve();
    });
  });
}

module.exports = { runWebstart };
