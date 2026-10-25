# BRIDGE — Item Analysis & Competency Trend math fixes

- **Item Analysis now uses ALL students.** Right/wrong counts per question (correct + wrong = students who took the test; wrong includes blanks, with the blank count shown). The discrimination index is now the item-rest (corrected point-biserial) correlation across all students, replacing the top/bottom-27% split. Same bands (<0 Needs Review, <0.20 Needs Improvement, <0.30 Fair, <0.40 Good, else Excellent) and same 10 / 30 student reliability thresholds.
- **Trend: `totalItems` was items x students** (e.g. 5 items x 30 students showed "150 items"). It now reports the real number of items; the old figure is `itemResponses`. Points built on fewer than 5 items are marked tentative (`enoughEvidence`).
- **Trend, Administrator view was not limited to the admin's school.** It is now filtered by `students.school_name`.
- Files: `grading.js`, `dashboard.js`, `Dashboard.jsx`, `grading.test.js`. Run `npm test` once (the sandbox could not run vitest; the same checks were run with plain node).

---

# BRIDGE — Email login code (two-step login)

After the email and password are accepted, BRIDGE now emails a 6-digit code ("you are trying to log in to BRIDGE") and the user must type it before they are fully logged in. It works like the signup email verification: the code is sent and checked by Supabase Auth, so it uses the same SMTP setup already in place.

## ⚠️ Action required
1. **Edit one email template in Supabase** (Dashboard → Authentication → Emails → Templates → **Magic Link**). Paste the contents of `backend/email-templates/login-code.html` and set the subject to `Your BRIDGE login code`. Without this, the email will go out with Supabase's default Magic Link wording and a link instead of your message. The template must contain `{{ .Token }}`.
2. No SQL migration is needed. No new environment variables.
3. Keep `backend/.env` out of the zip (it was included again) and rotate any keys it contains.

## How it works
| Step | Request | What happens |
|---|---|---|
| 1 | `POST /api/auth/login` `{ email, password }` | Same checks as before (lockout, password, verified email). If they pass, a code is emailed and the response is `{ requiresTwoFactor: true, email, challengeToken }`. **No access/refresh token is issued.** |
| 2 | `POST /api/auth/login/verify` `{ challengeToken, code }` | Checks the code. Only now are the access and refresh tokens issued. |
| – | `POST /api/auth/login/resend-code` `{ challengeToken }` | Sends a fresh code (60 s cooldown in the UI). |

Design decisions worth knowing:
- **`challengeToken`** is a 10-minute signed token that proves the password step just passed. It is signed with a key derived from `JWT_SECRET`, so it cannot be used as an access token and vice versa. Without it, the code alone would be a way to log in **without the password** (Supabase's anon key is public, so anyone can make Supabase email a code to any address).
- **Wrong codes count toward the same lockout** as wrong passwords (5 failures → 15-minute lock), so the 6-digit code can't be brute-forced. The counter resets only after a fully successful login.
- The token travels in React Router state, not the URL or localStorage, so refreshing the code page sends the user back to the login page.
- Audit log: `LOGIN_CODE_SENT`, `LOGIN_CODE_FAILED`, and `LOGIN` (now with `twoFactor: true`).
- Unverified-email accounts still get the existing "verify your email" flow first.

## Files
`backend/src/routes/auth.js`, `backend/src/utils/loginChallenge.js` (new), `backend/src/validation/schemas.js`, `backend/src/middleware/rateLimiters.js`, `backend/email-templates/login-code.html` (new), `frontend/src/components/pages/VerifyLogin.jsx` (new), `frontend/src/App.jsx`, `frontend/src/services/api.js`, tests in `backend/src/utils/__tests__/loginChallenge.test.js` and `backend/src/routes/__tests__/authLoginCode.test.js` (new).

## Verification performed
- `npm test` in `backend/`: 53 passing (36 existing + 17 new). The route tests run the real `auth.js` against a mocked Supabase and cover: no tokens after step 1, tokens only after the right code, wrong password sends no code, a valid code without a valid challenge is refused, a code belonging to another account is refused, lockout after 5 wrong codes, locked accounts can't verify, resend, and rate-limited sends.
- `npm run build` in `frontend/` succeeds. `npm run lint` reports the same 4 `react-hooks/static-components` errors in `App.jsx` as before this change (layouts defined inside the component); none were added.
- **Not tested:** a real email send. That depends on your Supabase template/SMTP, so please do one live login after step 1 above.

---

# BRIDGE — Learning-gap accuracy fixes (math review)

Fixes found when the calculations were checked against the system's main purpose: identifying real learning gaps without misleading results. DepEd descriptor bands are intentionally unchanged.

## ⚠️ Action required
1. **Run `backend/sql/migrations/010_school_year.sql`** in the Supabase SQL Editor (adds `assessments.school_year`, backfilled from `created_at`; Jun–Dec → `YYYY-YYYY+1`, Jan–May → `YYYY-1-YYYY`). Review the backfill if a test belongs to a different school year than the one it was created in.
2. No other migration is needed. The evidence rule is derived at read time, so existing results are corrected automatically.
3. Keep `backend/.env` out of the zip and rotate any keys it contains.

## What changed
| # | Problem | Fix | Files |
|---|---|---|---|
| 1 | Class average hid struggling students (12×100% + 8×50% = "80%, Satisfactory") | Every competency now also shows **N of M students below 80%** and its scope (**Small group** / **Class-wide**, at ≥50% of students). Bar labels show one decimal, so 79.6% no longer displays as "80%". | `dashboard.js`, `Dashboard.jsx` |
| 2 | Few items made the 80% rule meaningless (3–4 items: one slip = "Learning Gap") | Competencies with fewer than **5 items** report **Insufficient Evidence** (`MIN_ITEMS_FOR_EVIDENCE` in `grading.js`). They are excluded from "least/highest mastered", from AI auto-generation, and are labelled "Few items". | `grading.js`, `dashboard.js`, `aiIntervention.js`, `AIIntervention.jsx` |
| 3 | Descriptors | Unchanged (follows DepEd). | — |
| 4 | Trend averaged result percentages (a 2-item quiz = a 20-item exam) and merged different school years | Trend is **item-weighted** (`SUM(correct)/SUM(total)`), grouped by **school year + term**, with school-year and **section** filters; each point shows items / students / tests behind it. Section comes from ZipGrade's `QuizClass`. The trend is labelled as indicative (different tests differ in difficulty). | `dashboard.js`, `grading.js`, `Dashboard.jsx`, `QuestionBuilder.jsx`, `upload.js`, `assessments.js`, `schemas.js`, `010_school_year.sql` |
| 5 | Discrimination index depended on database row order when scores tied, and ran on tiny classes | Deterministic tie-break (student_id); not computed under **10** students; **10–29** shown as *indicative only* (not used to flag items; such items read "Limited Data"); **30+** fully reliable. | `grading.js` (`rankForDiscrimination`), `dashboard.js`, `Dashboard.jsx` |
| 6 | No view of who has a gap in which competency | New `GET /api/dashboard/:assessmentId/student-gaps` and a **Learning Gaps by Student and Competency** table (anonymized codes, correct/total, %, status, "only students with a gap" filter). Score Tracking also shows %. | `dashboard.js`, `api.js`, `Dashboard.jsx` |
| 7 | AI only received class counts, so advice was generic | The prompt now includes items per competency, the 80% cutoff, scope (class-wide vs small-group), score spread, per-item % correct and the **most common wrong answer** (with its option text), plus an instruction not to invent data and to call limited-evidence results tentative. Aggregates only, no student identities. | `aiIntervention.js` |
| 8 | Blank/failed scans were saved as 0% | Rows with no bubbled answers are **skipped with a message**. | `upload.js` |
| 9 | Same student twice in one CSV silently overwrote their own answers | Duplicate identity within a file is skipped with a message. | `upload.js` |
| 10 | A student imported by name first, then with an ExternalID, became two students | Unambiguous name match is linked and the ExternalID is backfilled. | `upload.js` |
| 11 | Admin overview averaged percentages and counted gaps without the evidence rule | Item-weighted averages, gap % and insufficient-evidence counts. | `dashboard.js`, `AdminOverview.jsx` |

(An older changelog entry says the trend uses Q1–Q4; the system uses Term 1–3.)

## Verification performed
- Unit tests: 36 passing (24 existing + 12 new for the evidence rule, gap scope, school year, pooled percentage, deterministic grouping). Run with `npm test` in `backend/`.
- End-to-end check of the real route code against an in-memory database: item-weighted trend (86.36% where the old method gave 70%), school-year/section filters, "40% below 80% but class average exactly 80%", Insufficient Evidence handling, per-student gap table, identical item analysis under reversed row order, and AI prompt contents.
- All edited JS/JSX files parse cleanly. `npm run build` was not run here; please run it once.

---

# BRIDGE — Security & Feature Update (2026-07-15)

This update addresses 11 issues found in a code review of the BRIDGE capstone system, covering one privacy-compliance bug and ten security/feature gaps. Each item below maps to a specific ask; see the referenced files for implementation detail.

## ⚠️ Action required before your defense
1. **Rotate every API key/secret in the old `backend/.env`.** It was included in the zip you shared, which means the Supabase service-role key, JWT secret, and all four AI provider keys must be treated as compromised. Generate new ones and update your own local `.env` (not committed, not zipped).
2. **Run `sql/migrations/003_security_and_features.sql`** in the Supabase SQL Editor, after `schema.sql` and migrations 001–002. It creates the new tables/columns below and **backfills existing students** — any student already in your database has their real name moved out of `code_name` and into the restricted `student_roster` table automatically.
3. **Run `npm install`** in `backend/` and `frontend/` — three new backend dependencies (`express-rate-limit`, `helmet`, `zod`) and one dev dependency (`vitest`) were added.

## 1. Anonymization fix (RA 10173)
`students.code_name` is now always a system-generated code (`S0001`, `S0002`, ...) minted atomically per school by the new `next_student_code()` Postgres function. Real names/LRNs from ZipGrade CSVs are written only to the new `student_roster` table, which has Row-Level Security enabled with **no policies** — meaning only the backend's service-role client can read it; Supabase's anon/authenticated roles are denied by default. `grading.js`'s `parseZipGradeRow()` no longer builds a `codeName` from a real name at all — it returns `realName`/`externalId` separately, and `upload.js` is the only place that ever writes them (to the restricted table).
**Files:** `sql/migrations/003_...sql`, `src/utils/grading.js`, `src/routes/upload.js`

## 2–3. Rate limiting + Helmet
`express-rate-limit` is applied per-route (login: 10/15min keyed by IP+email; signup: 8/hour; refresh: 30/15min; CSV upload: 20/15min per user) plus a 500/15min backstop across all of `/api`. `helmet()` is applied globally in `index.js`.
**Files:** `src/middleware/rateLimiters.js`, `src/index.js`, `src/routes/auth.js`, `src/routes/upload.js`

## 4. Input validation (zod)
Every route that previously trusted `req.body`'s shape now validates it first via a `validateBody(schema)` middleware, covering auth, assessments/questions, AI intervention generate/review, competencies, and reports.
**Files:** `src/validation/schemas.js`, applied across all route files

## 5. Short-lived access token + refresh token rotation
Access tokens now expire in **15 minutes** (was effectively session-length). A new `refresh_tokens` table (hashed tokens, revocable, rotated on every use) backs `POST /api/auth/refresh` and `POST /api/auth/logout`. The frontend's `api.js` transparently refreshes on a 401 and retries the original request once, with a single-flight guard so concurrent requests don't race each other's refresh calls.
**Files:** `sql/migrations/003_...sql`, `src/routes/auth.js`, `frontend/src/services/api.js`

## 6. Automated tests (Vitest)
24 unit tests cover `grading.js`: descriptor/mastery boundary values, ZipGrade item-count detection (including malformed/sparse columns), key extraction, row parsing (explicitly asserting no `codeName` is ever produced), and answer matching. Run with `npm test` in `backend/`.
**Files:** `src/utils/__tests__/grading.test.js`

## 7. Audit log
A new `audit_logs` table records logins (success/failure), CSV uploads, AI generation/review actions, and competency changes, each with actor, IP, and metadata. Viewable via `GET /api/audit-logs` (Administrator only).
**Files:** `sql/migrations/003_...sql`, `src/utils/auditLog.js`, `src/routes/auditLogs.js`, wired into `auth.js`/`upload.js`/`aiIntervention.js`/`competencies.js`

## 8. Longitudinal / trend view
`GET /api/dashboard/trends?competencyId=&studentId=` returns average mastery per quarter (Q1–Q4) for a competency, for one student or the whole class. Rendered as a line chart on the teacher Dashboard.
**Files:** `src/routes/dashboard.js`, `frontend/src/components/pages/Dashboard.jsx`

## 9. Teacher review step for AI interventions
Every generated recommendation now starts as `review_status = 'Pending Review'`. `PATCH /api/ai-intervention/:id/review` lets a teacher mark it Accepted, Edited (saving their own final wording to `final_recommendation`), or Rejected. PDF exports use the edited version when present and flag rejected ones instead of silently including them.
**Files:** `sql/migrations/003_...sql`, `src/routes/aiIntervention.js`, `src/utils/interventionPdf.js`, `src/routes/reports.js`, `frontend/src/components/pages/AIIntervention.jsx`

## 10. Configurable competency taxonomy
Competencies are no longer two immutable seed rows. Administrators can add, edit, and soft-delete (retire/restore) competencies via `POST/PATCH/DELETE /api/competencies`, with a new `is_active` flag preserving history for existing questions/results.
**Files:** `sql/migrations/003_...sql`, `src/routes/competencies.js`, `frontend/src/components/pages/ManageCompetencies.jsx`

## 11. Admin cross-teacher/school rollup
`GET /api/dashboard/admin-overview` (Administrator only) aggregates every teacher's completed assessments in the admin's school: total teachers/assessments/students, school-wide competency mastery, and a per-teacher breakdown flagging classes averaging below the DepEd "Satisfactory" cutoff (80%). This is now the default admin landing page.
**Files:** `src/routes/dashboard.js`, `frontend/src/components/pages/AdminOverview.jsx`, `frontend/src/components/modals/AdminSidebar.jsx`, `frontend/src/App.jsx`

---

### Verification performed
- `npm test` (backend): 24/24 passing
- `node --check` on every modified/new backend source file: no syntax errors
- `npm run build` (frontend, Vite): builds cleanly
