const http = require('http');
const { Server } = require('socket.io');
const config = require('./src/config/env');
const storage = require('./src/storage');
const attachSocketHandlers = require('./src/sockets');

async function startRealtime() {
  if (config.STORAGE_DRIVER !== 'mongo') throw new Error('Realtime service must use MongoDB Atlas (STORAGE_DRIVER=mongo).');
  await storage.connect();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ status: 'ok', service: 'community-realtime' })); }
    res.writeHead(404); res.end('Not found');
  });
  const io = new Server(server, { cors: { origin: config.ALLOWED_ORIGINS, methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
  const sockets = attachSocketHandlers(io);
  server.listen(config.PORT || 3000, '0.0.0.0', () => console.log(`[realtime] listening on ${config.PORT || 3000}`));
  const stop = async () => { sockets.stop(); io.close(); server.close(async () => { await storage.disconnect(); process.exit(0); }); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  return { server, io };
}
if (require.main === module) startRealtime().catch((e) => { console.error(e); process.exit(1); });
module.exports = { startRealtime };
