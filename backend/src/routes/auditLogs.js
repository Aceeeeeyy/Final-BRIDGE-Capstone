import { Router } from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('Administrator'));

// ── GET /api/audit-logs ────────────────────────────────────────────────────────
// Administrator-only. Returns the most recent activity across the school —
// logins, CSV uploads, AI intervention generations/reviews, and competency
// changes — for RA 10173 accountability review. Supports simple pagination
// via ?limit=&offset= and optional ?action= filtering.
router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let query = supabase
    .from('audit_logs')
    .select(`
      log_id,
      action,
      entity_type,
      entity_id,
      metadata,
      ip_address,
      created_at,
      users (first_name, last_name, email, role)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (req.query.action) query = query.eq('action', req.query.action);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const shaped = (data ?? []).map((row) => ({
    logId:      row.log_id,
    action:     row.action,
    entityType: row.entity_type,
    entityId:   row.entity_id,
    metadata:   row.metadata,
    ipAddress:  row.ip_address,
    createdAt:  row.created_at,
    actor: row.users
      ? { name: `${row.users.first_name} ${row.users.last_name}`, email: row.users.email, role: row.users.role }
      : null,
  }));

  return res.json(shaped);
});

export default router;
