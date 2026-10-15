import { z } from 'zod';

/**
 * Express middleware factory: validates req.params against a zod schema,
 * the same way validateBody validates req.body. Catches malformed IDs
 * (typos, SQL-injection-shaped strings, etc.) before they reach a Supabase
 * query, with a clean 400 instead of a raw DB error leaking through.
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.') || 'param'}: ${i.message}`);
      return res.status(400).json({ error: issues.join('; ') });
    }
    req.params = result.data;
    next();
  };
}

/** Reusable schema: a single :id-style route param that must be a UUID. */
export function uuidParamSchema(paramName = 'id') {
  return z.object({ [paramName]: z.string().uuid(`${paramName} must be a valid UUID.`) });
}
