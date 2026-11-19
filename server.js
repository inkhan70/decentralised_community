/**
 * Production entrypoint for the Decentralized Community Hub.
 * Storage: MongoDB (remote Atlas or local instance) OR local JSON file — see STORAGE_DRIVER.
 * Features:
 *  - Authentication (JWT + Bcrypt)
 *  - Persistent storage (Users, Ledger/Contributions, Polls, Votes)
 *  - Socket.io WebSockets (Trade Guilds, Real-time Dashboard, Live Voting)
 *  - Global "Nation Balance" Aggregation (peer-verified contributions)
 *  - Guild chat, presence, poll deadlines
 */
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');

const config = require('./src/config/env');
const { createApp, buildCorsOptions } = require('./src/app');
const storage = require('./src/storage');
const attachSocketHandlers = require('./src/sockets');

/** Every non-internal IPv4 address on this machine — for printing LAN URLs. */
function getLanAddresses() {
  const addresses = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  return addresses;
}

function printAccessUrls() {
  const { PORT, PUBLIC_URL } = config;
  // eslint-disable-next-line no-console
  console.log('\nThe app is reachable at:');
  // eslint-disable-next-line no-console
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const ip of getLanAddresses()) {
    // eslint-disable-next-line no-console
    console.log(`  Network:  http://${ip}:${PORT}   (same Wi-Fi/LAN)`);
  }
  if (PUBLIC_URL) {
    // eslint-disable-next-line no-console
    console.log(`  Public:   ${PUBLIC_URL}`);
  }
  // eslint-disable-next-line no-console
  console.log('');
}

async function start() {
  await storage.connect();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { ...buildCorsOptions(), methods: ['GET', 'POST'] }
  });

  const sockets = attachSocketHandlers(io);

  server.listen(config.PORT, config.HOST, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Server running on ${config.HOST}:${config.PORT} [${config.NODE_ENV}] using "${storage.driverName}" storage`
    );
    printAccessUrls();
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);

    sockets.stop();
    io.close();
    server.close(async () => {
      try {
        await storage.disconnect();
      } finally {
        // eslint-disable-next-line no-console
        console.log('[server] Shutdown complete.');
        process.exit(0);
      }
    });

    // Force-exit if shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { app, server, io, sockets };
}

// Handlers are individually guarded, so this is a last line of defence: log the
// problem instead of letting one bad event take the whole community offline.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[server] Unhandled promise rejection:', reason);
});

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { start };
