import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import authRoutes          from './routes/auth.js';
import assessmentRoutes    from './routes/assessments.js';
import uploadRoutes        from './routes/upload.js';
import dashboardRoutes     from './routes/dashboard.js';
import aiInterventionRoutes from './routes/aiIntervention.js';
import reportsRoutes       from './routes/reports.js';
import competenciesRoutes  from './routes/competencies.js';
import auditLogRoutes      from './routes/auditLogs.js';
import { generalLimiter }  from './middleware/rateLimiters.js';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────
// helmet() sets a sane set of security-related HTTP response headers
// (X-Content-Type-Options, X-Frame-Options, a conservative default CSP,
// etc.) that were previously entirely absent from every response.
app.use(helmet());
app.use(cors({
  origin:      process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Backstop rate limit on every /api route; specific routes (login, signup,
// refresh, csv upload) layer a tighter limiter on top — see rateLimiters.js.
app.use('/api', generalLimiter);

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',            authRoutes);
app.use('/api/assessments',     assessmentRoutes);
app.use('/api/upload',          uploadRoutes);
app.use('/api/dashboard',       dashboardRoutes);
app.use('/api/ai-intervention', aiInterventionRoutes);
app.use('/api/reports',         reportsRoutes);
app.use('/api/competencies',    competenciesRoutes);
app.use('/api/audit-logs',      auditLogRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Global error handler ────────────────────────────────────────
// Catches anything a route handler throws synchronously or forwards via
// next(err), so a bug never returns an unhandled HTML stack trace to the
// client — every error response stays consistent JSON.
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message ?? 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`✅  BRIDGE backend running on http://localhost:${PORT}`);
});
