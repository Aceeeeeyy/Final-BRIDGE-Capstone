import jwt from 'jsonwebtoken';

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
