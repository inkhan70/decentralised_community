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
  if (!storage.isReady() && !connectPromise) {
    connectPromise = storage.connect().catch((err) => { connectPromise = null; throw err; });
  }
  if (connectPromise) await connectPromise;
  const rewritten = { ...event, path: `/api${String(event.path || '').replace(/^\/.netlify\/functions\/api/, '')}` };
  return proxy(rewritten, context);
};
