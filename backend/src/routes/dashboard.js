import { Router } from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateParams, uuidParamSchema } from '../middleware/validation.js';
import {
  getReportedStatus,
  getGapScope,
  rankForDiscrimination,
  pooledPercentage,
  hasEnoughEvidence,
  MIN_ITEMS_FOR_EVIDENCE,
  MIN_STUDENTS_FOR_DISCRIMINATION,
  RELIABLE_STUDENTS_FOR_DISCRIMINATION,
} from '../utils/grading.js';

const router = Router();
router.use(requireAuth);

const TERM_ORDER = ['Term 1', 'Term 2', 'Term 3'];

// ── GET /api/dashboard/trends ──────────────────────────────────────────────────
// Longitudinal view: mastery of ONE competency per school year + term, for one
// student (?studentId=) or the whole class/teacher's students.
//
// How the number is computed (fixed after the math review):
//   averagePercentage = SUM(correct_items) / SUM(total_items) x 100
// i.e. every ITEM counts once. The old version averaged each result's own
// percentage, so a 2-item quiz weighed as much as a 20-item exam and could
// swing the trend by 15+ points.
//
// Points are grouped by school year AND term, so Term 1 of 2025-2026 is no
// longer merged with Term 1 of 2026-2027. Optional filters: ?schoolYear= and
// ?section= (section comes from ZipGrade's class name at upload).
// Each point also reports how many items / students / tests sit behind it,
// because different tests differ in difficulty: a dip can be a harder test,
// not lost learning, so the trend is indicative evidence, not proof.
// Registered BEFORE /:assessmentId so "trends" is never captured as an id.
// Query: ?competencyId= (required) &studentId= &schoolYear= &section=
router.get('/trends', async (req, res) => {
  const { competencyId, studentId, schoolYear, section } = req.query;
  if (!competencyId) return res.status(400).json({ error: 'competencyId is required.' });

  let query = supabase
    .from('competency_results')
    .select(`
      assessment_id,
      correct_items,
      total_items,
      student_id,
      assessments!inner (term, school_year, created_by),
      students!inner (code_name, section)
    `)
    .eq('competency_id', competencyId);

  if (studentId) query = query.eq('student_id', studentId);
  // Teachers only see the trend across their own assessments; Administrators
  // see the school-wide trend for this competency.
  if (req.user.role !== 'Administrator') {
    query = query.eq('assessments.created_by', req.user.userId);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const all = data ?? [];
  // Filter options reflect everything this user can see for the competency,
  // before the schoolYear/section filters are applied.
  const availableSchoolYears = [...new Set(all.map((r) => r.assessments?.school_year).filter(Boolean))].sort();
  const availableSections = [...new Set(all.map((r) => r.students?.section).filter(Boolean))].sort();

  const rows = all.filter((r) =>
    (!schoolYear || r.assessments?.school_year === schoolYear) &&
    (!section || r.students?.section === section));

  const groups = {};
  for (const row of rows) {
    const t = row.assessments?.term;
    const sy = row.assessments?.school_year ?? 'Unknown year';
    const total = Number(row.total_items);
    if (!t || !(total > 0)) continue;
    const key = `${sy}|${t}`;
    if (!groups[key]) groups[key] = { schoolYear: sy, term: t, rows: [], total: 0, students: new Set(), assessments: new Set() };
    groups[key].rows.push(row);
    groups[key].total += total;
    groups[key].students.add(row.student_id);
    groups[key].assessments.add(row.assessment_id);
  }

  const trend = Object.values(groups)
    .sort((a, b) => a.schoolYear.localeCompare(b.schoolYear) || TERM_ORDER.indexOf(a.term) - TERM_ORDER.indexOf(b.term))
    .map((g) => ({
      schoolYear: g.schoolYear,
      term: g.term,
      label: `${g.schoolYear} ${g.term}`,
      averagePercentage: parseFloat(pooledPercentage(g.rows).toFixed(2)),
      resultCount: g.students.size,
      studentCount: g.students.size,
      assessmentCount: g.assessments.size,
      totalItems: g.total,
    }));

  return res.json({
    competencyId,
    studentId: studentId || null,
    studentLabel: studentId ? (rows[0]?.students?.code_name ?? null) : null,
    schoolYear: schoolYear || null,
    section: section || null,
    availableSchoolYears,
    availableSections,
    note: 'Each point pools all items for this competency in that term (item-weighted). Points come from different tests, so a change can reflect test difficulty as well as learning.',
    trend,
  });
});

// ── GET /api/dashboard/admin-overview ──────────────────────────────────────────
// Administrator only. Cross-teacher, cross-section rollup for the admin's
// own school: how many assessments/students total, average mastery per
// competency school-wide, and a per-teacher breakdown flagging classes
// whose average has fallen below the DepEd "Satisfactory" cutoff (80%).
// This is the view that makes BRIDGE useful to a principal, not just a
// single classroom teacher — admins previously saw the exact same
// per-assessment dashboard as teachers, with no aggregate picture at all.
router.get('/admin-overview', requireRole('Administrator'), async (req, res) => {
  const schoolName = req.user.schoolName;

  const { data: teachers, error: tErr } = await supabase
    .from('users')
    .select('user_id, first_name, last_name')
    .eq('school_name', schoolName)
    .eq('role', 'Teacher')
    .eq('email_verified', true);
  if (tErr) return res.status(500).json({ error: tErr.message });

  const teacherIds = (teachers ?? []).map((t) => t.user_id);
  if (teacherIds.length === 0) {
    return res.json({ schoolName, totalTeachers: 0, totalAssessments: 0, totalStudents: 0, competencyBreakdown: [], teacherBreakdown: [] });
  }

  const { data: assessments, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, created_by')
    .in('created_by', teacherIds)
    .eq('status', 'Completed');
  if (aErr) return res.status(500).json({ error: aErr.message });

  const assessmentIds = (assessments ?? []).map((a) => a.assessment_id);
  // Supabase .in() with an empty array errors, so short-circuit instead.
  const emptyGuard = ['00000000-0000-0000-0000-000000000000'];

  const { data: scores, error: sErr } = await supabase
    .from('assessment_scores')
    .select('assessment_id, raw_score, total_items, percentage, student_id')
    .in('assessment_id', assessmentIds.length ? assessmentIds : emptyGuard);
  if (sErr) return res.status(500).json({ error: sErr.message });

  const { data: compResults, error: cErr } = await supabase
    .from('competency_results')
    .select('assessment_id, percentage, correct_items, total_items, competencies (competency_name)')
    .in('assessment_id', assessmentIds.length ? assessmentIds : emptyGuard);
  if (cErr) return res.status(500).json({ error: cErr.message });

  // School-wide competency breakdown. The average is item-weighted
  // (correct / total items across all results), and the status is derived
  // with the minimum-evidence rule, so a competency tested by only a few
  // items is reported as "insufficient evidence" instead of a learning gap.
  const compMap = {};
  for (const r of compResults ?? []) {
    const name = r.competencies?.competency_name ?? 'Unknown';
    if (!compMap[name]) compMap[name] = { correct: 0, total: 0, count: 0, learningGap: 0, insufficient: 0 };
    compMap[name].correct += Number(r.correct_items);
    compMap[name].total += Number(r.total_items);
    compMap[name].count += 1;
    const status = getReportedStatus(r.percentage, r.total_items);
    if (status === 'Learning Gap') compMap[name].learningGap += 1;
    else if (status === 'Insufficient Evidence') compMap[name].insufficient += 1;
  }
  const competencyBreakdown = Object.entries(compMap).map(([name, v]) => {
    const evaluable = v.count - v.insufficient;
    return {
      competencyName: name,
      averagePercentage: v.total > 0 ? parseFloat(((v.correct / v.total) * 100).toFixed(2)) : 0,
      learningGapCount: v.learningGap,
      learningGapPercentage: evaluable > 0 ? parseFloat(((v.learningGap / evaluable) * 100).toFixed(1)) : null,
      insufficientEvidenceCount: v.insufficient,
      totalResults: v.count,
    };
  });

  // Per-teacher breakdown
  const assessmentToTeacher = Object.fromEntries((assessments ?? []).map((a) => [a.assessment_id, a.created_by]));
  const teacherStats = {};
  for (const t of teachers) {
    // sum = items answered correctly, count = items attempted (item-weighted average)
    teacherStats[t.user_id] = { name: `${t.first_name} ${t.last_name}`, assessmentCount: 0, sum: 0, count: 0, students: new Set() };
  }
  for (const a of assessments ?? []) {
    if (teacherStats[a.created_by]) teacherStats[a.created_by].assessmentCount += 1;
  }
  for (const s of scores ?? []) {
    const teacherId = assessmentToTeacher[s.assessment_id];
    const stat = teacherStats[teacherId];
    if (!stat) continue;
    stat.sum += Number(s.raw_score);
    stat.count += Number(s.total_items);
    stat.students.add(s.student_id);
  }

  const teacherBreakdown = Object.values(teacherStats)
    .map((t) => ({
      teacherName: t.name,
      assessmentCount: t.assessmentCount,
      studentCount: t.students.size,
      averagePercentage: t.count > 0 ? parseFloat(((t.sum / t.count) * 100).toFixed(2)) : null,
      atRisk: t.count > 0 && ((t.sum / t.count) * 100) < 80,
    }))
    .sort((a, b) => (a.averagePercentage ?? 100) - (b.averagePercentage ?? 100));

  return res.json({
    schoolName,
    totalTeachers: teachers.length,
    totalAssessments: assessments.length,
    totalStudents: new Set((scores ?? []).map((s) => s.student_id)).size,
    competencyBreakdown,
    teacherBreakdown,
  });
});

// ── GET /api/dashboard/:assessmentId/item-analysis ──────────────────────────
// Per-item quality analysis, computed entirely from data BRIDGE already
// collects (no new data entry required of the teacher):
//   - difficulty index    = % of students who answered the item correctly
//   - discrimination index = (top 27% overall scorers' % correct on this
//                             item) minus (bottom 27% overall scorers' %
//                             correct on this item). This is the classic
//                             Kelley (1939) top/bottom-27% method. A LOW or
//                             NEGATIVE value means students who did well
//                             overall were not more likely to get this item
//                             right than students who did poorly — a strong
//                             sign the item is confusing or mis-keyed.
//   - top distractor       = the specific wrong option chosen most often by
//                             students who missed the item, surfacing the
//                             actual misconception instead of a raw
//                             "N students got this wrong" count.
// Registered before "/:assessmentId" (different path shape, but kept in the
// same "specific route first" order as /trends and /admin-overview above).
router.get('/:assessmentId/item-analysis', validateParams(uuidParamSchema('assessmentId')), async (req, res) => {
  const { assessmentId } = req.params;

  // Same existence + ownership check as the main dashboard route.
  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, assessment_title, created_by')
    .eq('assessment_id', assessmentId)
    .single();
  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to view this assessment.' });
  }

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('question_id, question_number, question_text, correct_answer, competencies (competency_name)')
    .eq('assessment_id', assessmentId)
    .order('question_number', { ascending: true });
  if (qErr) return res.status(500).json({ error: qErr.message });

  const { data: answers, error: anErr } = await supabase
    .from('student_answers')
    .select('student_id, question_id, student_answer, is_correct')
    .eq('assessment_id', assessmentId);
  if (anErr) return res.status(500).json({ error: anErr.message });

  // Overall score per student — used ONLY to rank students into the
  // top-27% / bottom-27% groups for the discrimination index.
  const { data: scores, error: sErr } = await supabase
    .from('assessment_scores')
    .select('student_id, percentage')
    .eq('assessment_id', assessmentId);
  if (sErr) return res.status(500).json({ error: sErr.message });

  // ── Rank students, carve out the top/bottom 27% groups ────────────────────
  // Deterministic top/bottom 27% split (ties broken by student_id) with a
  // minimum class size — see rankForDiscrimination() in utils/grading.js.
  const { n, groupSize, canDiscriminate, reliable: discriminationReliable, topGroupIds, bottomGroupIds } =
    rankForDiscrimination(scores);

  // ── Tally every answer, grouped by question ────────────────────────────────
  const byQuestion = {};
  for (const q of questions) {
    byQuestion[q.question_id] = {
      totalAnswered: 0,
      totalCorrect: 0,
      topCorrect: 0, topTotal: 0,
      bottomCorrect: 0, bottomTotal: 0,
      wrongChoices: {}, // student_answer -> count, among incorrect answers only
    };
  }

  for (const ans of answers) {
    const stat = byQuestion[ans.question_id];
    if (!stat) continue;

    stat.totalAnswered += 1;
    if (ans.is_correct) {
      stat.totalCorrect += 1;
    } else {
      const choice = ans.student_answer && ans.student_answer.trim() !== '' ? ans.student_answer.trim() : 'No answer';
      stat.wrongChoices[choice] = (stat.wrongChoices[choice] || 0) + 1;
    }

    if (topGroupIds.has(ans.student_id)) {
      stat.topTotal += 1;
      if (ans.is_correct) stat.topCorrect += 1;
    } else if (bottomGroupIds.has(ans.student_id)) {
      stat.bottomTotal += 1;
      if (ans.is_correct) stat.bottomCorrect += 1;
    }
  }

  // ── Build the per-item report with plain-language labels ──────────────────
  const items = questions.map((q) => {
    const stat = byQuestion[q.question_id];
    const difficultyPercentage = stat.totalAnswered > 0
      ? parseFloat(((stat.totalCorrect / stat.totalAnswered) * 100).toFixed(1))
      : 0;

    let discriminationIndex = null;
    if (canDiscriminate && stat.topTotal > 0 && stat.bottomTotal > 0) {
      const topPct = stat.topCorrect / stat.topTotal;
      const bottomPct = stat.bottomCorrect / stat.bottomTotal;
      discriminationIndex = parseFloat((topPct - bottomPct).toFixed(2));
    }

    // Difficulty: DepEd-friendly cutoffs, worded so a teacher reads the
    // "hard" end as a description of the item, not a criticism of it.
    //   >= 80% correct   -> "Very Easy"     (most of the class already has this)
    //   31% - 79% correct -> "Moderate"      (appropriate spread for the class)
    //   <= 30% correct    -> "Challenging"   (worth a closer look, not a flaw)
    let difficultyLabel = 'Moderate';
    if (difficultyPercentage >= 80) difficultyLabel = 'Very Easy';
    else if (difficultyPercentage <= 30) difficultyLabel = 'Challenging';

    // Discrimination: standard psychometric bands for the Kelley D-index,
    // relabeled toward what the teacher should DO rather than a bare score.
    //   <  0.00           -> "Needs Review"       (mis-keyed or confusing item)
    //   0.00 - 0.19        -> "Needs Improvement"  (weak spread between top/bottom scorers)
    //   0.20 - 0.29        -> "Fair"
    //   0.30 - 0.39        -> "Good"
    //   >= 0.40            -> "Excellent"
    let discriminationLabel = 'Not enough data';
    if (discriminationIndex !== null) {
      if (discriminationIndex < 0) discriminationLabel = 'Needs Review';
      else if (discriminationIndex < 0.2) discriminationLabel = 'Needs Improvement';
      else if (discriminationIndex < 0.3) discriminationLabel = 'Fair';
      else if (discriminationIndex < 0.4) discriminationLabel = 'Good';
      else discriminationLabel = 'Excellent';
    }

    // One plain-language status a non-technical teacher can act on at a
    // glance, worst issue first. Criteria (checked in order, first match wins):
    //   1. discriminationIndex < 0.00        -> "Needs Review"
    //   2. difficultyPercentage >= 80%        -> "Very Easy"
    //   3. difficultyPercentage <= 30%        -> "Challenging"
    //   4. 0.00 <= discriminationIndex < 0.20 -> "Needs Improvement"
    //   5. discriminationIndex >= 0.30        -> "Strong Item"
    //   6. otherwise                          -> "Performing Well"
    // Rules 1, 4 and 5 only apply when the class is big enough for the index
    // to be dependable (discriminationReliable). With a smaller class, a
    // moderate-difficulty item is flagged "Limited Data" instead of being
    // called good or faulty on the strength of 2-3 students.
    let flag = discriminationReliable ? 'Performing Well' : 'Limited Data';
    if (discriminationReliable && discriminationIndex !== null && discriminationIndex < 0) flag = 'Needs Review';
    else if (difficultyLabel === 'Very Easy') flag = 'Very Easy';
    else if (difficultyLabel === 'Challenging') flag = 'Challenging';
    else if (discriminationReliable && discriminationIndex !== null && discriminationIndex < 0.2) flag = 'Needs Improvement';
    else if (discriminationReliable && discriminationIndex !== null && discriminationIndex >= 0.3) flag = 'Strong Item';

    // Which specific wrong option was picked most — the actual misconception.
    const totalWrong = Object.values(stat.wrongChoices).reduce((sum, c) => sum + c, 0);
    const distractorBreakdown = Object.entries(stat.wrongChoices)
      .map(([choice, count]) => ({
        choice,
        count,
        percentOfWrong: totalWrong > 0 ? parseFloat(((count / totalWrong) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      questionNumber: q.question_number,
      questionText: q.question_text ?? `Q${q.question_number}`,
      competency: q.competencies?.competency_name ?? 'N/A',
      correctAnswer: q.correct_answer,
      totalAnswered: stat.totalAnswered,
      totalCorrect: stat.totalCorrect,
      totalWrong: stat.totalAnswered - stat.totalCorrect,
      difficultyPercentage,
      difficultyLabel,
      discriminationIndex,
      discriminationLabel,
      discriminationReliable,
      topDistractor: distractorBreakdown[0] ?? null,
      distractorBreakdown,
      flag,
    };
  });

  return res.json({
    assessmentId,
    assessmentTitle: assessment.assessment_title,
    totalStudents: n,
    groupSize: canDiscriminate ? groupSize : 0,
    discriminationReliable,
    discriminationNote: !canDiscriminate
      ? `Discrimination is not computed yet: it needs at least ${MIN_STUDENTS_FOR_DISCRIMINATION} students with scores (${n} so far).`
      : discriminationReliable
      ? `Discrimination compares the top ${groupSize} and bottom ${groupSize} scorers (27% of ${n} students each). Students with equal total scores are ordered consistently.`
      : `Indicative only: with ${n} students (groups of ${groupSize}), the discrimination index shifts a lot from one student's answer. It is shown for reference but not used to flag items — about ${RELIABLE_STUDENTS_FOR_DISCRIMINATION}+ students give a dependable index.`,
    items,
  });
});

// ── GET /api/dashboard/:assessmentId/student-gaps ───────────────────────────
// Who has a gap, and in WHICH competency. This is the view that answers the
// system's main question at student level: one row per student (anonymized
// code name), one cell per competency with correct/total items, the
// percentage, and a status derived with the minimum-evidence rule:
//   Mastered | Learning Gap | Insufficient Evidence
// Students are ordered so those with the most gaps (then lowest overall
// score) come first. Only code names are returned — never real names.
router.get('/:assessmentId/student-gaps', validateParams(uuidParamSchema('assessmentId')), async (req, res) => {
  const { assessmentId } = req.params;

  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, assessment_title, created_by')
    .eq('assessment_id', assessmentId)
    .single();
  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to view this assessment.' });
  }

  const { data: results, error: rErr } = await supabase
    .from('competency_results')
    .select('student_id, competency_id, correct_items, total_items, percentage, students (code_name), competencies (competency_name)')
    .eq('assessment_id', assessmentId);
  if (rErr) return res.status(500).json({ error: rErr.message });

  const { data: scores, error: sErr } = await supabase
    .from('assessment_scores')
    .select('student_id, raw_score, total_items, percentage')
    .eq('assessment_id', assessmentId);
  if (sErr) return res.status(500).json({ error: sErr.message });
  const overallByStudent = Object.fromEntries((scores ?? []).map((x) => [x.student_id, x]));

  const competencies = {};
  const students = {};
  for (const r of results ?? []) {
    if (!competencies[r.competency_id]) {
      competencies[r.competency_id] = {
        competencyId: r.competency_id,
        name: r.competencies?.competency_name ?? 'Unknown competency',
        totalItems: Number(r.total_items),
        insufficientEvidence: !hasEnoughEvidence(r.total_items),
      };
    }
    if (!students[r.student_id]) {
      const ov = overallByStudent[r.student_id];
      students[r.student_id] = {
        studentId: r.student_id,
        codeName: r.students?.code_name ?? 'Unknown',
        overallScore: ov ? `${ov.raw_score}/${ov.total_items}` : null,
        overallPercentage: ov ? Number(ov.percentage) : null,
        gapCount: 0,
        results: {},
      };
    }
    const status = getReportedStatus(r.percentage, r.total_items);
    if (status === 'Learning Gap') students[r.student_id].gapCount += 1;
    students[r.student_id].results[r.competency_id] = {
      correct: Number(r.correct_items),
      total: Number(r.total_items),
      percentage: Number(r.percentage),
      status,
    };
  }

  const studentList = Object.values(students).sort(
    (a, b) => b.gapCount - a.gapCount || (a.overallPercentage ?? 0) - (b.overallPercentage ?? 0) || a.codeName.localeCompare(b.codeName)
  );

  return res.json({
    assessmentId,
    assessmentTitle: assessment.assessment_title,
    masteryCutoff: 80,
    minItemsForEvidence: MIN_ITEMS_FOR_EVIDENCE,
    competencies: Object.values(competencies),
    students: studentList,
  });
});

// ── GET /api/dashboard/:assessmentId ─────────────────────────────────────────
// Returns all data required to render the full dashboard for one assessment:
//   - competency bar chart data
//   - grade descriptor pie chart data
//   - item analysis table data
//   - score tracking list
//   - dashboard indicators (highest/lowest mastered competency)
router.get('/:assessmentId', validateParams(uuidParamSchema('assessmentId')), async (req, res) => {
  const { assessmentId } = req.params;

  // Verify assessment exists
  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, assessment_title, assessment_type, term, total_items, created_at, created_by')
    .eq('assessment_id', assessmentId)
    .single();
  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });

  // Ownership check: only the creating teacher or an Administrator may view this dashboard.
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You are not allowed to view this assessment.' });
  }

  // ── A. Competency Bar Chart ───────────────────────────────────────────────
  // Average percentage per competency across all students
  const { data: compResults, error: crErr } = await supabase
    .from('competency_results')
    .select(`
      competency_id,
      percentage,
      total_items,
      competencies (competency_name)
    `)
    .eq('assessment_id', assessmentId);

  if (crErr) return res.status(500).json({ error: crErr.message });

  // Group by competency. The class average alone can hide struggling
  // students (12 students at 100% + 8 at 50% averages exactly 80%), so every
  // competency also reports how many students are below the cutoff, and
  // whether it has enough items for that label to be trusted.
  const compMap = {};
  for (const row of compResults) {
    const name = row.competencies?.competency_name ?? row.competency_id;
    if (!compMap[name]) compMap[name] = { competencyId: row.competency_id, total: 0, sum: 0, mastered: 0, learningGap: 0, insufficient: 0, items: 0 };
    compMap[name].sum   += parseFloat(row.percentage);
    compMap[name].total += 1;
    compMap[name].items  = Math.max(compMap[name].items, Number(row.total_items));
    const status = getReportedStatus(row.percentage, row.total_items);
    if (status === 'Mastered') compMap[name].mastered++;
    else if (status === 'Learning Gap') compMap[name].learningGap++;
    else compMap[name].insufficient++;
  }

  const competencyChart = Object.entries(compMap).map(([name, val]) => ({
    name,
    competencyId: val.competencyId,
    averagePercentage: val.total > 0 ? parseFloat((val.sum / val.total).toFixed(2)) : 0,
    studentsAssessed: val.total,
    totalItems: val.items,
    mastered:  val.mastered,
    learningGap: val.learningGap,
    insufficientEvidenceCount: val.insufficient,
    insufficientEvidence: !hasEnoughEvidence(val.items),
    learningGapPercentage: val.total > 0 && hasEnoughEvidence(val.items)
      ? parseFloat(((val.learningGap / val.total) * 100).toFixed(1))
      : null,
    gapScope: hasEnoughEvidence(val.items) ? getGapScope(val.learningGap, val.total) : 'Insufficient Evidence',
  }));

  // ── B. Grade Descriptor Pie Chart ────────────────────────────────────────
  const { data: scoreRows, error: sErr } = await supabase
    .from('assessment_scores')
    .select('descriptor')
    .eq('assessment_id', assessmentId);

  if (sErr) return res.status(500).json({ error: sErr.message });

  const descriptorCount = {
    Outstanding: 0,
    'Very Satisfactory': 0,
    Satisfactory: 0,
    'Fairly Satisfactory': 0,
    'Did Not Meet Expectations': 0,
  };
  for (const row of scoreRows) {
    if (descriptorCount[row.descriptor] !== undefined) descriptorCount[row.descriptor]++;
  }
  const total = scoreRows.length || 1;
  const gradeDescriptorChart = Object.entries(descriptorCount).map(([name, count]) => ({
    name,
    count,
    percentage: parseFloat(((count / total) * 100).toFixed(2)),
  }));

  // ── C. Item Analysis ─────────────────────────────────────────────────────
  const { data: answers, error: anErr } = await supabase
    .from('student_answers')
    .select('question_id, is_correct')
    .eq('assessment_id', assessmentId);

  if (anErr) return res.status(500).json({ error: anErr.message });

  const { data: questionList, error: qErr } = await supabase
    .from('questions')
    .select('question_id, question_number, question_text, competencies(competency_name)')
    .eq('assessment_id', assessmentId)
    .order('question_number', { ascending: true });

  if (qErr) return res.status(500).json({ error: qErr.message });

  const answerByQuestion = {};
  for (const ans of answers) {
    if (!answerByQuestion[ans.question_id]) answerByQuestion[ans.question_id] = { correct: 0, wrong: 0 };
    if (ans.is_correct) answerByQuestion[ans.question_id].correct++;
    else answerByQuestion[ans.question_id].wrong++;
  }

  const itemAnalysis = questionList.map((q) => ({
    questionNumber:  q.question_number,
    questionText:    q.question_text ?? `Q${q.question_number}`,
    competency:      q.competencies?.competency_name ?? 'N/A',
    totalCorrect:    answerByQuestion[q.question_id]?.correct ?? 0,
    totalWrong:      answerByQuestion[q.question_id]?.wrong ?? 0,
  }));

  // ── D. Score Tracking ────────────────────────────────────────────────────
  const { data: scores, error: scErr } = await supabase
    .from('assessment_scores')
    .select(`
      raw_score,
      total_items,
      percentage,
      descriptor,
      students (code_name)
    `)
    .eq('assessment_id', assessmentId)
    .order('percentage', { ascending: false });

  if (scErr) return res.status(500).json({ error: scErr.message });

  const scoreTracking = scores.map((s) => ({
    codeName:   s.students?.code_name ?? 'Unknown',
    score:      `${s.raw_score}/${s.total_items}`,
    percentage: s.percentage,
    descriptor: s.descriptor,
  }));

  // ── E. Dashboard Indicators ──────────────────────────────────────────────
  const totalStudents   = scoreRows.length;
  const masteredStudents = scores.filter((s) => s.percentage >= 80).length;
  const learningGapStudents = totalStudents - masteredStudents;

  // Highest / least mastered are picked only among competencies with enough
  // items to be trusted (falling back to all of them if none qualify).
  const rankable = competencyChart.filter((c) => !c.insufficientEvidence);
  const rankPool = rankable.length ? rankable : competencyChart;
  const highestMastered   = rankPool.reduce((a, b) => a.averagePercentage >= b.averagePercentage ? a : b, rankPool[0] ?? null);
  const leastMastered     = rankPool.reduce((a, b) => a.averagePercentage <= b.averagePercentage ? a : b, rankPool[0] ?? null);

  const indicators = {
    totalStudents,
    masteredStudents,
    learningGapStudents,
    highestMasteredCompetency:  highestMastered?.name ?? 'N/A',
    leastMasteredCompetency:    leastMastered?.name  ?? 'N/A',
    highestMasteredPercentage:  highestMastered?.averagePercentage ?? 0,
    leastMasteredPercentage:    leastMastered?.averagePercentage  ?? 0,
  };

  return res.json({
    assessment,
    competencyChart,
    gradeDescriptorChart,
    itemAnalysis,
    scoreTracking,
    indicators,
  });
});

// ── GET /api/dashboard ────────────────────────────────────────────────────────
// Lists assessments available for this teacher to choose from on the dashboard.
router.get('/', async (req, res) => {
  // Only assessments with uploaded scores are meaningful here — drafts and
  // published-but-not-yet-scored tests have nothing to chart yet.
  let query = supabase
    .from('assessments')
    .select('assessment_id, assessment_title, assessment_type, term, total_items, created_at')
    .eq('status', 'Completed')
    .order('created_at', { ascending: false });

  if (req.user.role === 'Teacher') query = query.eq('created_by', req.user.userId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

export default router;
