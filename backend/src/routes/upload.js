import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { supabase } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { getDescriptor, getMasteryStatus, parseZipGradeRow, detectZipGradeItemCount, extractZipGradeKey, answersMatch } from '../utils/grading.js';
import { uploadLimiter } from '../middleware/rateLimiters.js';
import { validateParams, uuidParamSchema } from '../middleware/validation.js';
import { logAction } from '../utils/auditLog.js';

const router = Router();
router.use(requireAuth);

// Use memory storage — we process the CSV in-memory, nothing hits disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are accepted.'));
  },
});

// ── POST /api/upload/csv/:assessmentId ───────────────────────────────────────
// Accepts a ZipGrade-exported CSV and processes student scores.
// Steps:
//   1. Parse CSV → rows
//   2. Upsert students (by code_name + assessment school)
//   3. Insert student_answers (correct / wrong per question)
//   4. Compute competency_results per student × competency
//   5. Compute assessment_scores (overall) per student
router.post('/csv/:assessmentId', uploadLimiter, validateParams(uuidParamSchema('assessmentId')), upload.single('file'), async (req, res) => {
  const { assessmentId } = req.params;

  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });

  // ── 1. Fetch assessment + questions ──────────────────────────────────────
  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select('assessment_id, assessment_title, total_items, created_by, status')
    .eq('assessment_id', assessmentId)
    .single();

  if (aErr || !assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (req.user.role !== 'Administrator' && assessment.created_by !== req.user.userId) {
    return res.status(403).json({ error: 'You do not own this assessment.' });
  }
  if (assessment.status === 'Draft') {
    return res.status(400).json({ error: 'This test is still a draft. Publish it from the Upload tab before uploading scores.' });
  }

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('question_id, question_number, correct_answer, competency_id')
    .eq('assessment_id', assessmentId)
    .order('question_number', { ascending: true });

  if (qErr || !questions?.length) {
    return res.status(400).json({ error: 'No questions found for this assessment. Create questions first.' });
  }

  // ── 2. Parse CSV ──────────────────────────────────────────────────────────
  let rows;
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (parseErr) {
    return res.status(400).json({ error: `CSV parse error: ${parseErr.message}` });
  }

  if (!rows.length) return res.status(400).json({ error: 'CSV file is empty.' });

  // ── 3. Validate item count up front ─────────────────────────────────────
  // The item count is detected from the CSV itself (StuN columns), so this
  // works for any quiz length — but it still has to match the number of
  // questions actually saved for this assessment, or answers would line up
  // with the wrong questions.
  const csvItemCount = detectZipGradeItemCount(rows[0]);
  if (csvItemCount === 0) {
    return res.status(400).json({
      error: 'This doesn\'t look like a ZipGrade export — no "Stu1", "Stu2", ... item columns were found.',
    });
  }
  if (csvItemCount !== questions.length) {
    return res.status(400).json({
      error: `This CSV has ${csvItemCount} item(s) but "${assessment.assessment_title}" has ${questions.length} question(s) saved. Make sure you exported the right quiz from ZipGrade, or that every question was added before publishing.`,
    });
  }

  const results = { processed: 0, errors: [] };

  // ── 3b. Compare BRIDGE's key against ZipGrade's key ───────────────────────
  // BRIDGE always grades against its own key (see parseZipGradeRow), but a
  // key or item-order mismatch between BRIDGE and ZipGrade is the single
  // most common cause of scores looking wrong after upload — and until now
  // there was no way to see it without comparing 20+ rows by eye. This flags
  // exactly which items disagree, non-blocking, so the upload still goes
  // through but the teacher immediately knows where to look.
  const zipGradeKey = extractZipGradeKey(rows[0], questions.length);
  const keyMismatches = questions
    .map((q, idx) => ({
      questionNumber: q.question_number,
      bridgeKey: q.correct_answer,
      zipGradeKey: zipGradeKey[idx],
    }))
    .filter((m) => m.zipGradeKey && !answersMatch(m.zipGradeKey, m.bridgeKey));

  if (keyMismatches.length > 0) {
    const spreadAcrossMost = keyMismatches.length >= Math.ceil(questions.length * 0.4);
    results.keyWarning = spreadAcrossMost
      ? `BRIDGE's key disagrees with ZipGrade's key on ${keyMismatches.length} of ${questions.length} item(s) — spread across that many items, this usually means the question order in BRIDGE doesn't match the order on the answer sheet, rather than ${keyMismatches.length} separate typos. Scores below were computed using BRIDGE's key regardless.`
      : `BRIDGE's key disagrees with ZipGrade's key on ${keyMismatches.length} of ${questions.length} item(s) — worth double-checking those specific questions. Scores below were computed using BRIDGE's key regardless.`;
    results.keyMismatches = keyMismatches;
  }

  // Tracks which student identity each row resolved to, so the same student
  // appearing twice in one CSV can't silently overwrite their own answers.
  const seenMatchKeys = new Map(); // matchKey -> first row number it appeared on

  for (const [rowIndex, row] of rows.entries()) {
    const { realName, externalId, zipGradeId, matchKey, answers } = parseZipGradeRow(row);
    const quizClass = (row['QuizClass'] || '').trim();
    // Used only in error messages below (never stored) so a teacher can
    // still tell which row/sheet failed without us persisting the name.
    const rowLabel = realName || externalId || `row ${rowIndex + 2}`;

    if (!matchKey) {
      results.errors.push(
        `Row ${rowIndex + 2}: skipped — no student name, ExternalID, or ZipGrade ID was found. In ZipGrade, make sure each sheet has a student name or ID entered (via a roster/name grid) before exporting.`
      );
      continue;
    }

    // Same student twice in one file (re-scanned sheet, or two students with
    // the same name and no ExternalID): the later row would overwrite the
    // earlier row's answers via the upsert below, so skip it and say why.
    if (seenMatchKeys.has(matchKey)) {
      results.errors.push(
        `Row ${rowIndex + 2}: skipped — this student (${rowLabel}) already appeared on row ${seenMatchKeys.get(matchKey)} of this file. If these are two different students with the same name, enter each student's ExternalID (LRN) in ZipGrade; if it's a re-scan, delete the duplicate row.`
      );
      continue;
    }
    seenMatchKeys.set(matchKey, rowIndex + 2);

    // A sheet with nothing bubbled is almost always a failed scan or an
    // absent student — not a student who really scored 0%. Recording it
    // would add a false 0% that drags down every competency average.
    if (answers.every((a) => !a)) {
      results.errors.push(
        `Row ${rowIndex + 2}: skipped — no answers were bubbled for ${rowLabel} (failed scan or absent student?). Not recorded as 0% so it doesn't distort the class results. Re-scan the sheet and upload again if the student did take the test.`
      );
      continue;
    }

    // ── 4. Look up / create the ANONYMIZED student record ───────────────────
    // Real names/IDs are never written to `students.code_name`. Instead we
    // check the access-restricted `student_roster` table for a prior match
    // (so re-uploading a later term's CSV for the same student links to
    // the same student_id rather than creating a duplicate), and only if
    // there's no match do we mint a fresh system-generated code (S0001,
    // S0002, ...) via the next_student_code() DB function.
    let student;
    let rosterQuery = supabase
      .from('student_roster')
      .select('student_id')
      .eq('school_name', req.user.schoolName);

    // Mirror the three-way matchKey fallback used in parseZipGradeRow:
    //   1. externalId (LRN / school ID)    — preferred stable key
    //   2. realName (FirstName + LastName)  — name-based fallback
    //   3. zipGradeId                       — last resort for sheets with
    //      no name and no ExternalID entered in ZipGrade
    // Before this fix, only branches 1 and 2 were implemented here, so
    // branch 3 fell through to eq('real_name', '') and silently merged
    // every anonymous row into the first roster entry with a blank name.
    if (externalId) {
      rosterQuery = rosterQuery.eq('external_id', externalId);
    } else if (realName) {
      rosterQuery = rosterQuery.eq('real_name', realName);
    } else {
      rosterQuery = rosterQuery.eq('zipgrade_id', zipGradeId);
    }

    let { data: rosterHit, error: rosterErr } = await rosterQuery.maybeSingle();

    if (rosterErr) { results.errors.push(`Roster lookup failed for "${rowLabel}": ${rosterErr.message}`); continue; }

    // This upload has an ExternalID but an earlier one didn't (matched by
    // name only). Link to that existing record instead of creating a second
    // student, and backfill the ExternalID so future uploads match on it.
    // Only when the name match is unambiguous (exactly one candidate).
    if (!rosterHit && externalId && realName) {
      const { data: nameHits } = await supabase
        .from('student_roster')
        .select('roster_id, student_id')
        .eq('school_name', req.user.schoolName)
        .eq('real_name', realName)
        .is('external_id', null)
        .limit(2);
      if (nameHits?.length === 1) {
        rosterHit = { student_id: nameHits[0].student_id };
        await supabase.from('student_roster').update({ external_id: externalId }).eq('roster_id', nameHits[0].roster_id);
      }
    }

    if (rosterHit) {
      student = { student_id: rosterHit.student_id };
    } else {
      const { data: codeResult, error: codeErr } = await supabase.rpc('next_student_code', {
        p_school_name: req.user.schoolName,
      });
      if (codeErr) { results.errors.push(`Code generation failed for "${rowLabel}": ${codeErr.message}`); continue; }

      const { data: newStudent, error: sErr } = await supabase
        .from('students')
        .insert({ code_name: codeResult, school_name: req.user.schoolName, section: quizClass || null })
        .select('student_id')
        .single();
      if (sErr) { results.errors.push(`Student insert failed for "${rowLabel}": ${sErr.message}`); continue; }

      const { error: rErr } = await supabase.from('student_roster').insert({
        student_id:  newStudent.student_id,
        real_name:   realName   || null,
        external_id: externalId || null,
        zipgrade_id: zipGradeId || null,
        school_name: req.user.schoolName,
      });
      if (rErr) { results.errors.push(`Roster insert failed for "${rowLabel}": ${rErr.message}`); continue; }

      student = newStudent;
    }

    // Keep the student's section current from ZipGrade's class name, so the
    // Competency Trend can be filtered per section.
    if (quizClass) {
      await supabase.from('students').update({ section: quizClass }).eq('student_id', student.student_id);
    }

    // ── 5. Insert student_answers ──────────────────────────────────────────
    // Graded against BRIDGE's own answer key (questions.correct_answer), not
    // ZipGrade's KeyN — see parseZipGradeRow's doc comment for why.
    const answerRows = questions.map((q, idx) => ({
      student_id:     student.student_id,
      assessment_id:  assessmentId,
      question_id:    q.question_id,
      student_answer: answers[idx] ?? null,
      is_correct:     answersMatch(answers[idx], q.correct_answer),
    }));

    const { error: ansErr } = await supabase
      .from('student_answers')
      .upsert(answerRows, { onConflict: 'student_id,question_id' });
    if (ansErr) { results.errors.push(`Answers insert failed for "${rowLabel}": ${ansErr.message}`); continue; }

    // ── 6. Compute competency_results ─────────────────────────────────────
    // Group correct answers by competency
    const competencyMap = {};
    for (let i = 0; i < questions.length; i++) {
      const cid = questions[i].competency_id;
      if (!competencyMap[cid]) competencyMap[cid] = { total: 0, correct: 0 };
      competencyMap[cid].total += 1;
      if (answerRows[i].is_correct) competencyMap[cid].correct += 1;
    }

    const competencyRows = Object.entries(competencyMap).map(([competencyId, counts]) => {
      const pct = counts.total > 0 ? (counts.correct / counts.total) * 100 : 0;
      return {
        student_id:     student.student_id,
        assessment_id:  assessmentId,
        competency_id:  competencyId,
        total_items:    counts.total,
        correct_items:  counts.correct,
        percentage:     parseFloat(pct.toFixed(2)),
        descriptor:     getDescriptor(pct),
        mastery_status: getMasteryStatus(pct),
      };
    });

    const { error: crErr } = await supabase
      .from('competency_results')
      .upsert(competencyRows, { onConflict: 'student_id,assessment_id,competency_id' });
    if (crErr) { results.errors.push(`Competency results failed for "${rowLabel}": ${crErr.message}`); }

    // ── 7. Compute overall assessment_scores ──────────────────────────────
    // Computed from BRIDGE's own grading above (answerRows), not from the
    // CSV's EarnedPts/PossiblePts — so the total always matches BRIDGE's key.
    const rawScore = answerRows.filter((a) => a.is_correct).length;
    const totalItems = questions.length;
    const overallPct = totalItems > 0 ? (rawScore / totalItems) * 100 : 0;
    const { error: scErr } = await supabase
      .from('assessment_scores')
      .upsert({
        student_id:    student.student_id,
        assessment_id: assessmentId,
        raw_score:     rawScore,
        total_items:   totalItems,
        percentage:    parseFloat(overallPct.toFixed(2)),
        descriptor:    getDescriptor(overallPct),
      }, { onConflict: 'student_id,assessment_id' });
    if (scErr) { results.errors.push(`Score upsert failed for "${rowLabel}": ${scErr.message}`); }

    results.processed += 1;
  }

  // ── 7. Mark the test Completed so it moves out of "awaiting scores" ──────
  // Re-uploading a corrected CSV later is still allowed — the route works the
  // same either way, since every insert above is an upsert.
  if (results.processed > 0 && assessment.status !== 'Completed') {
    await supabase
      .from('assessments')
      .update({ status: 'Completed', updated_at: new Date().toISOString() })
      .eq('assessment_id', assessmentId);
  }

  logAction({
    userId:     req.user.userId,
    action:     'CSV_UPLOAD',
    entityType: 'assessment',
    entityId:   assessmentId,
    metadata:   { fileName: req.file.originalname, processed: results.processed, errorCount: results.errors.length },
    req,
  });

  return res.status(200).json({
    message: `CSV processed. ${results.processed} student(s) recorded.`,
    ...results,
  });
});

export default router;
