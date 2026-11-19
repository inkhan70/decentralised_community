require('express-async-errors');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/env');
const storage = require('./storage');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const googleAuthRoutes = require('./routes/googleAuth');
const adminRoutes = require('./routes/admin');

function buildCorsOptions() {
  const origins = config.ALLOWED_ORIGINS;
  if (origins.length === 1 && origins[0] === '*') {
    return { origin: '*' };
  }
  return {
    origin: (origin, callback) => {
      // Allow non-browser requests (no Origin header, e.g. curl/health checks)
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    }
  };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.TRUST_PROXY !== false) app.set('trust proxy', config.TRUST_PROXY);

  // The bundled frontend ships its JS/CSS as same-origin files and talks to the
  // same origin over HTTP + WebSocket, so a strict policy works and no inline
  // script or third-party host is needed. (helmet's default additionally sends
  // `upgrade-insecure-requests`, which makes browsers try to load this app's own
  // assets over https:// when it is used over plain http on a LAN, so it is off.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"]
        }
      }
    })
  );
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '10kb' }));
  app.use(morgan(config.isProduction ? 'combined' : 'dev', { skip: () => config.NODE_ENV === 'test' }));

  const health = (req, res) => {
    res.status(200).json({ status: 'ok', storageDriver: storage.driverName, db: storage.isReady() ? 'connected' : 'disconnected', timestamp: new Date().toISOString() });
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api/auth', authRoutes);
  app.use('/api/auth', googleAuthRoutes);
  app.use('/api/community', adminRoutes);
  app.use('/api', apiRoutes);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Central error handler (catches CORS rejection, JSON parse errors, etc.)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    // eslint-disable-next-line no-console
    console.error('[app] Unhandled error:', err.message);
    res.status(err.status || 500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, buildCorsOptions };
