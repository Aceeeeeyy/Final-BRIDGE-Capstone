/**
 * Converts a percentage score to a DepEd grade descriptor.
 * Based on DepEd grading scale (Table 1 in the capstone paper).
 *
 * @param {number} percentage  0 – 100
 * @returns {string} descriptor label
 */
export function getDescriptor(percentage) {
  if (percentage >= 90) return 'Outstanding';
  if (percentage >= 85) return 'Very Satisfactory';
  if (percentage >= 80) return 'Satisfactory';
  if (percentage >= 75) return 'Fairly Satisfactory';
  return 'Did Not Meet Expectations';
}

/**
 * Mastery status logic used in competency_results.
 * "Mastered" = Satisfactory or above (>= 80%)
 * "Learning Gap" = below Satisfactory
 *
 * @param {number} percentage
 * @returns {'Mastered' | 'Learning Gap'}
 */
export function getMasteryStatus(percentage) {
  return percentage >= 80 ? 'Mastered' : 'Learning Gap';
}

// ── Evidence & scope rules (added after the math review) ─────────────────────
// A competency score built from only a few items is too coarse to call a
// student's gap: with 3-4 items, a single slip already drops them below 80%.
// Below this many items per competency, results are reported as
// "Insufficient Evidence" instead of "Learning Gap" / "Mastered".
export const MIN_ITEMS_FOR_EVIDENCE = 5;

// If at least this share of the students assessed on a competency are below
// the mastery cutoff, the gap is treated as class-wide (re-teach the class);
// otherwise it is a small-group gap (targeted support for those students).
export const CLASS_WIDE_GAP_RATIO = 0.5;

// Item-analysis reliability: the Kelley top/bottom-27% discrimination index
// needs a reasonably large group to be stable.
export const MIN_STUDENTS_FOR_DISCRIMINATION = 10;      // below this: not computed
export const RELIABLE_STUDENTS_FOR_DISCRIMINATION = 30; // below this: shown as indicative only

/** True when a competency result rests on enough items to label a gap. */
export function hasEnoughEvidence(totalItems) {
  return Number(totalItems) >= MIN_ITEMS_FOR_EVIDENCE;
}

/**
 * Status that dashboards/AI should REPORT for one student x competency
 * result. Derived at read time from percentage + total_items so it also
 * corrects results that were saved before the evidence rule existed.
 * @returns {'Mastered' | 'Learning Gap' | 'Insufficient Evidence'}
 */
export function getReportedStatus(percentage, totalItems) {
  if (!hasEnoughEvidence(totalItems)) return 'Insufficient Evidence';
  return getMasteryStatus(Number(percentage));
}

/**
 * Class-level scope of a competency gap, from how many assessed students
 * are below the cutoff.
 * @returns {'None' | 'Small group' | 'Class-wide'}
 */
export function getGapScope(gapCount, assessedCount) {
  if (!assessedCount || gapCount <= 0) return 'None';
  return gapCount / assessedCount >= CLASS_WIDE_GAP_RATIO ? 'Class-wide' : 'Small group';
}

/**
 * DepEd school year label ("2026-2027") for a date. The Philippine school
 * year opens in June, so June-December belong to the year that starts,
 * January-May to the year that began the previous calendar year.
 */
export function computeSchoolYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const start = d.getMonth() >= 5 ? y : y - 1; // month index 5 = June
  return `${start}-${start + 1}`;
}

/**
 * Detects how many answer items (Stu1, Stu2, ... StuN) are present in a
 * ZipGrade export row by scanning its keys. This is what makes the importer
 * versatile for a quiz of any length — a 10-item quiz, a 50-item exam, etc.
 * — instead of assuming a fixed item count.
 */
export function detectZipGradeItemCount(row) {
  let count = 0;
  while (Object.prototype.hasOwnProperty.call(row, `Stu${count + 1}`)) count += 1;
  return count;
}

/**
 * Pulls ZipGrade's own answer key (Key1, Key2, ... KeyN) out of a row. This
 * is the master key ZipGrade itself graded against — normally identical
 * across every row of a quiz (it's per-quiz, not per-student), unless
 * multiple key versions/forms were used.
 *
 * Not used for grading (BRIDGE grades against its own key — see
 * parseZipGradeRow's doc comment) — this exists purely so an upload can
 * flag when BRIDGE's key and ZipGrade's key have drifted apart, which is a
 * much more common cause of "the scores look wrong" than an actual bug.
 */
export function extractZipGradeKey(row, itemCount) {
  const key = [];
  for (let i = 1; i <= itemCount; i++) {
    key.push((row[`Key${i}`] ?? '').trim());
  }
  return key;
}

/**
 * Parses one row of a real ZipGrade "Export Detail" CSV.
 *
 * ZipGrade's actual export columns (confirmed against a live export) are:
 *   QuizName, QuizClass, FirstName, LastName, ZipGradeID, ExternalID,
 *   EarnedPts, PossiblePts, PercentCorrect, QuizCreated, DataExported,
 *   KeyVersion, then four columns per item, repeated for every item on the
 *   quiz: StuN, KeyN, EarnedPtN, PossPtN — where StuN is what the student
 *   actually bubbled for item N.
 *
 * We only need StuN here: the correct answer for each item comes from
 * BRIDGE's own question bank (set when the teacher built the test), not from
 * ZipGrade's KeyN — that keeps grading consistent even if a key gets
 * corrected in BRIDGE after the sheets were scanned.
 *
 * The item count is detected per-row (see detectZipGradeItemCount) rather
 * than hardcoded, so this works for any number of items.
 *
 * IMPORTANT (anonymization): this function intentionally returns the raw
 * identity fields (realName / externalId / zipGradeId) instead of building
 * a "codeName" the way earlier versions did. Those raw fields must only
 * ever be written to the restricted `student_roster` table — never to
 * `students.code_name`, which is the anonymized identifier shown on every
 * dashboard, report, and AI prompt. Assigning the actual system-facing code
 * is the caller's job (see upload.js), because it requires a DB lookup
 * (has this student already been imported before, under a different CSV?)
 * that doesn't belong in a pure parsing function.
 *
 * @returns {{ realName: string, externalId: string, zipGradeId: string, matchKey: string, answers: string[], itemCount: number }}
 */
export function parseZipGradeRow(row) {
  const firstName = (row['FirstName'] || '').trim();
  const lastName = (row['LastName'] || '').trim();
  const externalId = (row['ExternalID'] || '').trim();
  const zipGradeId = (row['ZipGradeID'] || '').trim();

  const realName = [firstName, lastName].filter(Boolean).join(' ').trim();

  // matchKey is what we use to recognize "this is the same student as a
  // previous upload" — prefer ExternalID (a stable school/LRN number) over
  // the name (which can be spelled inconsistently across CSVs), falling
  // back to name, then to ZipGrade's own per-sheet ID as a last resort.
  const matchKey = externalId || realName || (zipGradeId && zipGradeId !== '0' ? `zg:${zipGradeId}` : '');

  const itemCount = detectZipGradeItemCount(row);
  const answers = [];
  for (let i = 1; i <= itemCount; i++) {
    answers.push((row[`Stu${i}`] ?? '').trim());
  }

  return { realName, externalId, zipGradeId, matchKey, answers, itemCount };
}

/**
 * Compares a student's bubbled answer against a question's correct answer as
 * an unordered set of letters, so formatting differences don't cause a false
 * mismatch. This matters for multi-answer items in particular: BRIDGE stores
 * a multi-answer key as "A,C" (see assessments.js), while ZipGrade bubbles
 * come through concatenated as "AC" — both normalize to the same set here.
 */
export function answersMatch(studentAnswer, correctAnswer) {
  const normalize = (s) => Array.from(new Set((s || '').toUpperCase().match(/[A-Z]/g) || [])).sort().join('');
  const student = normalize(studentAnswer);
  const correct = normalize(correctAnswer);
  return student.length > 0 && student === correct;
}

/**
 * Item-weighted percentage across results: SUM(correct) / SUM(total) x 100.
 * Every item counts once, so a 2-item quiz no longer weighs as much as a
 * 20-item exam (which is what averaging each result's own % did).
 * @param {{correct_items:number,total_items:number}[]} rows
 * @returns {number|null} 0-100, or null when there are no items
 */
export function pooledPercentage(rows) {
  let correct = 0;
  let total = 0;
  for (const r of rows) {
    const t = Number(r.total_items);
    if (!(t > 0)) continue;
    correct += Number(r.correct_items);
    total += t;
  }
  return total > 0 ? (correct / total) * 100 : null;
}

/**
 * Splits students into the top / bottom groups used by the Kelley
 * discrimination index (27% each) in a DETERMINISTIC way. Students with the
 * same score are ordered by student_id, so the groups no longer depend on the
 * row order the database returns (on short tests many students tie, which
 * previously let the same data produce different indexes).
 * @param {{student_id:string, percentage:number|string}[]} scores
 */
export function rankForDiscrimination(scores) {
  const ranked = [...scores].sort(
    (x, y) => parseFloat(y.percentage) - parseFloat(x.percentage) || String(x.student_id).localeCompare(String(y.student_id))
  );
  const n = ranked.length;
  let groupSize = Math.round(n * 0.27);
  if (groupSize * 2 > n) groupSize = Math.floor(n / 2);
  const canDiscriminate = groupSize >= 1 && n >= MIN_STUDENTS_FOR_DISCRIMINATION;
  const reliable = canDiscriminate && n >= RELIABLE_STUDENTS_FOR_DISCRIMINATION;
  return {
    n,
    groupSize,
    canDiscriminate,
    reliable,
    topGroupIds: new Set(canDiscriminate ? ranked.slice(0, groupSize).map((r) => r.student_id) : []),
    bottomGroupIds: new Set(canDiscriminate ? ranked.slice(n - groupSize).map((r) => r.student_id) : []),
  };
}
