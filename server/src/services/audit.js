// Audit trail for sensitive actions (exports, deletes, key changes, invites).
// A hiring product handles personal data, so "who did what, when" must be
// recorded. Emitted as structured logs today; point `sink` at a DB/SIEM later
// without touching call sites.
import { log } from './logger.js';

export function audit(req, action, meta = {}) {
  log.info(`audit:${action}`, {
    audit: true,
    action,
    actor: req?.user?.sub || null,
    actorEmail: req?.user?.email || null,
    orgId: req?.user?.orgId || null,
    ip: req?.ip || null,
    requestId: req?.id || null,
    ...meta,
  });
}
