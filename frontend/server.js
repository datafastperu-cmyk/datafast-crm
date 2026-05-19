'use strict';
/**
 * Custom Next.js HTTP server.
 *
 * WHY this file exists:
 *   When PM2 runs `npm start`, it manages a shell wrapper (npm → sh → next-server).
 *   SIGTERM sent by PM2 kills the shell but the child `next-server` can linger
 *   holding the TCP port, causing EADDRINUSE on the next restart.
 *
 *   Running `node server.js` directly means PM2 owns the Next.js process itself.
 *   SIGTERM arrives in THIS handler, `server.close()` drains existing connections,
 *   then we exit cleanly before PM2 starts the replacement — no port collision.
 */

const http  = require('http');
const { parse } = require('url');
const next  = require('next');

const PORT     = parseInt(process.env.PORT     || '3000',      10);
const HOSTNAME = process.env.HOSTNAME          || '0.0.0.0';
const dev      = process.env.NODE_ENV          !== 'production';

const app    = next({ dev, hostname: HOSTNAME, port: PORT });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('[server] Request error:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  server.listen(PORT, HOSTNAME, () => {
    console.log(`[datafast-frontend] Ready → http://${HOSTNAME}:${PORT}`);
    // Notify PM2 that we are listening (requires wait_ready: true in ecosystem)
    if (typeof process.send === 'function') {
      process.send('ready');
    }
  });

  server.on('error', (err) => {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  });

  // ── Graceful shutdown ────────────────────────────────────────
  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[datafast-frontend] ${signal} received — shutting down...`);

    // Stop accepting new connections; finish in-flight requests
    server.close((err) => {
      if (err) {
        console.error('[datafast-frontend] Error closing server:', err);
        process.exit(1);
      }
      console.log('[datafast-frontend] All connections closed. Exiting cleanly.');
      process.exit(0);
    });

    // Hard exit if graceful shutdown takes too long
    // PM2 kill_timeout is 10 000 ms — we exit at 8 000 to stay inside that window
    setTimeout(() => {
      console.warn('[datafast-frontend] Shutdown timeout — forcing exit');
      process.exit(1);
    }, 8_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('[datafast-frontend] Uncaught exception:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[datafast-frontend] Unhandled rejection:', reason);
  });
});
