/**
 * BRIDGE Frontend API Service
 * Place this file at: src/services/api.js  (in your Capstone-main project)
 *
 * Every function returns { data, error }.
 * Components should check `if (error)` before using `data`.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

// ── Token helpers ─────────────────────────────────────────────────────────────
// Two tokens now, matching the backend's short-lived-access + refresh model:
//   bridge-token         — 15-minute JWT sent as Authorization: Bearer ...
//   bridge-refresh-token — long-lived (7 day), single-use-then-rotated,
//                          used ONLY to silently obtain a new access token
//                          when the short-lived one expires mid-session.
// NOTE: storing the refresh token in localStorage (rather than an httpOnly
// cookie) keeps this consistent with the rest of this app's existing
// architecture, but it is readable by any JS on the page (e.g. an XSS bug).
// An httpOnly, Secure, SameSite cookie would be the stronger option for a
// production deployment — see the note in auth.js.
function getToken() {
  return localStorage.getItem('bridge-token');
}
function setToken(token) {
  localStorage.setItem('bridge-token', token);
}
function getRefreshToken() {
  return localStorage.getItem('bridge-refresh-token');
}
function setRefreshToken(token) {
  localStorage.setItem('bridge-refresh-token', token);
}
function clearToken() {
  localStorage.removeItem('bridge-token');
  localStorage.removeItem('bridge-refresh-token');
  localStorage.removeItem('bridge-user');
}

// Ensures concurrent 401s (e.g. several widgets fetching at once right as
// the access token expires) trigger exactly ONE refresh call, not one per
// request — refresh tokens rotate on use, so a second concurrent refresh
// call would be issued against an already-revoked token and fail.
let refreshInFlight = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      setToken(body.token);
      setRefreshToken(body.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
// On a 401 (expired access token), attempts exactly one silent refresh +
// retry before giving up — so a 15-minute token expiry mid-session doesn't
// interrupt whatever the teacher was doing.
async function apiFetch(path, options = {}, _isRetry = false) {
  const token   = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res  = await fetch(`${BASE_URL}${path}`, { ...options, headers });

    if (res.status === 401 && !_isRetry && getRefreshToken()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return apiFetch(path, options, true);
      clearToken();
    }

    const body = await res.json().catch(() => ({}));
    // `code` is the backend's machine-readable error code, when it sends one
    // (e.g. EMAIL_NOT_VERIFIED on login), so callers can react beyond the message.
    if (!res.ok) return { data: null, error: body.error ?? `HTTP ${res.status}`, code: body.code };
    return { data: body, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ── For CSV upload (multipart/form-data — no Content-Type header) ────────────
async function apiUpload(path, formData, _isRetry = false) {
  const token   = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res  = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData });

    if (res.status === 401 && !_isRetry && getRefreshToken()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return apiUpload(path, formData, true);
      clearToken();
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: body.error ?? `HTTP ${res.status}` };
    return { data: body, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Sign up a new teacher or admin.
 * @param {{ firstName, middleName, lastName, email, password, role, schoolName }} payload
 */
export async function signUp(payload) {
  return apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
}

/** Stores the tokens + user returned by a completed login. */
function storeSession(data) {
  setToken(data.token);
  setRefreshToken(data.refreshToken);
  localStorage.setItem('bridge-user', JSON.stringify(data.user));
}

/**
 * Log in, step 1 of 2: email + password.
 * On success the backend emails a one-time code and answers
 * `{ requiresTwoFactor: true, email, challengeToken }`. Nothing is stored yet:
 * finish with verifyLoginCode(). (If a response ever carries tokens directly,
 * they are stored as before.)
 * @param {{ email, password }} payload
 * @returns {{ data: { requiresTwoFactor, email, challengeToken } | { token, refreshToken, user }, error }}
 */
export async function logIn(payload) {
  const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
  if (result.data?.token) storeSession(result.data);
  return result;
}

/**
 * Log in, step 2 of 2: the 6-digit code emailed after the password step.
 * Saves the access token, refresh token, and user info to localStorage on success.
 * @param {{ challengeToken, code }} payload
 * @returns {{ data: { token, refreshToken, user }, error, code }}
 */
export async function verifyLoginCode({ challengeToken, code }) {
  const result = await apiFetch('/auth/login/verify', { method: 'POST', body: JSON.stringify({ challengeToken, code }) });
  if (result.data?.token) storeSession(result.data);
  return result;
}

/**
 * Email a fresh login code (needs the challengeToken from logIn()).
 * @param {string} challengeToken
 */
export async function resendLoginCode(challengeToken) {
  return apiFetch('/auth/login/resend-code', { method: 'POST', body: JSON.stringify({ challengeToken }) });
}

/** Sign out — revokes the refresh token server-side, then clears local storage. */
export function logOut() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    // Fire-and-forget: don't block the UI on this, and sign-out should
    // still clear local state even if the network call fails.
    fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  clearToken();
}

/** Returns the current user object from localStorage (no API call). */
export function getCurrentUser() {
  const raw = localStorage.getItem('bridge-user');
  return raw ? JSON.parse(raw) : null;
}

/**
 * Request a password-reset code by email. The backend always answers with the
 * same generic message, whether or not the email is registered.
 * @param {string} email
 */
export async function forgotPassword(email) {
  return apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

/**
 * Finish a password reset with the emailed code.
 * @param {{ email, code, newPassword }} payload
 */
export async function resetPassword({ email, code, newPassword }) {
  return apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) });
}

/**
 * Confirm a new account's email with the 6-digit code emailed at signup.
 * Does not log the user in — send them to /login afterwards.
 * @param {{ email, code }} payload
 */
export async function verifyEmail({ email, code }) {
  return apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email, code }) });
}

/**
 * Request a fresh signup verification code. The backend always answers with
 * the same generic message, whether or not the email needs verifying.
 * @param {string} email
 */
export async function resendVerification(email) {
  return apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
}

/** Fetches the authenticated user's profile from the server. */
export async function getMyProfile() {
  return apiFetch('/auth/me');
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPETENCIES
// ═════════════════════════════════════════════════════════════════════════════

/** Returns [{ competency_id, competency_name, description, is_active }] */
export async function getCompetencies({ includeInactive = false } = {}) {
  return apiFetch(`/competencies${includeInactive ? '?includeInactive=true' : ''}`);
}

/** Administrator only. Adds a new competency to the taxonomy. */
export async function createCompetency(payload) {
  return apiFetch('/competencies', { method: 'POST', body: JSON.stringify(payload) });
}

/** Administrator only. Edits a competency, or toggles { isActive } to retire/restore it. */
export async function updateCompetency(competencyId, payload) {
  return apiFetch(`/competencies/${competencyId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** Administrator only. Soft-deletes (retires) a competency. */
export async function retireCompetency(competencyId) {
  return apiFetch(`/competencies/${competencyId}`, { method: 'DELETE' });
}

// ═════════════════════════════════════════════════════════════════════════════
// ASSESSMENTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Creates a new DRAFT assessment right away — before any questions exist.
 * This is the very first thing that happens when a teacher picks "Summative
 * Test" or "Term Examination", so progress is saved to the database from
 * the start instead of only living in the browser tab.
 * @param {{ assessmentTitle?: string, assessmentType: 'Summative Test'|'Term Examination', term: 'Term 1'|'Term 2'|'Term 3' }} payload
 * @returns {{ data: { assessmentId, status }, error }}
 */
export async function createDraftAssessment(payload) {
  return apiFetch('/assessments', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Autosaves draft metadata (title / type / term) while a test is still a
 * Draft. Safe to call repeatedly (e.g. debounced as the teacher types).
 */
export async function updateAssessmentDraft(assessmentId, payload) {
  return apiFetch(`/assessments/${assessmentId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/**
 * Saves a single question to the database immediately (called on every
 * "Add Question" click) — this is what makes question-building autosave.
 * @param {string} assessmentId
 * @param {{ questionText?: string, competencyId: string, options?: string[], correctAnswer: string }} payload
 *   `options[i]` is the wording for answer choice letter `String.fromCharCode(65 + i)` (0 = "A", 1 = "B", ...).
 */
export async function addQuestion(assessmentId, payload) {
  return apiFetch(`/assessments/${assessmentId}/questions`, { method: 'POST', body: JSON.stringify(payload) });
}

/** Edits a previously-saved question. Only allowed while the test is a Draft. */
export async function updateQuestion(assessmentId, questionId, payload) {
  return apiFetch(`/assessments/${assessmentId}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** Deletes a saved question. Only allowed while the test is a Draft. */
export async function deleteQuestion(assessmentId, questionId) {
  return apiFetch(`/assessments/${assessmentId}/questions/${questionId}`, { method: 'DELETE' });
}

/**
 * Publishes a draft: locks its questions and moves it to "Ready for Upload",
 * meaning it's now ready to receive CSV scores at any time in the future.
 */
export async function publishAssessment(assessmentId) {
  return apiFetch(`/assessments/${assessmentId}/publish`, { method: 'PATCH' });
}

/**
 * Lists assessments for the current teacher (or all, for admins) — includes
 * `status` (Draft / Ready for Upload / Completed) and `question_count` so the
 * Upload tab can show a "My Tests" panel a teacher can return to any time.
 */
export async function listAssessments() {
  return apiFetch('/assessments');
}

/** Gets a single assessment with all its questions. Used to resume a draft. */
export async function getAssessment(assessmentId) {
  return apiFetch(`/assessments/${assessmentId}`);
}

/** Deletes an assessment (teacher = own only; admin = any). */
export async function deleteAssessment(assessmentId) {
  return apiFetch(`/assessments/${assessmentId}`, { method: 'DELETE' });
}

// ═════════════════════════════════════════════════════════════════════════════
// UPLOAD (CSV)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Uploads a ZipGrade CSV file and processes student scores.
 * @param {string} assessmentId
 * @param {File} csvFile  — the File object from an <input type="file">
 */
export async function uploadCSV(assessmentId, csvFile) {
  const formData = new FormData();
  formData.append('file', csvFile);
  return apiUpload(`/upload/csv/${assessmentId}`, formData);
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

/** Returns the full dashboard payload for a given assessment. */
export async function getDashboard(assessmentId) {
  return apiFetch(`/dashboard/${assessmentId}`);
}

/** Lists assessments available to select on the dashboard. */
export async function listDashboardAssessments() {
  return apiFetch('/dashboard');
}

/**
 * Longitudinal trend: average percentage per term (Term 1-3) for a
 * competency, either for one student or the whole class/teacher.
 * @param {{ competencyId: string, studentId?: string }} params
 */
export async function getCompetencyTrend({ competencyId, studentId, schoolYear, section }) {
  const qs = new URLSearchParams({
    competencyId,
    ...(studentId ? { studentId } : {}),
    ...(schoolYear ? { schoolYear } : {}),
    ...(section ? { section } : {}),
  });
  return apiFetch(`/dashboard/trends?${qs.toString()}`);
}

/** Administrator only. Cross-teacher, school-wide rollup dashboard. */
export async function getAdminOverview() {
  return apiFetch('/dashboard/admin-overview');
}

/**
 * Per-item quality analysis for an assessment: difficulty index,
 * discrimination index (top vs. bottom 27% scorers), and the most common
 * wrong-answer choice (distractor) for each question.
 */
export async function getItemAnalysis(assessmentId) {
  return apiFetch(`/dashboard/${assessmentId}/item-analysis`);
}

/**
 * Per-student x per-competency results for one assessment: correct/total
 * items, percentage, and a status (Mastered | Learning Gap | Insufficient
 * Evidence) for every student — i.e. WHO has a gap in WHICH competency.
 * @param {string} assessmentId
 */
export async function getStudentGaps(assessmentId) {
  return apiFetch(`/dashboard/${assessmentId}/student-gaps`);
}

// ═════════════════════════════════════════════════════════════════════════════
// AI INTERVENTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generates an AI recommendation for a specific competency gap.
 * @param {{ assessmentId: string, competencyId: string }} payload
 */
export async function generateIntervention(payload) {
  return apiFetch('/ai-intervention/generate', { method: 'POST', body: JSON.stringify(payload) });
}

/** Lists all previously generated interventions for an assessment. */
export async function listInterventions(assessmentId) {
  return apiFetch(`/ai-intervention/${assessmentId}`);
}

/**
 * Identifies every competency actually covered by this assessment and
 * returns a competency-level score analysis for each (average %, mastered
 * vs. Learning Gap counts, whether it needs an intervention). Drives the AI
 * Intervention screen so it reflects what THIS assessment covers — including
 * assessments that mix two or more competencies — instead of the global
 * competency list.
 */
export async function getCompetencyBreakdown(assessmentId) {
  return apiFetch(`/ai-intervention/${assessmentId}/competency-breakdown`);
}

/**
 * Teacher review step: marks an AI-generated recommendation as Accepted,
 * Edited (with the teacher's own final wording), or Rejected. Required
 * before a recommendation is treated as the assessment's official
 * intervention in PDF exports.
 * @param {string} interventionId
 * @param {{ status: 'Accepted'|'Edited'|'Rejected', finalRecommendation?: string }} payload
 */
export async function reviewIntervention(interventionId, payload) {
  return apiFetch(`/ai-intervention/${interventionId}/review`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/**
 * Lists every AI intervention across all of the teacher's assessments
 * (or, for Administrators, across every teacher's assessments).
 * Used by the Archives page.
 */
export async function listAllInterventions() {
  return apiFetch('/ai-intervention');
}

// ═════════════════════════════════════════════════════════════════════════════
// REPORTS / EXPORT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lists reports.
 * @param {{ sortBy?: string, filter?: string }} options
 */
export async function listReports({ sortBy = 'date-new', filter = 'all' } = {}) {
  return apiFetch(`/reports?sortBy=${sortBy}&filter=${encodeURIComponent(filter)}`);
}

/**
 * Logs a new report after the frontend generates a chart/export.
 * @param {{ assessmentId, reportType, reportTitle, filePath? }} payload
 */
export async function logReport(payload) {
  return apiFetch('/reports', { method: 'POST', body: JSON.stringify(payload) });
}

/** Deletes a report record. */
export async function deleteReport(reportId) {
  return apiFetch(`/reports/${reportId}`, { method: 'DELETE' });
}

/**
 * Exports a PDF of the selected AI Interventions (one entry per
 * assessment + competency pair) and triggers a browser download.
 * Returns { error } — null on success.
 * @param {{assessmentId: string, competencyId: string}[]} selections
 */
export async function exportInterventionsPdf(selections, _isRetry = false) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${BASE_URL}/reports/export/ai-interventions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ selections }),
    });

    // On 401 (expired access token), attempt exactly one silent refresh +
    // retry — the same pattern apiFetch uses. Without this, a PDF export
    // attempted right at the 15-minute token boundary fails with a raw auth
    // error instead of the seamless retry every other API call gets.
    if (res.status === 401 && !_isRetry && getRefreshToken()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return exportInterventionsPdf(selections, true);
      clearToken();
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error ?? `HTTP ${res.status}` };
    }

    // Pull the filename the server suggested, if present.
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match ? match[1] : 'BRIDGE_AI_Intervention_Report.pdf';

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═════════════════════════════════════════════════════════════════════════════

/** Administrator only. Recent activity log (logins, uploads, AI actions, etc). */
export async function listAuditLogs({ limit = 50, offset = 0, action } = {}) {
  const qs = new URLSearchParams({ limit, offset, ...(action ? { action } : {}) });
  return apiFetch(`/audit-logs?${qs.toString()}`);
}
