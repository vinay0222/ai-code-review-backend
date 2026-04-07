/**
 * Structured JSON logger.
 *
 * Each log line is a single JSON object — easy to pipe into log aggregators
 * (Datadog, CloudWatch, Logtail, etc.) or just read in dev with `| jq`.
 *
 * Level order:  debug < info < warn < error
 * Set LOG_LEVEL env var to control minimum level (default: "info").
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN    = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 1;

function emit(level, event, context = {}) {
  if (LEVELS[level] < MIN) return;

  // Serialise Error objects cleanly
  const ctx = {};
  for (const [k, v] of Object.entries(context)) {
    if (v instanceof Error) {
      ctx[k] = { message: v.message, stack: v.stack?.split('\n')[1]?.trim() };
    } else {
      ctx[k] = v;
    }
  }

  const entry = {
    ts:    new Date().toISOString(),
    level: level.toUpperCase(),
    event,
    ...ctx,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  debug: (event, ctx) => emit('debug', event, ctx),
  info:  (event, ctx) => emit('info',  event, ctx),
  warn:  (event, ctx) => emit('warn',  event, ctx),
  error: (event, ctx) => emit('error', event, ctx),
};
