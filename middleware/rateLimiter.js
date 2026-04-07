const rateLimit = require('express-rate-limit');
const logger    = require('../logger');

/**
 * Factory — creates a rate limiter with shared options and structured logging.
 */
function makeLimit({ name, windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return RateLimit-* headers
    legacyHeaders:   false,
    message:         { error: message },
    handler(req, res, _next, options) {
      logger.warn('rate_limit.hit', {
        name,
        ip:     req.ip,
        path:   req.path,
        method: req.method,
        userId: req.userId || null,
      });
      res.status(429).json(options.message);
    },
  });
}

/**
 * Global limiter — applied to every request.
 * Generous enough for normal dashboard use.
 */
const globalLimiter = makeLimit({
  name:      'global',
  windowMs:  15 * 60 * 1000, // 15 minutes
  max:       200,
  message:   'Too many requests. Please try again in 15 minutes.',
});

/**
 * Auth limiter — applied to /auth/* routes.
 * Prevents OAuth code-exchange abuse and brute-forcing.
 */
const authLimiter = makeLimit({
  name:      'auth',
  windowMs:  15 * 60 * 1000,
  max:       20,
  message:   'Too many authentication requests. Please try again in 15 minutes.',
});

/**
 * Review limiter — applied to POST /review.
 * Protects against runaway AI cost and GitHub API quota exhaustion.
 */
const reviewLimiter = makeLimit({
  name:      'review',
  windowMs:  60 * 60 * 1000, // 1 hour
  max:       30,
  message:   'Review limit reached (30/hour). Please wait before running more reviews.',
});

/**
 * Comment limiter — applied to POST /comment.
 */
const commentLimiter = makeLimit({
  name:      'comment',
  windowMs:  60 * 60 * 1000,
  max:       60,
  message:   'Comment posting limit reached (60/hour).',
});

module.exports = { globalLimiter, authLimiter, reviewLimiter, commentLimiter };
