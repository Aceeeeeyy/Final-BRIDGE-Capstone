import React, { useEffect, useState } from "react";
import {
  Bot,
  Loader2,
  Sparkles,
  Archive,
  Save,
  RefreshCw,
  AlertTriangle,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  listDashboardAssessments,
  getCompetencyBreakdown,
  generateIntervention,
  reviewIntervention,
} from "../../services/api";
import RecommendationMarkdown from "../shared/RecommendationMarkdown";

const AIIntervention = () => {
  const [assessments, setAssessments] = useState([]);
  const [assessmentId, setAssessmentId] = useState("");

  const [loadingAssessments, setLoadingAssessments] = useState(true);
  const [assessmentsError, setAssessmentsError] = useState(null);

  // ── Per-assessment competency breakdown ────────────────────────────────
  // Identifies every competency THIS assessment actually covers (not the
  // global competency list) and the score analysis for each — so a test
  // that mixes two or more competencies (e.g. Figures of Speech + Tenses of
  // Verbs) is broken down and handled one competency at a time below.
  const [breakdown, setBreakdown] = useState(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [breakdownError, setBreakdownError] = useState(null);

  // Per-competency state, keyed by competencyId.
  const [results, setResults] = useState({});
  const [generatingIds, setGeneratingIds] = useState({});
  const [regeneratingIds, setRegeneratingIds] = useState({});
  const [reviewingIds, setReviewingIds] = useState({});
  const [genErrors, setGenErrors] = useState({});
  const [reviewErrors, setReviewErrors] = useState({});
  const [bulkGenerating, setBulkGenerating] = useState(false);

  // Load the teacher's assessments once.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await listDashboardAssessments();
      if (!active) return;
      if (error) {
        setAssessmentsError(error);
      } else {
        setAssessments(data || []);
        if (data?.length) setAssessmentId(data[0].assessment_id);
      }
      setLoadingAssessments(false);
    })();
    return () => { active = false; };
  }, []);

  // Whenever the selected assessment changes, fetch its competency-level
  // breakdown and reset any in-session generation state from the previous
  // assessment.
  useEffect(() => {
    if (!assessmentId) return;
    let active = true;
    setBreakdown(null);
    setBreakdownError(null);
    setResults({});
    setGenErrors({});
    setReviewErrors({});
    setLoadingBreakdown(true);

    (async () => {
      const { data, error } = await getCompetencyBreakdown(assessmentId);
      if (!active) return;
      if (error) setBreakdownError(error);
      else setBreakdown(data);
      setLoadingBreakdown(false);
    })();

    return () => { active = false; };
  }, [assessmentId]);

  async function handleGenerate(competencyId) {
    setGeneratingIds((p) => ({ ...p, [competencyId]: true }));
    setGenErrors((p) => ({ ...p, [competencyId]: null }));
    setReviewErrors((p) => ({ ...p, [competencyId]: null }));

    const { data, error } = await generateIntervention({ assessmentId, competencyId });

    setGeneratingIds((p) => ({ ...p, [competencyId]: false }));

    if (error) {
      setGenErrors((p) => ({ ...p, [competencyId]: error }));
      return;
    }
    setResults((p) => ({ ...p, [competencyId]: data }));
  }

  // Generates a fresh recommendation for every competency in this assessment
  // that currently shows a Learning Gap and hasn't already been generated in
  // this session — this is the "for each competency in which the student
  // demonstrates a learning gap" bulk action.
  async function handleGenerateAllGaps() {
    if (!breakdown) return;
    const targets = breakdown.competencies.filter((c) => c.hasLearningGap && !results[c.competencyId]);
    if (!targets.length) return;

    setBulkGenerating(true);
    for (const c of targets) {
      // Sequential on purpose — avoids hammering the AI provider with a
      // burst of concurrent requests when a test covers several competencies.
      await handleGenerate(c.competencyId);
    }
    setBulkGenerating(false);
  }

  async function handleReview(competencyId, status) {
    const result = results[competencyId];
    if (!result?.interventionId) return;
    setReviewingIds((p) => ({ ...p, [competencyId]: true }));
    setReviewErrors((p) => ({ ...p, [competencyId]: null }));

    const { data, error } = await reviewIntervention(result.interventionId, { status });
    setReviewingIds((p) => ({ ...p, [competencyId]: false }));

    if (error) {
      setReviewErrors((p) => ({ ...p, [competencyId]: error }));
      return;
    }
    setResults((p) => ({
      ...p,
      [competencyId]: { ...p[competencyId], reviewStatus: data.reviewStatus, finalRecommendation: data.finalRecommendation },
    }));
  }

  async function handleRegenerate(competencyId) {
    setReviewErrors((p) => ({ ...p, [competencyId]: null }));
    setRegeneratingIds((p) => ({ ...p, [competencyId]: true }));

    const result = results[competencyId];
    if (result?.interventionId && result.reviewStatus === "Pending Review") {
      await reviewIntervention(result.interventionId, { status: "Rejected" });
    }
    await handleGenerate(competencyId);
    setRegeneratingIds((p) => ({ ...p, [competencyId]: false }));
  }

  const gapCompetencies = breakdown?.competencies.filter((c) => c.hasLearningGap) ?? [];
  const pendingGapCount = gapCompetencies.filter((c) => !results[c.competencyId]).length;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-950">AI Intervention</h1>
        <p className="text-slate-600">
          Pick an assessment below — BRIDGE identifies every competency it covers and analyzes each one
          separately, so a test mixing two or more competencies gets a recommendation drafted for each one
          that shows a learning gap. Looking for past recommendations? They live in{" "}
          <Link to="/teacher/archives" className="font-semibold text-[#053225] underline underline-offset-2">
            Archives
          </Link>.
        </p>
      </div>

      {/* Disclaimer: reminds teachers that AI output can be wrong and must
          always be double-checked before being accepted/used. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
        <p>
          <span className="font-semibold">Disclaimer:</span> AI-generated recommendations may contain
          errors or inaccuracies. Teachers should review each recommendation carefully and apply their
          best professional judgement before accepting (Save) a recommendation or using a saved
          recommendation in a report.
        </p>
      </div>

      {loadingAssessments && (
        <div className="flex items-center gap-2 text-[#053225]/70">
          <Loader2 className="animate-spin" size={18} /> Loading assessments...
        </div>
      )}
      {assessmentsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 text-sm">{assessmentsError}</div>
      )}

      {!loadingAssessments && !assessmentsError && (
        <>
          {assessments.length === 0 ? (
            <div className="rounded-xl border border-[#053225]/20 bg-white p-6 text-[#053225]/70">
              No assessments yet. Go to <span className="font-semibold">Upload</span> to create your first test and upload scores before generating an intervention.
            </div>
          ) : (
            <>
              {/* Assessment selector */}
              <div className="rounded-2xl bg-[#053225]/10 p-6 flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-sm font-medium text-[#053225] mb-1">Assessment</label>
                  <select
                    value={assessmentId}
                    onChange={(e) => setAssessmentId(e.target.value)}
                    className="w-full rounded-lg border border-[#053225]/30 bg-white px-4 py-2 text-sm text-[#053225]"
                  >
                    {assessments.map((a) => (
                      <option key={a.assessment_id} value={a.assessment_id}>
                        {a.assessment_title} ({a.assessment_type}, {a.term})
                      </option>
                    ))}
                  </select>
                </div>

                {breakdown?.isMultiCompetency && (
                  <button
                    onClick={handleGenerateAllGaps}
                    disabled={bulkGenerating || pendingGapCount === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#053225] text-[#F1FFF5] font-semibold px-6 py-2.5 hover:bg-[#6E9277] transition disabled:opacity-60"
                  >
                    {bulkGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {bulkGenerating
                      ? "Generating..."
                      : pendingGapCount > 0
                      ? `Generate for all ${pendingGapCount} Learning Gap${pendingGapCount === 1 ? "" : "s"}`
                      : "All Learning Gaps handled"}
                  </button>
                )}
              </div>

              {loadingBreakdown && (
                <div className="flex items-center gap-2 text-[#053225]/70">
                  <Loader2 className="animate-spin" size={18} /> Analyzing competencies for this assessment...
                </div>
              )}

              {breakdownError && (
                <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 text-sm">
                  {breakdownError}
                  {breakdownError.toLowerCase().includes("upload csv") && (
                    <span className="block mt-1">Upload student scores for this assessment first.</span>
                  )}
                </div>
              )}

              {breakdown && !loadingBreakdown && (
                <>
                  <div className="flex items-center gap-2 text-sm text-[#053225]/80">
                    <Layers size={16} />
                    {breakdown.isMultiCompetency ? (
                      <span>
                        This assessment covers <span className="font-semibold">{breakdown.competencies.length} competencies</span> —
                        {" "}each is analyzed and handled separately below.
                      </span>
                    ) : (
                      <span>This assessment covers a single competency.</span>
                    )}
                  </div>

                  <div className="space-y-4">
                    {breakdown.competencies.map((c) => (
                      <CompetencyCard
                        key={c.competencyId}
                        competency={c}
                        result={results[c.competencyId]}
                        generating={!!generatingIds[c.competencyId]}
                        regenerating={!!regeneratingIds[c.competencyId]}
                        reviewing={!!reviewingIds[c.competencyId]}
                        genError={genErrors[c.competencyId]}
                        reviewError={reviewErrors[c.competencyId]}
                        onGenerate={() => handleGenerate(c.competencyId)}
                        onRegenerate={() => handleRegenerate(c.competencyId)}
                        onReview={(status) => handleReview(c.competencyId, status)}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
};

/** One competency's score analysis, generate controls, and (once generated) its recommendation. */
function CompetencyCard({
  competency,
  result,
  generating,
  regenerating,
  reviewing,
  genError,
  reviewError,
  onGenerate,
  onRegenerate,
  onReview,
}) {
  const c = competency;

  return (
    <div
      className={`rounded-2xl border p-5 space-y-3 ${
        c.hasLearningGap ? "border-amber-300 bg-amber-50/40" : c.insufficientEvidence ? "border-slate-300 bg-slate-50" : "border-[#053225]/15 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-[#053225]">{c.competencyName}</h3>
            {c.hasLearningGap ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2.5 py-0.5">
                <AlertTriangle size={12} /> {c.gapScope === "Class-wide" ? "Class-wide Learning Gap" : "Small-group Learning Gap"}
              </span>
            ) : c.insufficientEvidence ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-300 rounded-full px-2.5 py-0.5">
                <AlertTriangle size={12} /> Insufficient Evidence
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-300 rounded-full px-2.5 py-0.5">
                <CheckCircle2 size={12} /> Mastered
              </span>
            )}
          </div>
          <p className="text-sm text-[#053225]/70 mt-1">
            Class average <span className="font-semibold">{c.averagePercentage}%</span> ·{" "}
            {c.insufficientEvidence
              ? `measured by only ${c.totalItems} item${c.totalItems === 1 ? "" : "s"}`
              : `${c.learningGapCount} of ${c.totalStudents} student${c.totalStudents === 1 ? "" : "s"} below 80% (${c.learningGapPercentage}%)`}
          </p>
          {c.insufficientEvidence && (
            <p className="text-xs text-slate-600 mt-1">
              Too few items to label learning gaps reliably (needs 5 or more). Add more items on this competency in the next test before acting on this result. A recommendation can still be drafted, but it will be marked tentative.
            </p>
          )}
          {c.hasLearningGap && (
            <p className="text-xs text-[#053225]/60 mt-1">
              {c.gapScope === "Class-wide"
                ? "Half or more of the class is below 80% — whole-class re-teaching is suggested."
                : "Fewer than half of the class is below 80% — targeted small-group support is suggested."}
            </p>
          )}
          {c.latestIntervention && !result && (
            <p className="text-xs text-[#053225]/60 mt-1">
              A recommendation was already {c.latestIntervention.reviewStatus.toLowerCase()} for this competency — generating
              again will create a new one.
            </p>
          )}
        </div>

        {!result && (
          <button
            onClick={onGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-[#053225] text-[#F1FFF5] font-semibold px-5 py-2 text-sm hover:bg-[#6E9277] transition disabled:opacity-60"
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? "Generating..." : "Generate Recommendation"}
          </button>
        )}
      </div>

      {genError && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{genError}</div>
      )}

      {result && (
        <div className="rounded-[10px] border border-[#053225]/50 bg-[#053225]/10 p-4 text-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-[#053225] font-semibold text-sm">
              <Bot size={16} /> Recommendation for {result.competency}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {result.aiProvider && (
                <span className="text-xs font-medium text-[#053225]/70 bg-white border border-[#053225]/20 rounded-full px-3 py-1">
                  Generated by {result.aiProvider} ({result.aiModel})
                </span>
              )}
              <ReviewBadge status={result.reviewStatus} />
            </div>
          </div>

          <RecommendationMarkdown>{result.finalRecommendation || result.aiRecommendation}</RecommendationMarkdown>

          {reviewError && (
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-sm">{reviewError}</div>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[#053225]/10">
            <span className="text-sm font-medium text-[#053225]/70 mr-1">Your review:</span>

            <button
              onClick={() => onReview("Accepted")}
              disabled={reviewing || regenerating || result.reviewStatus !== "Pending Review"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-green-600 text-green-700 text-sm font-semibold px-4 py-2 hover:bg-green-50 transition disabled:opacity-60"
            >
              {reviewing ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
            </button>
            <button
              onClick={onRegenerate}
              disabled={reviewing || regenerating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-[#053225]/40 text-[#053225] text-sm font-semibold px-4 py-2 hover:bg-[#053225]/5 transition disabled:opacity-60"
            >
              {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Regenerate
            </button>
          </div>

          <Link
            to="/teacher/archives"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#053225] hover:underline"
          >
            <Archive size={14} /> View full history in Archives
          </Link>
        </div>
      )}
    </div>
  );
}

/** Small colored pill showing an intervention's current review status. */
function ReviewBadge({ status }) {
  const styles = {
    "Pending Review": "bg-amber-50 border-amber-300 text-amber-700",
    "Accepted":       "bg-green-50 border-green-300 text-green-700",
    "Edited":         "bg-blue-50 border-blue-300 text-blue-700",
    "Rejected":       "bg-red-50 border-red-300 text-red-700",
  };
  const cls = styles[status] || styles["Pending Review"];
  return (
    <span className={`text-xs font-semibold border rounded-full px-3 py-1 ${cls}`}>
      {status || "Pending Review"}
    </span>
  );
}

export default AIIntervention;
