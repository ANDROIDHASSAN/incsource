// Tiny structured logger — JSON lines in production (machine-parseable for log
// aggregators), pretty-ish in dev. Zero dependencies; swap for pino later if needed.
const isProd = process.env.NODE_ENV === 'production';

function emit(level, msg, fields = {}) {
  const rec = { level, msg, time: new Date().toISOString(), ...fields };
  const line = isProd ? JSON.stringify(rec) : `${rec.time} ${level.toUpperCase()} ${msg} ${Object.keys(fields).length ? JSON.stringify(fields) : ''}`.trim();
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const log = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};
