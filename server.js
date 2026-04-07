require('dotenv').config();

// Must initialise Firebase Admin before any route imports it
require('./firebase');

const express = require('express');
const cors    = require('cors');
const logger  = require('./logger');
const { globalLimiter } = require('./middleware/rateLimiter');

const projectsRouter       = require('./routes/projects');
const reviewRouter         = require('./routes/review');
const commentRouter        = require('./routes/comment');
const authRouter           = require('./routes/auth');
const setupWorkflowRouter  = require('./routes/setupWorkflow');
const reviewsRouter        = require('./routes/reviews');
const applyFixRouter       = require('./routes/applyFix');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
// In development ALLOWED_ORIGINS defaults to localhost:5173.
// In production set ALLOWED_ORIGINS to your Vercel URL (comma-separated if
// you have multiple, e.g. https://your-app.vercel.app,https://yourdomain.com).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No origin = server-to-server request (GitHub Actions, curl, Render health checks)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      logger.warn('cors.blocked', { origin });
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json());

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    logger.info('http.request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/projects',        projectsRouter);
app.use('/review',          reviewRouter);
app.use('/comment',         commentRouter);
app.use('/auth/github',     authRouter);          // all OAuth routes under /auth/github/*
app.use('/setup-workflow',  setupWorkflowRouter);
app.use('/reviews',         reviewsRouter);
app.use('/apply-fix',       applyFixRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status:   'ok',
    uptime:   Math.floor(process.uptime()),
    services: {
      openai:       !!process.env.OPENAI_API_KEY,
      github_oauth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      github_token: !!process.env.GITHUB_TOKEN,
      firebase:     !!process.env.FIREBASE_PROJECT_ID,
    },
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('http.unhandled_error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  logger.info('server.start', { port: PORT, env: process.env.NODE_ENV || 'development' });
  console.log(`\n🚀 AI Code Review server running on port ${PORT}`);
  console.log(`   Environment:    ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`   Backend URL:    ${process.env.BACKEND_URL || '(not set — will use request host)'}`);
  console.log(`   OpenAI key:     ${process.env.OPENAI_API_KEY       ? '✅ set' : '❌ missing'}`);
  console.log(`   GitHub OAuth:   ${process.env.GITHUB_CLIENT_ID     ? '✅ configured' : '⚠️  not set'}`);
  console.log(`   GitHub token:   ${process.env.GITHUB_TOKEN         ? '✅ set (server fallback)' : '⚠️  not set'}`);
  console.log(`   Firebase:       ${process.env.FIREBASE_PROJECT_ID  ? '✅ configured' : '❌ missing FIREBASE_* env vars'}`);
  console.log(`   Log level:      ${process.env.LOG_LEVEL || 'info'}\n`);
});
