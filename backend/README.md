# BRIDGE Backend — Setup & Integration Guide

## Project Structure

```
bridge-backend/
├── src/
│   ├── index.js                  ← Express server entry point
│   ├── supabaseClient.js         ← Supabase service-role client
│   ├── middleware/
│   │   └── auth.js               ← JWT auth middleware
│   ├── routes/
│   │   ├── auth.js               ← POST /signup, POST /login, GET /me
│   │   ├── assessments.js        ← CRUD for assessments + questions
│   │   ├── upload.js             ← POST /upload/csv/:assessmentId
│   │   ├── dashboard.js          ← GET /dashboard/:assessmentId
│   │   ├── aiIntervention.js     ← POST /ai-intervention/generate
│   │   ├── reports.js            ← GET/POST/DELETE /reports
│   │   └── competencies.js       ← GET /competencies
│   └── utils/
│       └── grading.js            ← getDescriptor(), getMasteryStatus(), parseZipGradeRow()
├── sql/
│   └── schema.sql                ← Full Supabase schema (run this first!)
├── frontend-integration/
│   └── api.js                    ← Drop into src/services/api.js in your React app
├── .env.example                  ← Copy to .env and fill in values
├── package.json
└── README.md
```

---

## Step 1 — Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Open the **SQL Editor** in your Supabase dashboard.
3. Copy the entire contents of `sql/schema.sql` and run it.
4. Run every file under `sql/migrations/` **in filename order** (`001_...`, `002_...`, `003_...`). `003_security_and_features.sql` is required — it adds:
   - the anonymized `student_roster` table + `next_student_code()` generator (and backfills any students already in your database), fixing the real-name-in-`code_name` bug;
   - `refresh_tokens`, `audit_logs`;
   - the AI intervention review-status columns;
   - `is_active` on `competencies` for the admin-editable taxonomy.
5. Go to **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ Never put the service-role key in your frontend.

---

## Step 2 — Backend Setup

```bash
# 1. Navigate to the backend folder
cd bridge-backend

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Then edit .env with your actual values (see below)

# 4. Start the development server
npm run dev
```

### .env Values

| Key | Where to find it |
|-----|-----------------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key |
| `JWT_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `AI_PROVIDER` | Which AI service to use: `claude`, `openai` (ChatGPT), `deepseek`, or `gemini`. Defaults to `claude`. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com/account/keys](https://console.anthropic.com/account/keys) |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `DEEPSEEK_API_KEY` | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| `GEMINI_API_KEY` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| `CLIENT_URL` | `http://localhost:5173` for local dev |
| `PORT` | `3000` (default) |

### Switching AI providers

The AI Intervention analyzer (`/api/ai-intervention/generate`) can call **Claude, ChatGPT, DeepSeek, or Gemini** — whichever is set in `AI_PROVIDER`. You only need to fill in the API key for the provider you're actually using; the others can stay blank.

```env
# Use Claude (default)
AI_PROVIDER=claude

# Switch to ChatGPT
AI_PROVIDER=openai

# Switch to DeepSeek
AI_PROVIDER=deepseek

# Switch to Gemini
AI_PROVIDER=gemini
```

No code changes are needed to switch — just update `.env` and restart the server. Each generated intervention also records which provider/model produced it (`ai_provider`, `ai_model` columns), so history stays accurate even if you switch providers later.

If you already created your Supabase tables before this change, run `sql/migrations/001_add_ai_provider_columns.sql` in the Supabase SQL Editor to add the two new columns.

---

## Step 3 — Frontend Integration

### 3a. Add the API service file
Copy `frontend-integration/api.js` into your Capstone React project:
```
Capstone-main/src/services/api.js
```

### 3b. Add the API base URL to Vite
In your `Capstone-main/.env` (create if it doesn't exist):
```
VITE_API_URL=http://localhost:3000/api
```

### 3c. Update App.jsx — replace hardcoded users with real auth

Replace the hardcoded `users` array and `login` function in `App.jsx` with:

```jsx
import { logIn, logOut, getCurrentUser } from './services/api';

// In AppRoutes():
const [authUser, setAuthUser] = useState(() => getCurrentUser());

const login = async ({ email, password }) => {
  const { data, error } = await logIn({ email, password });
  if (error || !data) return false;
  setAuthUser(data.user);
  navigate(data.user.role === 'Administrator' ? '/admin/archives' : '/teacher/dashboard', { replace: true });
  return true;
};

const signOut = () => {
  logOut();          // clears localStorage token
  setAuthUser(null);
  navigate('/login', { replace: true });
};
```

### 3d. Update SignUp.jsx

```jsx
import { signUp } from '../../services/api';
import { useNavigate } from 'react-router-dom';

// In handleSubmit:
const handleSubmit = async (e) => {
  e.preventDefault();
  const { error } = await signUp({
    firstName:  formData.firstName,
    lastName:   formData.lastName,
    email:      formData.email,
    password:   formData.password,
    role:       formData.role,       // add a role select to the form
    schoolName: formData.schoolName, // add a school name field to the form
  });
  if (error) { setError(error); return; }
  navigate('/login');
};
```

### 3e. Update QuestionBuilder.jsx — save to backend

```jsx
import { createAssessment, getCompetencies } from '../../services/api';

// On component mount, fetch competencies:
const [competencies, setCompetencies] = useState([]);
useEffect(() => {
  getCompetencies().then(({ data }) => { if (data) setCompetencies(data); });
}, []);

// When the teacher finishes and clicks "Export":
const handleExport = async () => {
  const payload = {
    assessmentTitle: `${testType} — ${new Date().toLocaleDateString()}`,
    assessmentType:  testType,
    quarter:         selectedQuarter,   // add a quarter selector to the UI
    questions: questions.map((q, idx) => ({
      questionNumber: idx + 1,
      questionText:   q.text,
      competencyId:   competencies.find(c => c.competency_name === q.category)?.competency_id,
      correctAnswer:  q.answers.map(i => String.fromCharCode(65 + i)).join(','),
    })),
  };
  const { data, error } = await createAssessment(payload);
  if (error) { alert(error); return; }
  setCreatedAssessmentId(data.assessmentId);
  alert('Assessment saved! You can now upload the CSV.');
};
```

### 3f. Update Upload.jsx — wire the CSV button

```jsx
import { uploadCSV } from '../../services/api';

// Replace the static "Upload CSV file" button with:
const handleCSVUpload = async (e) => {
  const file = e.target.files[0];
  if (!file || !createdAssessmentId) return;
  const { data, error } = await uploadCSV(createdAssessmentId, file);
  if (error) { alert(error); return; }
  alert(data.message);
};

// In JSX:
<input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" id="csv-input" />
<label htmlFor="csv-input" className="...cursor-pointer">Upload CSV file</label>
```

### 3g. Update Dashboard.jsx — load real data

```jsx
import { listDashboardAssessments, getDashboard } from '../../services/api';
import { useState, useEffect } from 'react';

const Dashboard = () => {
  const [assessments, setAssessments]   = useState([]);
  const [selectedId, setSelectedId]     = useState(null);
  const [dashData, setDashData]         = useState(null);

  useEffect(() => {
    listDashboardAssessments().then(({ data }) => {
      if (data?.length) { setAssessments(data); setSelectedId(data[0].assessment_id); }
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    getDashboard(selectedId).then(({ data }) => { if (data) setDashData(data); });
  }, [selectedId]);

  if (!dashData) return <p>No assessment data yet. Upload a CSV first.</p>;

  // Replace hardcoded `competenciesData` with: dashData.competencyChart
  // Replace hardcoded `gradeData` with: dashData.gradeDescriptorChart
  // Replace hardcoded `items` with: dashData.itemAnalysis
  // Replace hardcoded `scores` with: dashData.scoreTracking
};
```

### 3h. Update AIIntervention.jsx — generate real recommendations

```jsx
import { listDashboardAssessments, getCompetencies, generateIntervention, listInterventions } from '../../services/api';

// On mount: fetch assessments + competencies
// When teacher clicks Generate:
const handleGenerate = async () => {
  const { data, error } = await generateIntervention({ assessmentId, competencyId });
  if (error) { alert(error); return; }
  setRecommendation(data.aiRecommendation);
};
```

### 3i. Update Export.jsx and Archives.jsx — load real reports

```jsx
import { listReports } from '../../services/api';

useEffect(() => {
  listReports({ sortBy: sort, filter }).then(({ data }) => { if (data) setItems(data); });
}, [sort, filter]);
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | None (rate-limited) | Register teacher/admin |
| POST | `/api/auth/login` | None (rate-limited) | Login step 1: checks email + password, emails a 6-digit code, returns `{ requiresTwoFactor, challengeToken }` (no tokens yet) |
| POST | `/api/auth/login/verify` | None (rate-limited) | Login step 2: `{ challengeToken, code }` → returns short-lived access token + refresh token |
| POST | `/api/auth/login/resend-code` | None (rate-limited) | Email a fresh login code (needs the `challengeToken` from step 1) |
| POST | `/api/auth/refresh` | None (rate-limited) | Exchange a refresh token for a new access + refresh token pair |
| POST | `/api/auth/logout` | None | Revoke a refresh token |
| GET | `/api/auth/me` | Bearer | Get current user profile |
| GET | `/api/competencies` | Bearer | List active competencies (`?includeInactive=true`, Admin only) |
| POST | `/api/competencies` | Bearer (Admin) | Add a competency to the taxonomy |
| PATCH | `/api/competencies/:id` | Bearer (Admin) | Edit a competency, or `{ isActive }` to retire/restore |
| DELETE | `/api/competencies/:id` | Bearer (Admin) | Soft-delete (retire) a competency |
| POST | `/api/assessments` | Bearer | Create assessment + questions |
| GET | `/api/assessments` | Bearer | List assessments |
| GET | `/api/assessments/:id` | Bearer | Get assessment with questions |
| DELETE | `/api/assessments/:id` | Bearer | Delete assessment |
| POST | `/api/upload/csv/:assessmentId` | Bearer (rate-limited) | Upload ZipGrade CSV |
| GET | `/api/dashboard` | Bearer | List assessments for selector |
| GET | `/api/dashboard/:assessmentId` | Bearer | Full dashboard data |
| GET | `/api/dashboard/trends` | Bearer | Longitudinal Q1–Q4 trend for one competency (`?competencyId=&studentId=`) |
| GET | `/api/dashboard/admin-overview` | Bearer (Admin) | School-wide, cross-teacher rollup |
| POST | `/api/ai-intervention/generate` | Bearer | Generate AI recommendation (starts as "Pending Review") |
| PATCH | `/api/ai-intervention/:id/review` | Bearer | Accept / Edit / Reject a generated recommendation |
| GET | `/api/ai-intervention/:assessmentId` | Bearer | List past interventions for an assessment |
| GET | `/api/reports` | Bearer | List reports (Export/Archives) |
| POST | `/api/reports` | Bearer | Log a new report |
| DELETE | `/api/reports/:id` | Bearer | Delete a report |
| GET | `/api/audit-logs` | Bearer (Admin) | Recent activity log (logins, uploads, AI actions, etc.) |

---

## CSV Format (ZipGrade Export)

The backend expects CSV columns in this order:
```
Name, Total Score, Max Score, Q1, Q2, Q3, ..., Qn
```
- **Name**: student code name (e.g. "Student A", "S001")
- **Total Score**: raw score (integer)
- **Max Score**: total number of items
- **Q1 – Qn**: student's answer letter per question (A, B, C, D)

ZipGrade exports this format by default. The number of Q columns must match the `total_items` stored for that assessment.

---

## Security & Testing

- **Anonymization:** real student names/LRNs from ZipGrade CSVs are written only to the access-restricted `student_roster` table (no Supabase RLS policy grants it to anon/authenticated roles — only the backend's service-role client can read it). Every other table — including the ones the dashboard, reports, and AI prompts read from — only ever sees the system-generated `code_name` (e.g. `S0001`).
- **Rate limiting:** `/api/auth/login` (10/15min, keyed by IP+email), `/api/auth/signup` (8/hour), `/api/auth/refresh` (30/15min), and `/api/upload/csv/:id` (20/15min per user) all have dedicated limits on top of a general 500/15min ceiling across `/api`. See `src/middleware/rateLimiters.js`.
- **Email login code:** a correct password alone no longer logs anyone in. A 6-digit code is emailed (via Supabase Auth, template in `email-templates/login-code.html`) and must be entered at `/verify-login`. A signed 10-minute `challengeToken` ties step 2 to a just-passed password check, and wrong codes count toward the account lockout. See `CHANGELOG.md`.
- **HTTP headers:** `helmet()` is applied globally in `src/index.js`.
- **Input validation:** every POST/PATCH body is validated with `zod` before it reaches a route handler (`src/validation/schemas.js`), and every `:id`-style route param is validated as a UUID via `validateParams()` (`src/middleware/validation.js`) — a malformed ID now returns a clean 400 instead of a raw Supabase error.
- **Operational basics:** `GET /api/health` for uptime checks, plus a global 404 handler and error handler in `index.js` so every response — including unexpected errors — stays consistent JSON instead of an unhandled stack trace.
- **Auth tokens:** access tokens expire in 15 minutes. `POST /api/auth/refresh` exchanges a valid refresh token for a new access+refresh pair (rotation: the old refresh token is revoked the moment a new one is issued). `POST /api/auth/logout` revokes a refresh token server-side.
- **Audit log:** logins, CSV uploads, AI generations/reviews, and competency changes are recorded in `audit_logs` (see `src/utils/auditLog.js`) and viewable via `GET /api/audit-logs` (Administrator only).
- **Tests:** `npm test` runs the Vitest suite in `src/utils/__tests__/`, covering grade-descriptor cutoffs, mastery thresholds, ZipGrade row parsing (including the anonymization boundary — the parser never returns a "codeName"), and answer matching.

## Database Tables Overview

| Table | Purpose |
|-------|---------|
| `users` | Teacher & Administrator accounts (mirrors Supabase Auth) |
| `competencies` | Admin-manageable competency taxonomy (`is_active` for soft-delete); pre-seeded with Tenses of Verbs, Figures of Speech |
| `students` | Anonymized student records — `code_name` is a system-generated code (e.g. `S0001`), never a real name |
| `student_roster` | **Access-restricted** (RLS default-deny). Holds the real-name/ExternalID ↔ `student_id` mapping, kept apart from every other table so real names never reach the dashboard, reports, or AI prompts |
| `student_code_counters` | Backing table for the atomic per-school `next_student_code()` generator |
| `assessments` | Unit Tests & Quarterly Assessments created by teachers |
| `questions` | Individual questions with correct answers & competency tag |
| `student_answers` | Per-student, per-question answers + is_correct flag |
| `competency_results` | Computed mastery per student × assessment × competency |
| `assessment_scores` | Overall score + descriptor per student per assessment |
| `interventions` | AI-generated recommendation records, plus `review_status`/`final_recommendation`/`reviewed_by` for the teacher accept/edit/reject workflow |
| `reports` | Log of exported charts and AI reports (for Archives) |
| `refresh_tokens` | Hashed, revocable refresh tokens backing the short-lived-access-token auth flow |
| `audit_logs` | Who did what and when (logins, uploads, AI actions, competency changes) — Administrator-viewable via `/api/audit-logs` |
