const serverless = require('serverless-http');
const { createApp, corsHeadersFor } = require('../../src/app');
const storage = require('../../src/storage');
const { mongoose, classifyConnectionError } = require('../../src/db');

const app = createApp();
const proxy = serverless(app);
let connectPromise = null;
mongoose.connection.on('disconnected', () => { connectPromise = null; });

function headerOf(event, name) {
  const h = (event && event.headers) || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  return key ? h[key] : undefined;
}

/** JSON response that always carries CORS headers so the browser can read it. */
function jsonResponse(event, statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...corsHeadersFor(headerOf(event, 'origin'))
    },
    body: JSON.stringify(payload)
  };
}

async function ensureDatabase() {
  if (storage.driverName !== 'mongo') {
    const e = new Error('STORAGE_DRIVER must be "mongo" on Netlify (the local file driver cannot persist data in a serverless function).');
    e.code = 'STORAGE_DRIVER_NOT_MONGO';
    throw e;
  }
  if (storage.isReady()) return;
  if (!connectPromise) {
    connectPromise = storage.connect().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
}

function describeFailure(err) {
  if (err && err.code === 'STORAGE_DRIVER_NOT_MONGO') {
    return { reason: 'storage_driver', hint: 'Set STORAGE_DRIVER=mongo in the Netlify environment variables and redeploy.' };
  }
  return classifyConnectionError(err);
}

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  const incomingPath = String(event.path || '');
  const suffix = incomingPath.replace(/^\/.netlify\/functions\/api/, '');
  const rewritten = { ...event, path: `/api${suffix}` };
  const method = String(event.httpMethod || '').toUpperCase();

  // CORS preflight must never depend on the database: answer it straight away.
  if (method === 'OPTIONS') return proxy(rewritten, context);

  try {
    await ensureDatabase();
  } catch (err) {
    const { reason, hint } = describeFailure(err);
    console.error('[netlify-api] Database unavailable:', reason, '-', err && err.message);
    return jsonResponse(event, 503, {
      error: 'Database is temporarily unavailable. Check MongoDB Atlas URI, database user permissions, and Network Access allowlist.',
      reason,
      hint
    });
  }

  return proxy(rewritten, context);
};
