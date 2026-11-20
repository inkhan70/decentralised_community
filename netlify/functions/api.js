const serverless = require('serverless-http');
const { createApp } = require('../../src/app');
const storage = require('../../src/storage');
const { mongoose } = require('../../src/db');
const app = createApp();
const proxy = serverless(app);
let connectPromise = null;
mongoose.connection.on('disconnected', () => { connectPromise = null; });

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    if (!storage.isReady() && !connectPromise) {
      connectPromise = storage.connect().catch((err) => {
        connectPromise = null;
        throw err;
      });
    }
    if (connectPromise) await connectPromise;
  } catch (err) {
    console.error('[netlify-api] Database connection failed:', err && err.message);
    return {
      statusCode: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'Database is temporarily unavailable. Check MongoDB Atlas URI, database user permissions, and Network Access allowlist.' })
    };
  }

  const incomingPath = String(event.path || '');
  const suffix = incomingPath.replace(/^\/.netlify\/functions\/api/, '');
  const rewritten = { ...event, path: `/api${suffix}` };
  return proxy(rewritten, context);
};
