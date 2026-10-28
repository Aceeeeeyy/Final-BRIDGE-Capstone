import { Router } from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, createCompetencySchema, updateCompetencySchema } from '../validation/schemas.js';
import { validateParams, uuidParamSchema } from '../middleware/validation.js';
import { logAction } from '../utils/auditLog.js';

const router = Router();
router.use(requireAuth);

// Every competency belongs to ONE school (competencies.school_name). Schools are
// independent: users only ever see and change their own school's list, and the
// school always comes from the signed JWT, never from the request body.
// ── GET /api/competencies ─────────────────────────────────────────────────────
// Returns active competencies used to populate the QuestionBuilder and AI
// Intervention selectors. The study itself scopes BRIDGE to two MATATAG
// competencies (Tenses of Verbs, Figures of Speech), but the taxonomy is no
// longer hardcoded — Administrators can add/retire competencies below,
// which is what lets the same system generalize to other English domains
// (Reading Comprehension, Vocabulary, etc.) beyond this capstone's scope
// without a code change.
// Pass ?includeInactive=true (Administrator only) to see retired ones too.
router.get('/', async (req, res) => {
  let query = supabase
    .from('competencies')
    .select('competency_id, competency_name, description, is_active, created_at')
    .eq('school_name', req.user.schoolName)
    .order('competency_name', { ascending: true });

  const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'Administrator';
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── POST /api/competencies ────────────────────────────────────────────────────
// Administrator only. Adds a new competency to the taxonomy.
// Body: { competencyName, description? }
router.post('/', requireRole('Administrator'), validateBody(createCompetencySchema), async (req, res) => {
  const { competencyName, description } = req.body;

  const { data, error } = await supabase
    .from('competencies')
    .insert({ competency_name: competencyName, description: description || null, created_by: req.user.userId, school_name: req.user.schoolName })
    .select('competency_id, competency_name, description, is_active, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A competency with this name already exists.' });
    return res.status(500).json({ error: error.message });
  }

  logAction({ userId: req.user.userId, action: 'COMPETENCY_CREATE', entityType: 'competency', entityId: data.competency_id, metadata: { competencyName }, req });

  return res.status(201).json(data);
});

// ── PATCH /api/competencies/:id ───────────────────────────────────────────────
// Administrator only. Edits a competency's name/description, or toggles
// isActive to retire/restore it. Retiring (rather than deleting) preserves
// history for every question and result that already references it.
// Body: { competencyName?, description?, isActive? }
router.patch('/:id', requireRole('Administrator'), validateParams(uuidParamSchema('id')), validateBody(updateCompetencySchema), async (req, res) => {
  const updates = {};
  if (req.body.competencyName !== undefined) updates.competency_name = req.body.competencyName;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  const { data, error } = await supabase
    .from('competencies')
    .update(updates)
    .eq('competency_id', req.params.id)
    .eq('school_name', req.user.schoolName)
    .select('competency_id, competency_name, description, is_active, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A competency with this name already exists.' });
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Competency not found.' });

  logAction({ userId: req.user.userId, action: 'COMPETENCY_UPDATE', entityType: 'competency', entityId: req.params.id, metadata: updates, req });

  return res.json(data);
});

// ── DELETE /api/competencies/:id ──────────────────────────────────────────────
// Administrator only. Soft-deletes (is_active = false) rather than a hard
// DELETE — questions and competency_results reference competency_id, so a
// hard delete would either fail on the foreign key or silently orphan
// historical data. Use PATCH { isActive: true } to restore.
router.delete('/:id', requireRole('Administrator'), validateParams(uuidParamSchema('id')), async (req, res) => {
  const { data, error } = await supabase
    .from('competencies')
    .update({ is_active: false })
    .eq('competency_id', req.params.id)
    .eq('school_name', req.user.schoolName)
    .select('competency_id')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Competency not found.' });

  logAction({ userId: req.user.userId, action: 'COMPETENCY_RETIRE', entityType: 'competency', entityId: req.params.id, req });

  return res.json({ message: 'Competency retired.' });
});

export default router;
