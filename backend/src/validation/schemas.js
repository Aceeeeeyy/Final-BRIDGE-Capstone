import { z } from 'zod';

/**
 * Express middleware factory: validates req.body against a zod schema.
 * On success, req.body is REPLACED with the parsed (typed, trimmed) result,
 * so downstream handlers can trust its shape instead of re-checking it.
 * On failure, responds 400 with a compact, field-labeled error list.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
      return res.status(400).json({ error: issues.join('; ') });
    }
    req.body = result.data;
    next();
  };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const signupSchema = z.object({
  firstName:  z.string().trim().min(1, 'First name is required').max(100),
  middleName: z.string().trim().max(100).optional().nullable(),
  lastName:   z.string().trim().min(1, 'Last name is required').max(100),
  email:      z.string().trim().toLowerCase().email('Invalid email address').max(255),
  password:   z.string().min(8, 'Password must be at least 8 characters').max(128),
  role:       z.enum(['Teacher', 'Administrator']),
  schoolName: z.enum(
    ['Talon Elementary School', 'Talon 3 Elementary School', 'Pamplona Elementary School Central'],
    { errorMap: () => ({ message: 'Please select a valid school' }) }
  ),
});

export const loginSchema = z.object({
  email:    z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyLoginSchema = z.object({
  challengeToken: z.string().min(20, 'challengeToken is required').max(2000),
  code:           z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const resendLoginCodeSchema = z.object({
  challengeToken: z.string().min(20, 'challengeToken is required').max(2000),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'refreshToken is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address').max(255),
});

export const resetPasswordSchema = z.object({
  email:       z.string().trim().toLowerCase().email('Invalid email address').max(255),
  code:        z.string().trim().regex(/^\d{6,10}$/, 'Code must be 6-10 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
}).refine(
  (data) => data.newPassword.toLowerCase() !== data.email,
  { message: 'Password must not be the same as your email.', path: ['newPassword'] }
);

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address').max(255),
  code:  z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address').max(255),
});

// ── Assessments ──────────────────────────────────────────────────────────────
export const createAssessmentSchema = z.object({
  assessmentTitle: z.string().trim().max(200).optional(),
  assessmentType:  z.enum(['Summative Test', 'Term Examination']),
  term:            z.enum(['Term 1', 'Term 2', 'Term 3']),
  schoolYear:      z.string().regex(/^\d{4}-\d{4}$/, 'School year must look like 2026-2027.').optional(),
});

export const updateAssessmentSchema = z.object({
  assessmentTitle: z.string().trim().max(200).optional(),
  assessmentType:  z.enum(['Summative Test', 'Term Examination']).optional(),
  term:            z.enum(['Term 1', 'Term 2', 'Term 3']).optional(),
  schoolYear:      z.string().regex(/^\d{4}-\d{4}$/, 'School year must look like 2026-2027.').optional(),
});

// Answer-choice wording (A/B/C/D...). Array index 0 = "A", 1 = "B", etc. —
// blank strings are allowed so an unused option slot doesn't shift the
// positions of the ones after it.
const questionOptionsSchema = z
  .array(z.string().trim().max(500).optional().default(''))
  .min(2, 'At least two answer options are required.')
  .max(10, 'A question cannot have more than 10 answer options.');

export const createQuestionSchema = z.object({
  questionText:  z.string().trim().max(1000).optional().nullable(),
  competencyId:  z.string().uuid('competencyId must be a valid UUID'),
  options:       questionOptionsSchema.optional().nullable(),
  correctAnswer: z.string().trim().min(1, 'correctAnswer is required').max(20),
});

export const updateQuestionSchema = z.object({
  questionText:  z.string().trim().max(1000).optional().nullable(),
  competencyId:  z.string().uuid('competencyId must be a valid UUID').optional(),
  options:       questionOptionsSchema.optional().nullable(),
  correctAnswer: z.string().trim().min(1).max(20).optional(),
});

// ── AI Intervention ──────────────────────────────────────────────────────────
export const generateInterventionSchema = z.object({
  assessmentId: z.string().uuid('assessmentId must be a valid UUID'),
  competencyId: z.string().uuid('competencyId must be a valid UUID'),
});

export const reviewInterventionSchema = z.object({
  status: z.enum(['Accepted', 'Edited', 'Rejected']),
  finalRecommendation: z.string().trim().max(8000).optional(),
}).refine(
  (data) => data.status !== 'Edited' || (data.finalRecommendation && data.finalRecommendation.length > 0),
  { message: 'finalRecommendation is required when status is "Edited".', path: ['finalRecommendation'] }
);

// ── Competencies ─────────────────────────────────────────────────────────────
export const createCompetencySchema = z.object({
  competencyName: z.string().trim().min(1, 'competencyName is required').max(150),
  description:    z.string().trim().max(500).optional().nullable(),
});

export const updateCompetencySchema = z.object({
  competencyName: z.string().trim().min(1).max(150).optional(),
  description:    z.string().trim().max(500).optional().nullable(),
  isActive:       z.boolean().optional(),
});

// ── Reports ──────────────────────────────────────────────────────────────────
export const createReportSchema = z.object({
  assessmentId: z.string().uuid('assessmentId must be a valid UUID'),
  reportType:   z.enum(['Bar Chart', 'Pie Chart', 'Item Analysis', 'Scores', 'AI Recommendation']),
  reportTitle:  z.string().trim().min(1).max(200),
  filePath:     z.string().trim().max(500).optional().nullable(),
});

export const exportInterventionsSchema = z.object({
  selections: z.array(z.object({
    assessmentId: z.string().uuid(),
    competencyId: z.string().uuid(),
  })).min(1, 'selections[] is required.'),
});
