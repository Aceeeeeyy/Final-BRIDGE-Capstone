import { supabase } from '../supabaseClient.js';

/**
 * Writes one row to audit_logs. Fire-and-forget by design: an audit-log
 * failure should never block or fail the action it's describing (a CSV
 * upload succeeding is more important than the log of it succeeding), so
 * this only logs a console warning if the insert itself fails.
 *
 * @param {{ userId?: string|null, action: string, entityType?: string, entityId?: string|null, metadata?: object, req?: import('express').Request }} params
 */
export function logAction({ userId = null, action, entityType = null, entityId = null, metadata = {}, req = null }) {
  const ipAddress = req
    ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null)
    : null;

  supabase
    .from('audit_logs')
    .insert({
      user_id:     userId,
      action,
      entity_type: entityType,
      entity_id:   entityId,
      metadata,
      ip_address:  ipAddress,
    })
    .then(({ error }) => {
      if (error) console.error('[audit_logs] insert failed:', error.message);
    });
}
