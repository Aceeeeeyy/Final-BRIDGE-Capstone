import jwt from 'jsonwebtoken';
import { supabase } from '../supabaseClient.js';

/**
 * Verifies the Bearer JWT sent by the frontend.
 * Attaches decoded payload to req.user = { userId, role, schoolName, email }
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Restricts an endpoint to a specific role.
 * Usage: router.get('/admin-only', requireAuth, requireRole('Administrator'), handler)
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: `Access denied. Requires role: ${role}` });
    }
    next();
  };
}

/**
 * Single source of truth for "may this user touch data created by `ownerId`?"
 *  - Teacher: only their own records.
 *  - Administrator: only records created by users of THEIR OWN school
 *    (school comes from the signed JWT, never from the request).
 * Fails closed: unknown owner, missing school, or a query error => false.
 */
export async function canAccessOwner(user, ownerId) {
  if (!user || !ownerId) return false;
  if (user.role !== 'Administrator') return ownerId === user.userId;
  if (!user.schoolName) return false;
  const { data, error } = await supabase
    .from('users')
    .select('school_name')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (error || !data) return false;
  return data.school_name === user.schoolName;
}

/**
 * True when the competency exists and belongs to `schoolName`.
 * Schools are independent, so a question may only use a competency of the
 * same school as the assessment's owner.
 */
export async function competencyInSchool(competencyId, schoolName) {
  if (!competencyId || !schoolName) return false;
  const { data, error } = await supabase
    .from('competencies')
    .select('competency_id')
    .eq('competency_id', competencyId)
    .eq('school_name', schoolName)
    .maybeSingle();
  return !error && Boolean(data);
}
