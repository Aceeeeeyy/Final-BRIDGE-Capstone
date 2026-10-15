import { Router } from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import {
  validateBody,
  createAssessmentSchema,
  updateAssessmentSchema,
  createQuestionSchema,
  updateQuestionSchema,
} from '../validation/schemas.js';
import { validateParams, uuidParamSchema } from '../middleware/validation.js';
import { z } from 'zod';
import { computeSchoolYear } from '../utils/grading.js';

const idAndQuestionIdSchema = z.object({
  id:         z.string().uuid('id must be a valid UUID.'),
  questionId: z.string().uuid('questionId must be a valid UUID.'),
});

const router = Router();
router.use(requireAuth);

const ASSESSMENT_TYPES = ['Summative Test', 'Term Examination'];
const TERMS = ['Term 1', 'Term 2', 'Term 3'];

// Statuses in which a test's title/questions/answer key may still be changed.
// 'Ready for Upload' is safe to edit because no scores exist yet (upload.js only
// flips a test to 'Completed' once a CSV has actually been processed). Once
// 'Completed', the answer key is baked into graded results, so it stays locked.
const EDITABLE_STATUSES = ['Draft', 'Ready for Upload'];
const LOCKED_MSG = 'This test already has scores uploaded and can no longer be edited.';

// Loads an assessment and checks ownership. Writes a response + returns null
// on failure so callers can just `if (!assessment) return;`.
async function loadOwnedAssessment(req, res, id) {
  const { data: assessment, error } = await supabase
    .from('assessments')
    .select('*')
    .eq('assessment_id', id)
    .single();

  if (error || !assessment) {
    res.status(404).json({ error: 'Assessment not found.' });
    return null;
  }
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    res.status(403).json({ error: 'You do not own this assessment.' });
    return null;
  }
  return assessment;
}

async function countQuestions(assessmentId) {
  const { count } = await supabase
    .from('questions')
    .select('question_id', { count: 'exact', head: true })
    .eq('assessment_id', assessmentId);
  return count ?? 0;
}

// Returns the highest question_number currently in use for an assessment,
// or 0 if none exist. Used to derive the next question_number without
// colliding after a deletion (COUNT would reuse an existing number once
// there are gaps in the sequence; MAX+1 never does).
async function maxQuestionNumber(assessmentId) {
  const { data } = await supabase
    .from('questions')
    .select('question_number')
    .eq('assessment_id', assessmentId)
    .order('question_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.question_number ?? 0;
}

// ── POST /api/assessments ─────────────────────────────────────────────────────
// Creates a new DRAFT assessment immediately — before a single question has
// been written. This is what makes it safe to exit mid-creation: from this
// point on the test exists in the database, not just in the browser tab.
// Body: { assessmentTitle?, assessmentType, term }
router.post('/', validateBody(createAssessmentSchema), async (req, res) => {
  const { assessmentTitle, assessmentType, term, schoolYear } = req.body;

  const { data: assessment, error } = await supabase
    .from('assessments')
    .insert({
      assessment_title: assessmentTitle?.trim() || 'Untitled test',
      assessment_type: assessmentType,
      term,
      school_year: schoolYear || computeSchoolYear(new Date()),
      total_items: 0,
      status: 'Draft',
      created_by: req.user.userId,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json({
    message: 'Draft created.',
    assessmentId: assessment.assessment_id,
    status: assessment.status,
  });
});

// ── PATCH /api/assessments/:id ────────────────────────────────────────────────
// Autosaves draft metadata (title / type / term) as the teacher types.
// Allowed while the assessment is a Draft or Ready for Upload (not Completed).
router.patch('/:id', validateParams(uuidParamSchema('id')), validateBody(updateAssessmentSchema), async (req, res) => {
  const assessment = await loadOwnedAssessment(req, res, req.params.id);
  if (!assessment) return;

  if (!EDITABLE_STATUSES.includes(assessment.status)) {
    return res.status(400).json({ error: LOCKED_MSG });
  }

  const updates = { updated_at: new Date().toISOString() };

  if (req.body.assessmentTitle !== undefined) {
    updates.assessment_title = req.body.assessmentTitle.trim() || 'Untitled test';
  }
  if (req.body.assessmentType !== undefined) {
    updates.assessment_type = req.body.assessmentType;
  }
  if (req.body.term !== undefined) {
    updates.term = req.body.term;
  }
  if (req.body.schoolYear !== undefined) {
    updates.school_year = req.body.schoolYear;
  }

  const { error } = await supabase.from('assessments').update(updates).eq('assessment_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ message: 'Draft saved.' });
});

// ── POST /api/assessments/:id/questions ───────────────────────────────────────
// Saves ONE question to the database immediately. Called every time the
// teacher clicks "Add Question" in the builder — this is the autosave.
// Body: { questionText?, competencyId, correctAnswer }
router.post('/:id/questions', validateParams(uuidParamSchema('id')), validateBody(createQuestionSchema), async (req, res) => {
  const assessment = await loadOwnedAssessment(req, res, req.params.id);
  if (!assessment) return;

  if (!EDITABLE_STATUSES.includes(assessment.status)) {
    return res.status(400).json({ error: LOCKED_MSG });
  }

  const { questionText, competencyId, correctAnswer, options } = req.body;

  // Use MAX(question_number)+1 so gaps left by deleted questions don't cause
  // a UNIQUE(assessment_id, question_number) violation. COUNT(*)+1 would
  // collide if, e.g., questions 1–5 exist, #2 is deleted (count = 4), and
  // the next insert tries question_number = 5 which already exists.
  const nextNumber    = (await maxQuestionNumber(assessment.assessment_id)) + 1;
  const existingCount = await countQuestions(assessment.assessment_id);

  const { data: question, error } = await supabase
    .from('questions')
    .insert({
      assessment_id: assessment.assessment_id,
      question_number: nextNumber,
      question_text: questionText ?? null,
      options: options ?? null,
      competency_id: competencyId,
      correct_answer: correctAnswer,
    })
    .select('question_id, question_number, question_text, options, competency_id, correct_answer')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase
    .from('assessments')
    .update({ total_items: existingCount + 1, updated_at: new Date().toISOString() })
    .eq('assessment_id', assessment.assessment_id);

  return res.status(201).json({ message: 'Question saved.', question });
});

// ── PATCH /api/assessments/:id/questions/:questionId ──────────────────────────
// Edits a previously-saved question. Draft / Ready for Upload only.
router.patch('/:id/questions/:questionId', validateParams(idAndQuestionIdSchema), validateBody(updateQuestionSchema), async (req, res) => {
  const assessment = await loadOwnedAssessment(req, res, req.params.id);
  if (!assessment) return;

  if (!EDITABLE_STATUSES.includes(assessment.status)) {
    return res.status(400).json({ error: LOCKED_MSG });
  }

  const { questionText, competencyId, correctAnswer, options } = req.body;
  const updates = {};
  if (questionText !== undefined) updates.question_text = questionText;
  if (competencyId !== undefined) updates.competency_id = competencyId;
  if (correctAnswer !== undefined) updates.correct_answer = correctAnswer;
  if (options !== undefined) updates.options = options;

  const { data: question, error } = await supabase
    .from('questions')
    .update(updates)
    .eq('question_id', req.params.questionId)
    .eq('assessment_id', assessment.assessment_id)
    .select('question_id, question_number, question_text, options, competency_id, correct_answer')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('assessments').update({ updated_at: new Date().toISOString() }).eq('assessment_id', assessment.assessment_id);

  return res.json({ message: 'Question updated.', question });
});

// ── DELETE /api/assessments/:id/questions/:questionId ─────────────────────────
// Removes a question and renumbers total_items. Draft / Ready for Upload only.
router.delete('/:id/questions/:questionId', validateParams(idAndQuestionIdSchema), async (req, res) => {
  const assessment = await loadOwnedAssessment(req, res, req.params.id);
  if (!assessment) return;

  if (!EDITABLE_STATUSES.includes(assessment.status)) {
    return res.status(400).json({ error: LOCKED_MSG });
  }

  const { error } = await supabase
    .from('questions')
    .delete()
    .eq('question_id', req.params.questionId)
    .eq('assessment_id', assessment.assessment_id);

  if (error) return res.status(500).json({ error: error.message });

  const remaining = await countQuestions(assessment.assessment_id);
  await supabase
    .from('assessments')
    .update({ total_items: remaining, updated_at: new Date().toISOString() })
    .eq('assessment_id', assessment.assessment_id);

  return res.json({ message: 'Question removed.', remaining });
});

// ── PATCH /api/assessments/:id/publish ────────────────────────────────────────
// Locks the draft in as a real test: from here it moves to "Ready for Upload"
// and shows up on the Upload tab ready to receive a CSV of scores — at any
// point in the future, from any device, regardless of who is logged in when
// the CSV eventually gets uploaded.
router.patch('/:id/publish', validateParams(uuidParamSchema('id')), async (req, res) => {
  const assessment = await loadOwnedAssessment(req, res, req.params.id);
  if (!assessment) return;

  if (assessment.status !== 'Draft') {
    return res.status(400).json({ error: 'This test has already been published.' });
  }
  if (!assessment.assessment_title || assessment.assessment_title === 'Untitled test') {
    return res.status(400).json({ error: 'Give this test a title before publishing.' });
  }

  const questionCount = await countQuestions(assessment.assessment_id);
  if (questionCount === 0) {
    return res.status(400).json({ error: 'Add at least one question before publishing.' });
  }

  const { error } = await supabase
    .from('assessments')
    .update({ status: 'Ready for Upload', total_items: questionCount, updated_at: new Date().toISOString() })
    .eq('assessment_id', assessment.assessment_id);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ message: 'Test published. You can upload its CSV scores any time, even later.' });
});

// ── GET /api/assessments ──────────────────────────────────────────────────────
// Lists every assessment for the "My Tests" panel — drafts, published tests
// awaiting scores, and completed ones — so a teacher can always find their
// way back regardless of what device or session they started it on.
router.get('/', async (req, res) => {
  let query = supabase
    .from('assessments')
    .select(`
      assessment_id,
      assessment_title,
      assessment_type,
      term,
      school_year,
      total_items,
      status,
      created_at,
      updated_at,
      users (first_name, last_name),
      questions (count)
    `)
    .order('updated_at', { ascending: false });

  if (req.user.role === 'Teacher') {
    query = query.eq('created_by', req.user.userId);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const withCounts = (data || []).map((a) => ({
    ...a,
    question_count: a.questions?.[0]?.count ?? 0,
    questions: undefined,
  }));

  return res.json(withCounts);
});

// ── GET /api/assessments/:id ───────────────────────────────────────────────────
// Gets a single assessment with its questions (used to resume a draft or to
// review a published/completed one).
router.get('/:id', validateParams(uuidParamSchema('id')), async (req, res) => {
  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('*')
    .eq('assessment_id', req.params.id)
    .single();
  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });

  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to view this assessment.' });
  }

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select(`
      question_id,
      question_number,
      question_text,
      options,
      correct_answer,
      competencies (competency_id, competency_name)
    `)
    .eq('assessment_id', req.params.id)
    .order('question_number', { ascending: true });

  if (qErr) return res.status(500).json({ error: qErr.message });

  return res.json({ ...assessment, questions });
});

// ── DELETE /api/assessments/:id ───────────────────────────────────────────────
// Hard-delete: only the creator (teacher) or an admin may delete. Allowed for
// Draft and Ready for Upload tests. Completed tests are refused, because
// deleting one cascades to every score, competency result, intervention and
// report tied to it. Note: this is
// a permanent deletion (not a soft-delete); see data-privacy write-up §3 for
// rationale — a hard delete is more privacy-protective than retaining a
// "deleted" row, since it leaves no lingering record.
router.delete('/:id', validateParams(uuidParamSchema('id')), async (req, res) => {
  // Verify ownership
  const { data: assessment, error } = await supabase
    .from('assessments')
    .select('created_by, status')
    .eq('assessment_id', req.params.id)
    .single();

  if (error || !assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to delete this assessment.' });
  }

  if (assessment.status === 'Completed') {
    return res.status(400).json({ error: "Tests with uploaded scores can't be deleted." });
  }

  const { error: delErr } = await supabase
    .from('assessments')
    .delete()
    .eq('assessment_id', req.params.id);

  if (delErr) return res.status(500).json({ error: delErr.message });
  return res.json({ message: 'Assessment deleted.' });
});

export default router;
