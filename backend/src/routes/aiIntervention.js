import { Router } from 'express';
import { generateWithActiveProvider } from '../services/aiProviders/index.js';
import { supabase } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, generateInterventionSchema, reviewInterventionSchema } from '../validation/schemas.js';
import { validateParams, uuidParamSchema } from '../middleware/validation.js';
import { logAction } from '../utils/auditLog.js';
import { getReportedStatus, getGapScope, hasEnoughEvidence, MIN_ITEMS_FOR_EVIDENCE } from '../utils/grading.js';

const MASTERY_CUTOFF = 80;

const clip = (text, max = 140) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Per-item evidence for ONE competency: how many students got each item
// right, and which wrong option was chosen most (with its wording when the
// teacher saved answer-choice text). Aggregates only — no student identity
// ever reaches the prompt. This is what lets the AI target the actual
// misconception instead of repeating "students struggle with this topic".
function buildItemInsights(questions, answers) {
  return questions.map((q) => {
    const forItem = answers.filter((a) => a.question_id === q.question_id);
    const answered = forItem.length;
    const correct = forItem.filter((a) => a.is_correct).length;
    const wrongCounts = {};
    for (const a of forItem) {
      if (a.is_correct) continue;
      const choice = (a.student_answer ?? '').trim().toUpperCase() || 'No answer';
      wrongCounts[choice] = (wrongCounts[choice] || 0) + 1;
    }
    const top = Object.entries(wrongCounts).sort((x, y) => y[1] - x[1])[0] ?? null;
    let topWrong = null;
    if (top) {
      const [choice, count] = top;
      const idx = /^[A-Z]$/.test(choice) ? choice.charCodeAt(0) - 65 : -1;
      const optionText = idx >= 0 && Array.isArray(q.options) ? q.options[idx] : null;
      topWrong = { choice, count, optionText: optionText ? clip(optionText, 100) : null };
    }
    return {
      number: q.question_number,
      text: clip(q.question_text, 140),
      correctAnswer: q.correct_answer,
      answered,
      percentCorrect: answered ? Math.round((correct / answered) * 100) : null,
      topWrong,
    };
  });
}

const router = Router();
router.use(requireAuth);

// ── POST /api/ai-intervention/generate ───────────────────────────────────────
// Generates an AI recommendation for the least-mastered competency of an assessment.
// Saved with review_status = 'Pending Review' — it is NOT treated as final
// until a teacher accepts, edits, or rejects it (see PATCH /:id/review below).
// This is what makes "the AI will not replace the professional judgment of
// the educators" (Ch. I, Scope) an enforced workflow rather than a promise.
// Body: { assessmentId, competencyId }
router.post('/generate', validateBody(generateInterventionSchema), async (req, res) => {
  const { assessmentId, competencyId } = req.body;

  // Ownership check: only the creating teacher or an Administrator may generate
  // an intervention for this assessment.
  const { data: ownerCheck, error: ownerErr } = await supabase
    .from('assessments')
    .select('created_by')
    .eq('assessment_id', assessmentId)
    .single();

  if (ownerErr || !ownerCheck) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && ownerCheck.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to access this assessment.' });
  }

  // ── 1. Gather competency performance data ────────────────────────────────
  const { data: results, error: rErr } = await supabase
    .from('competency_results')
    .select(`
      percentage,
      correct_items,
      total_items,
      descriptor
    `)
    .eq('assessment_id', assessmentId)
    .eq('competency_id', competencyId);

  if (rErr || !results?.length) {
    return res.status(404).json({ error: 'No competency results found. Upload CSV scores first.' });
  }

  const { data: competency } = await supabase
    .from('competencies')
    .select('competency_name, description')
    .eq('competency_id', competencyId)
    .single();

  const { data: assessment } = await supabase
    .from('assessments')
    .select('assessment_title, term, assessment_type')
    .eq('assessment_id', assessmentId)
    .single();

  // ── 2. Build weakness summary ────────────────────────────────────────────
  // Status uses the same minimum-evidence rule as the dashboard, so the AI
  // is never told "learning gap" about a competency measured by 2-3 items.
  const totalItems = Math.max(...results.map((r) => Number(r.total_items)));
  const enoughEvidence = hasEnoughEvidence(totalItems);
  const statuses = results.map((r) => getReportedStatus(r.percentage, r.total_items));
  const gapCount = statuses.filter((x) => x === 'Learning Gap').length;
  const assessedCount = results.length;
  const gapScope = enoughEvidence ? getGapScope(gapCount, assessedCount) : 'Insufficient Evidence';
  const pcts = results.map((r) => parseFloat(r.percentage)).sort((x, y) => x - y);
  const avgPct = pcts.reduce((sum, v) => sum + v, 0) / pcts.length;
  const median = pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2;

  // Item-level evidence for this competency only.
  const { data: compQuestions } = await supabase
    .from('questions')
    .select('question_id, question_number, question_text, options, correct_answer')
    .eq('assessment_id', assessmentId)
    .eq('competency_id', competencyId)
    .order('question_number', { ascending: true });
  const questionIds = (compQuestions ?? []).map((q) => q.question_id);
  let compAnswers = [];
  if (questionIds.length) {
    const { data: ansData } = await supabase
      .from('student_answers')
      .select('question_id, student_answer, is_correct')
      .eq('assessment_id', assessmentId)
      .in('question_id', questionIds);
    compAnswers = ansData ?? [];
  }
  const itemInsights = buildItemInsights(compQuestions ?? [], compAnswers);

  const itemLines = itemInsights.map((it) => {
    const wrong = it.topWrong
      ? ` Most common wrong answer: ${it.topWrong.choice}${it.topWrong.optionText ? ` ("${it.topWrong.optionText}")` : ''} (${it.topWrong.count} student${it.topWrong.count === 1 ? '' : 's'}).`
      : '';
    return `  - Item ${it.number}${it.text ? ` — "${it.text}"` : ''}: ${it.percentCorrect ?? 'n/a'}% answered correctly (correct answer: ${it.correctAnswer}).${wrong}`;
  }).join('\n');

  const scopeLine = {
    'Class-wide': `CLASS-WIDE gap — ${gapCount} of ${assessedCount} students are below ${MASTERY_CUTOFF}% (re-teaching the whole class is appropriate).`,
    'Small group': `SMALL-GROUP gap — only ${gapCount} of ${assessedCount} students are below ${MASTERY_CUTOFF}% (targeted support for those students; the rest of the class has the competency).`,
    'None': `No student is below ${MASTERY_CUTOFF}% on this competency.`,
    'Insufficient Evidence': `LIMITED EVIDENCE — this competency was measured by only ${totalItems} item(s) (fewer than ${MIN_ITEMS_FOR_EVIDENCE}), so individual gap labels are not reliable.`,
  }[gapScope];

  const weaknessSummary = `
Assessment: "${assessment.assessment_title}" (${assessment.assessment_type}, ${assessment.term})
Competency: ${competency.competency_name}
Mastery cutoff: ${MASTERY_CUTOFF}% of this competency's items answered correctly
Items measuring this competency: ${totalItems}

Total students assessed: ${assessedCount}
Students below the cutoff (Learning Gap): ${enoughEvidence ? `${gapCount} (${((gapCount / assessedCount) * 100).toFixed(1)}%)` : 'not determined (insufficient evidence)'}
Scope: ${scopeLine}
Average class percentage: ${avgPct.toFixed(1)}% (median ${median.toFixed(1)}%, lowest ${pcts[0].toFixed(1)}%, highest ${pcts[pcts.length - 1].toFixed(1)}%)

Grade Descriptor Breakdown:
${Object.entries(
    results.reduce((acc, r) => {
      acc[r.descriptor] = (acc[r.descriptor] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([d, n]) => `  - ${d}: ${n} student(s)`)
    .join('\n')}

Item-level results for this competency:
${itemLines || '  (no item data available)'}
`.trim();

  // ── 3. Call the configured AI provider ───────────────────────────────────
  let aiRecommendation;
  let providerUsed;
  let modelUsed;
  try {
    const prompt = `You are an educational intervention specialist helping Filipino Grade 6 English teachers address learning gaps. The DepEd MATATAG curriculum is the standard being used.

Respond in English only, regardless of the language of the input data.

Here is the class performance data:

${weaknessSummary}

GROUNDING RULES
- Ground every statement in the data above. Cite item numbers and the most common wrong answers.
- Only name a misconception when the wrong option's wording is shown in the data and supports it. If the wording is not shown, refer to it as "choice C" instead of guessing what it was.
- Infer what each item tests from its question text. If the items clearly measure more than one skill (for example verb tenses inside a "Figures of Speech" competency), say so once in the Analysis and organise the strategies by skill.
- Match the strategies to the Scope line: whole-class re-teaching for a class-wide gap, targeted small-group support for a small-group gap. If the Scope is LIMITED EVIDENCE, say plainly that the result is tentative and recommend re-assessing with more items.
- Do not invent scores, student names, or data that is not shown above.

OUTPUT FORMAT
Write a focused, scannable report of about 750 to 900 words in exactly these four sections, using these markdown headers verbatim. Use plain, practical language for a public school teacher. Never write a paragraph longer than three sentences.

## Analysis
One short paragraph (max 3 sentences) stating the scope, the class average and spread, and what that means for instruction.
Then 3 or 4 bullets. Start each with a short **bold label** (3-6 words), then ONE or TWO sentences citing specific items and the most common wrong answers. Cover: (1) the weakest items or skill, (2) the strongest items or skill, (3) the clearest misconception, and (4) any mix of skills inside this competency.

## Intervention Strategies
Exactly three strategies, ordered by priority (the weakest skill first). Format each one like this:
### 1. Short strategy title (Targets: Items X, Y, Z)
- 3 or 4 bullets, each one concrete classroom step in a single sentence (max 30 words). Include a tiny example sentence, prompt, or activity wherever it helps. Start with the re-teaching move, then guided practice, then independent practice.
**Suggested time:** about N minutes

## Formative Assessment Activities
A numbered list of exactly 4 activities that re-check the weakest items and can be done during class, ordered from quickest to most involved. Each activity is a numbered line with a **bold short title** and a time in parentheses, followed by exactly three indented sub-bullets in this form:
   - **What students do:** one sentence (max 30 words).
   - **Sample prompt:** one ready-to-use example sentence or question built from the items, in quotation marks.
   - **Check for mastery:** one sentence naming the items it re-checks and a simple success target (for example "at least 4 of 5 correct").
Include at least one oral or whole-class check, at least one written check, and at least one that students create something themselves.

## Resources
5 bullets, one per line. Start each with a **bold resource name:**, then say what topic to look up and how the teacher can use it for THIS class's gaps (max 30 words). Use only these kinds of resources, never inventing lesson numbers, page numbers, titles, or URLs:
- DepEd MATATAG Grade 6 English Learner's Material (the relevant grammar or figurative-language topic)
- DepEd MATATAG Grade 6 English Teacher's Guide and Daily Lesson Plan (DLP) for the same topics
- DepEd Commons and DepEd TV (search by topic, such as verb tenses or figures of speech)
- Teacher-made practice built from this test's own items (rewrite the weakest items with new sentences)
- One low-cost classroom aid (such as a tense timeline chart, time-clue word wall, or figure-of-speech sorting cards)

Formatting rules: use only the markdown shown above (## headers, ### strategy headings, bullets, a numbered list with indented sub-bullets, **bold** labels). Do not add extra sections, tables, or a closing remark.`;

    const result = await generateWithActiveProvider(prompt);
    aiRecommendation = result.text;
    providerUsed = result.providerName;
    modelUsed = result.model;
  } catch (aiErr) {
    return res.status(502).json({ error: `AI service error: ${aiErr.message}` });
  }

  // ── 4. Save to interventions table ──────────────────────────────────────
  const { data: saved, error: saveErr } = await supabase
    .from('interventions')
    .insert({
      assessment_id:    assessmentId,
      competency_id:    competencyId,
      generated_by:     req.user.userId,
      weakness_summary: weaknessSummary,
      ai_recommendation: aiRecommendation,
      ai_provider:       providerUsed,
      ai_model:          modelUsed,
    })
    .select('intervention_id, created_at')
    .single();

  if (saveErr) return res.status(500).json({ error: saveErr.message });

  // NOTE: no report record is created here. A recommendation only becomes
  // an official record — and only then shows up in Archives or becomes
  // available in Export — once a teacher explicitly accepts it below (see
  // PATCH /:interventionId/review). Until then it exists only as a
  // 'Pending Review' draft that only this teacher can see on this screen.

  logAction({
    userId:     req.user.userId,
    action:     'AI_INTERVENTION_GENERATE',
    entityType: 'intervention',
    entityId:   saved.intervention_id,
    metadata:   { assessmentId, competencyId, aiProvider: providerUsed, aiModel: modelUsed },
    req,
  });

  return res.status(201).json({
    interventionId:    saved.intervention_id,
    competency:        competency.competency_name,
    weaknessSummary,
    aiRecommendation,
    aiProvider:        providerUsed,
    aiModel:           modelUsed,
    reviewStatus:      'Pending Review',
    generatedAt:       saved.created_at,
  });
});

// ── PATCH /api/ai-intervention/:interventionId/review ─────────────────────────
// Teacher review step: every AI-generated recommendation starts as
// 'Pending Review' and must be explicitly Accepted, Edited (with the
// teacher's own final wording), or Rejected before it is treated as the
// assessment's official intervention in exports/reports. This directly
// answers "what if the AI recommendation is wrong?" — a teacher catches and
// corrects it here, rather than it silently reaching a report unreviewed.
// Body: { status: 'Accepted' | 'Edited' | 'Rejected', finalRecommendation? }
router.patch('/:interventionId/review', validateParams(uuidParamSchema('interventionId')), validateBody(reviewInterventionSchema), async (req, res) => {
  const { status, finalRecommendation } = req.body;

  const { data: intervention, error: ivErr } = await supabase
    .from('interventions')
    .select(`
      intervention_id,
      assessment_id,
      competency_id,
      review_status,
      assessments (created_by, assessment_title),
      competencies (competency_name)
    `)
    .eq('intervention_id', req.params.interventionId)
    .single();

  if (ivErr || !intervention) return res.status(404).json({ error: 'Intervention not found.' });
  if (req.user.role !== 'Administrator' && intervention.assessments?.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to review this intervention.' });
  }

  const updates = {
    review_status: status,
    reviewed_by:   req.user.userId,
    reviewed_at:   new Date().toISOString(),
    final_recommendation: status === 'Edited' ? finalRecommendation : null,
  };

  const { data: updated, error: updErr } = await supabase
    .from('interventions')
    .update(updates)
    .eq('intervention_id', req.params.interventionId)
    .select('intervention_id, review_status, final_recommendation, reviewed_at')
    .single();

  if (updErr) return res.status(500).json({ error: updErr.message });

  // A recommendation only becomes an official record — appearing in
  // Archives and becoming available for export on the Export tab — the
  // moment a teacher explicitly Accepts or Edits it here. Guard against
  // creating a duplicate report if this intervention was already
  // Accepted/Edited once before (e.g. a repeat API call) by only inserting
  // when it's transitioning INTO an accepted state for the first time.
  const wasAlreadyFinalized = intervention.review_status === 'Accepted' || intervention.review_status === 'Edited';
  if ((status === 'Accepted' || status === 'Edited') && !wasAlreadyFinalized) {
    const { error: reportErr } = await supabase.from('reports').insert({
      assessment_id:   intervention.assessment_id,
      intervention_id: intervention.intervention_id,
      generated_by:    req.user.userId,
      report_type:     'AI Recommendation',
      report_title:    `${intervention.assessments?.assessment_title ?? 'Assessment'} – AI Intervention (${intervention.competencies?.competency_name ?? 'Competency'})`,
    });
    // A unique-violation here just means a report for this intervention
    // already exists (e.g. a duplicate request) — not a real failure.
    if (reportErr && reportErr.code !== '23505') {
      console.error('[ai-intervention] Failed to log report on accept:', reportErr.message);
    }
  }

  // When a teacher rejects an intervention that was previously Accepted or
  // Edited, the earlier reports row must be removed so the recommendation
  // stops appearing in Archives and is no longer exportable. Without this
  // cleanup the rejection is recorded on the intervention row but the report
  // entry lives on — silently contradicting the teacher's decision.
  if (status === 'Rejected' && wasAlreadyFinalized) {
    const { error: delReportErr } = await supabase
      .from('reports')
      .delete()
      .eq('intervention_id', intervention.intervention_id);
    if (delReportErr) {
      console.error('[ai-intervention] Failed to retract report on reject:', delReportErr.message);
    }
  }

  logAction({
    userId:     req.user.userId,
    action:     'AI_INTERVENTION_REVIEW',
    entityType: 'intervention',
    entityId:   req.params.interventionId,
    metadata:   { status },
    req,
  });

  return res.json({
    message: `Recommendation marked as ${status}.`,
    interventionId: updated.intervention_id,
    reviewStatus:   updated.review_status,
    finalRecommendation: updated.final_recommendation,
    reviewedAt:     updated.reviewed_at,
  });
});

// ── GET /api/ai-intervention/:assessmentId/competency-breakdown ──────────────
// Identifies every competency actually covered by this assessment (i.e. that
// has at least one question tagged with it) and performs a competency-level
// score analysis for each — average percentage, mastered vs. Learning Gap
// counts — so the AI Intervention screen can be driven by what this specific
// unit test/assessment covers instead of the global competency taxonomy.
// `isMultiCompetency` flags assessments (e.g. one mixing "Figures of Speech"
// and "Tenses of Verbs" items) that need per-competency handling rather than
// a single assessment-wide recommendation. `hasLearningGap` on each entry is
// what the UI uses to know which competencies actually need an
// AI-generated intervention drafted for them.
router.get('/:assessmentId/competency-breakdown', validateParams(uuidParamSchema('assessmentId')), async (req, res) => {
  const { assessmentId } = req.params;

  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, assessment_title, assessment_type, term, created_by')
    .eq('assessment_id', assessmentId)
    .single();

  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to access this assessment.' });
  }

  const { data: results, error: rErr } = await supabase
    .from('competency_results')
    .select(`
      competency_id,
      percentage,
      total_items,
      competencies (competency_name)
    `)
    .eq('assessment_id', assessmentId);

  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!results?.length) {
    return res.status(404).json({ error: 'No competency results found. Upload CSV scores first.' });
  }

  // The most recent intervention already generated per competency (any
  // status) — lets the UI show "already generated" instead of inviting a
  // teacher to draft a duplicate for a competency they already handled.
  const { data: existing, error: ivErr } = await supabase
    .from('interventions')
    .select('competency_id, intervention_id, review_status, created_at')
    .eq('assessment_id', assessmentId)
    .order('created_at', { ascending: false });
  if (ivErr) return res.status(500).json({ error: ivErr.message });

  const latestByCompetency = {};
  for (const iv of existing ?? []) {
    if (!latestByCompetency[iv.competency_id]) latestByCompetency[iv.competency_id] = iv;
  }

  const byCompetency = {};
  for (const r of results) {
    const cid = r.competency_id;
    if (!byCompetency[cid]) {
      byCompetency[cid] = {
        competencyId:   cid,
        competencyName: r.competencies?.competency_name ?? 'Unknown competency',
        totalStudents:  0,
        masteredCount:  0,
        learningGapCount: 0,
        insufficientCount: 0,
        totalItems: 0,
        sumPct: 0,
      };
    }
    byCompetency[cid].totalStudents += 1;
    byCompetency[cid].sumPct += parseFloat(r.percentage);
    byCompetency[cid].totalItems = Math.max(byCompetency[cid].totalItems, Number(r.total_items));
    // Same minimum-evidence rule as the dashboard (see utils/grading.js).
    const status = getReportedStatus(r.percentage, r.total_items);
    if (status === 'Learning Gap') byCompetency[cid].learningGapCount += 1;
    else if (status === 'Insufficient Evidence') byCompetency[cid].insufficientCount += 1;
    else byCompetency[cid].masteredCount += 1;
  }

  const competencies = Object.values(byCompetency)
    .map((c) => {
      const latest = latestByCompetency[c.competencyId];
      return {
        competencyId:      c.competencyId,
        competencyName:    c.competencyName,
        totalStudents:     c.totalStudents,
        masteredCount:     c.masteredCount,
        learningGapCount:  c.learningGapCount,
        totalItems:        c.totalItems,
        insufficientEvidence: !hasEnoughEvidence(c.totalItems),
        learningGapPercentage: hasEnoughEvidence(c.totalItems)
          ? parseFloat(((c.learningGapCount / c.totalStudents) * 100).toFixed(1))
          : null,
        // 'Class-wide' (>= half the students below 80%) | 'Small group' | 'None' | 'Insufficient Evidence'
        gapScope:          hasEnoughEvidence(c.totalItems) ? getGapScope(c.learningGapCount, c.totalStudents) : 'Insufficient Evidence',
        averagePercentage: parseFloat((c.sumPct / c.totalStudents).toFixed(2)),
        // Only true when there are enough items for the label to be trusted.
        hasLearningGap:    hasEnoughEvidence(c.totalItems) && c.learningGapCount > 0,
        latestIntervention: latest
          ? { interventionId: latest.intervention_id, reviewStatus: latest.review_status, createdAt: latest.created_at }
          : null,
      };
    })
    // Weakest competencies first — those most needing an intervention surface at the top.
    .sort((a, b) => a.averagePercentage - b.averagePercentage);

  return res.json({
    assessmentId,
    assessmentTitle: assessment.assessment_title,
    isMultiCompetency: competencies.length >= 2,
    competencies,
  });
});

// ── GET /api/ai-intervention ──────────────────────────────────────────────────
// Lists every AI intervention across all of the teacher's assessments (or,
// for Administrators, across every teacher's assessments). Used by the
// Archives page as the full history of past AI recommendations.
router.get('/', async (req, res) => {
  let query = supabase
    .from('interventions')
    .select(`
      intervention_id,
      competency_id,
      weakness_summary,
      ai_recommendation,
      ai_provider,
      ai_model,
      review_status,
      final_recommendation,
      reviewed_at,
      created_at,
      competencies (competency_name),
      assessments!inner (
        assessment_id,
        assessment_title,
        assessment_type,
        term,
        created_by,
        users (first_name, last_name)
      )
    `)
    // Archives is the record of finalized recommendations only. A teacher
    // must have explicitly Accepted (or Edited) a recommendation for it to
    // land here — anything still "Pending Review" (e.g. the teacher
    // navigated away without deciding) or "Rejected" is excluded.
    .in('review_status', ['Accepted', 'Edited'])
    .order('created_at', { ascending: false });

  if (req.user.role !== 'Administrator') {
    query = query.eq('assessments.created_by', req.user.userId);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const shaped = (data ?? []).map((row) => ({
    interventionId:   row.intervention_id,
    competencyId:     row.competency_id,
    weaknessSummary:  row.weakness_summary,
    aiRecommendation: row.ai_recommendation,
    aiProvider:       row.ai_provider,
    aiModel:          row.ai_model,
    reviewStatus:      row.review_status,
    finalRecommendation: row.final_recommendation,
    reviewedAt:        row.reviewed_at,
    createdAt:        row.created_at,
    competencyName:   row.competencies?.competency_name ?? 'Unknown competency',
    assessmentId:      row.assessments?.assessment_id,
    assessmentTitle:   row.assessments?.assessment_title ?? 'Untitled assessment',
    assessmentType:    row.assessments?.assessment_type,
    term:              row.assessments?.term,
    teacherName: row.assessments?.users
      ? `${row.assessments.users.first_name} ${row.assessments.users.last_name}`
      : null,
  }));

  return res.json(shaped);
});

// ── GET /api/ai-intervention/:assessmentId ────────────────────────────────────
// Lists all previously generated interventions for an assessment.
router.get('/:assessmentId', validateParams(uuidParamSchema('assessmentId')), async (req, res) => {
  // Ownership check: only the creating teacher or an Administrator may view
  // interventions for this assessment.
  const { data: ownerCheck, error: ownerErr } = await supabase
    .from('assessments')
    .select('created_by')
    .eq('assessment_id', req.params.assessmentId)
    .single();

  if (ownerErr || !ownerCheck) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && ownerCheck.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to access this assessment.' });
  }

  const { data, error } = await supabase
    .from('interventions')
    .select(`
      intervention_id,
      weakness_summary,
      ai_recommendation,
      ai_provider,
      ai_model,
      review_status,
      final_recommendation,
      reviewed_at,
      created_at,
      competencies (competency_name)
    `)
    .eq('assessment_id', req.params.assessmentId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

export default router;
