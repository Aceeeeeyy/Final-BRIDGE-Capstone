import React, { useEffect, useState } from "react";
import { Star, Loader2, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { listDashboardAssessments, getDashboard, getCompetencies, getCompetencyTrend, getItemAnalysis, getStudentGaps } from "../../services/api";

// Colors for the plain-language item-quality status pill — reuses the same
// green/amber/red vocabulary as the descriptor chart so a teacher doesn't
// have to learn a second color language for this card. Statuses are worded
// positively/constructively (e.g. "Challenging" instead of "Too hard") —
// see the status criteria documented alongside the flag logic in
// backend/src/routes/dashboard.js.
const FLAG_STYLES = {
  "Needs Review":            { bg: "#cc293620", text: "#cc2936" },
  "Needs Improvement":       { bg: "#ffb80030", text: "#8a5b00" },
  "Challenging":             { bg: "#ffb80030", text: "#8a5b00" },
  "Very Easy":               { bg: "#ffb80030", text: "#8a5b00" },
  "Strong Item":             { bg: "#05322520", text: "#053225" },
  "Performing Well":         { bg: "#05322520", text: "#053225" },
  "Limited Data":            { bg: "#64748b20", text: "#475569" },
};

// Cell colours for the per-student competency table.
const STATUS_STYLES = {
  "Mastered":              { bg: "#05322520", text: "#053225" },
  "Learning Gap":          { bg: "#cc293620", text: "#cc2936" },
  "Insufficient Evidence": { bg: "#64748b20", text: "#475569" },
};

const DESCRIPTOR_COLORS = {
  "Outstanding": "#053225",
  "Very Satisfactory": "#6e9277",
  "Satisfactory": "#ffb800",
  "Fairly Satisfactory": "#9fd6a4",
  "Did Not Meet Expectations": "#cc2936",
};

const Dashboard = () => {
  const [assessments, setAssessments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingAssessments, setLoadingAssessments] = useState(true);

  const [dashboard, setDashboard] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState(null);

  // ── Item-quality analysis (difficulty / discrimination / distractors) ────
  const [itemAnalysis, setItemAnalysis] = useState(null);
  const [loadingItemAnalysis, setLoadingItemAnalysis] = useState(false);
  const [expandedQuestion, setExpandedQuestion] = useState(null);

  // ── Longitudinal trend (Term 1-3) for one competency ──────────────────────
  // This is separate from the per-assessment dashboard above: it answers
  // "is this competency actually improving across the school year", which a
  // single assessment's snapshot can't show on its own.
  const [competencies, setCompetencies] = useState([]);
  const [trendCompetencyId, setTrendCompetencyId] = useState("");
  const [trend, setTrend] = useState([]);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [trendSchoolYear, setTrendSchoolYear] = useState("");
  const [trendSection, setTrendSection] = useState("");
  const [trendMeta, setTrendMeta] = useState({ availableSchoolYears: [], availableSections: [], note: "" });

  // ── Who has a gap in which competency (per student x competency) ─────────
  const [studentGaps, setStudentGaps] = useState(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [showGapsOnly, setShowGapsOnly] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await getCompetencies();
      if (!active) return;
      setCompetencies(data || []);
      if (data?.length) setTrendCompetencyId(data[0].competency_id);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!trendCompetencyId) return;
    let active = true;
    setLoadingTrend(true);
    (async () => {
      const { data } = await getCompetencyTrend({
        competencyId: trendCompetencyId,
        schoolYear: trendSchoolYear || undefined,
        section: trendSection || undefined,
      });
      if (!active) return;
      setTrend(data?.trend || []);
      setTrendMeta({
        availableSchoolYears: data?.availableSchoolYears || [],
        availableSections: data?.availableSections || [],
        note: data?.note || "",
      });
      setLoadingTrend(false);
    })();
    return () => { active = false; };
  }, [trendCompetencyId, trendSchoolYear, trendSection]);

  // Load the list of assessments this teacher/admin can view.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await listDashboardAssessments();
      if (!active) return;
      if (err) {
        setError(err);
      } else {
        setAssessments(data || []);
        if (data?.length) setSelectedId(data[0].assessment_id);
      }
      setLoadingAssessments(false);
    })();
    return () => { active = false; };
  }, []);

  // Load the dashboard payload whenever the selected assessment changes.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLoadingDashboard(true);
    setError(null);
    (async () => {
      const { data, error: err } = await getDashboard(selectedId);
      if (!active) return;
      if (err) setError(err);
      else setDashboard(data);
      setLoadingDashboard(false);
    })();
    return () => { active = false; };
  }, [selectedId]);

  // Load the item-quality analysis alongside the main dashboard payload.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLoadingItemAnalysis(true);
    setExpandedQuestion(null);
    (async () => {
      const { data, error: err } = await getItemAnalysis(selectedId);
      if (!active) return;
      if (!err) setItemAnalysis(data);
      setLoadingItemAnalysis(false);
    })();
    return () => { active = false; };
  }, [selectedId]);

  // Per-student x per-competency gap table for the selected assessment.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLoadingGaps(true);
    setStudentGaps(null);
    (async () => {
      const { data, error: err } = await getStudentGaps(selectedId);
      if (!active) return;
      if (!err) setStudentGaps(data);
      setLoadingGaps(false);
    })();
    return () => { active = false; };
  }, [selectedId]);

  // Same DepEd descriptor thresholds the backend uses (grading.js), so a bar's
  // color tells the teacher at a glance which band that competency falls in —
  // instead of every bar sharing one purely decorative gradient.
  function descriptorColor(pct) {
    if (pct >= 90) return DESCRIPTOR_COLORS["Outstanding"];
    if (pct >= 85) return DESCRIPTOR_COLORS["Very Satisfactory"];
    if (pct >= 80) return DESCRIPTOR_COLORS["Satisfactory"];
    if (pct >= 75) return DESCRIPTOR_COLORS["Fairly Satisfactory"];
    return DESCRIPTOR_COLORS["Did Not Meet Expectations"];
  }

  const competenciesData = (dashboard?.competencyChart || [])
    .map((c) => ({
      name: c.name,
      value: c.averagePercentage,
      color: descriptorColor(c.averagePercentage),
      studentsAssessed: c.studentsAssessed,
      totalItems: c.totalItems,
      learningGap: c.learningGap,
      learningGapPercentage: c.learningGapPercentage,
      insufficientEvidence: c.insufficientEvidence,
      gapScope: c.gapScope,
    }))
    // Weakest competencies first — that's the part of this chart a teacher
    // actually needs to act on, so it shouldn't be buried at the bottom.
    .sort((a, b) => a.value - b.value);

  const gradeData = (dashboard?.gradeDescriptorChart || []).map((g) => ({
    name: g.name,
    value: g.percentage,
    count: g.count ?? 0,
    color: DESCRIPTOR_COLORS[g.name] || "#6e9277",
  }));

  const items = (itemAnalysis?.items || []).map((it) => ({
    q: `Q${it.questionNumber}. ${it.questionText}`,
    correct: it.totalCorrect,
    wrong: it.totalWrong,
    blank: it.totalBlank,
    percentWrong: it.percentWrong,
    difficultyPercentage: it.difficultyPercentage,
    difficultyLabel: it.difficultyLabel,
    discriminationIndex: it.discriminationIndex,
    discriminationLabel: it.discriminationLabel,
    discriminationReliable: it.discriminationReliable,
    flag: it.flag,
    topDistractor: it.topDistractor,
    distractorBreakdown: it.distractorBreakdown,
    correctAnswer: it.correctAnswer,
    questionNumber: it.questionNumber,
  }));

  const scores = (dashboard?.scoreTracking || []).map((s) => ({
    name: s.codeName,
    score: s.score,
    percentage: s.percentage,
  }));

  return (
    <div className="min-h-screen p-8 bg-[#f1fff5]">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-semibold text-slate-950">Dashboard</h1>

        {/* Assessment picker */}
        {!loadingAssessments && assessments.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-lg border border-[#053225]/30 bg-white px-4 py-2 text-sm text-[#053225]"
          >
            {assessments.map((a) => (
              <option key={a.assessment_id} value={a.assessment_id}>
                {a.assessment_title} ({a.assessment_type}, {a.term})
              </option>
            ))}
          </select>
        )}
      </div>

      {loadingAssessments && (
        <div className="flex items-center gap-2 text-[#053225]/70">
          <Loader2 className="animate-spin" size={18} /> Loading assessments...
        </div>
      )}

      {!loadingAssessments && assessments.length === 0 && (
        <div className="rounded-xl border border-[#053225]/20 bg-white p-6 text-[#053225]/70">
          No assessments yet. Go to <span className="font-semibold">Upload</span> to create your first test.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 mb-4 text-sm">{error}</div>
      )}

      {loadingDashboard && (
        <div className="flex items-center gap-2 text-[#053225]/70 mb-4">
          <Loader2 className="animate-spin" size={18} /> Loading dashboard...
        </div>
      )}

      {!loadingDashboard && dashboard && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
            <div className="xl:col-span-7 rounded-2xl bg-[#053225]/20 p-6 shadow-sm flex flex-col">
              <h2 className="text-lg font-semibold text-[#053225] mb-2">Percentage of English Competencies</h2>
              <div className="-mt-1 max-w-[560px] w-full mx-auto">
                {competenciesData.length === 0 ? (
                  <p className="text-sm text-[#053225]/60 text-center mt-8 mb-8">No competency results yet. Upload scores to see this chart.</p>
                ) : (
                  // Only the chart itself scrolls when there are many competencies —
                  // capped at a fixed max-height so it never grows tall enough to
                  // push the legend below out of the card.
                  <div
                    className="overflow-y-auto"
                    style={{ maxHeight: 260, height: Math.min(Math.max(competenciesData.length * 42, 140), 260) }}
                  >
                    <div style={{ height: Math.max(competenciesData.length * 42, 140) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={competenciesData}
                          layout="vertical"
                          margin={{ top: 8, right: 40, left: 8, bottom: 8 }}
                          barCategoryGap="30%"
                        >
                          <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#05322520" />
                          <XAxis
                            type="number"
                            domain={[0, 100]}
                            ticks={[0, 25, 50, 75, 100]}
                            tickFormatter={(v) => `${v}%`}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: "#053225b3" }}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={140}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 12, fill: "#053225" }}
                          />
                          <Tooltip
                            formatter={(v) => [`${v.toFixed ? v.toFixed(1) : v}%`, "Average mastery"]}
                            labelStyle={{ color: "#053225", fontWeight: 600 }}
                          />
                          <Bar dataKey="value" barSize={18} radius={[0, 10, 10, 0]}>
                            {competenciesData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                            <LabelList
                              dataKey="value"
                              position="right"
                              formatter={(v) => `${Number(v).toFixed(1)}%`}
                              style={{ fill: "#053225", fontSize: 12, fontWeight: 600 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
              {competenciesData.length > 0 && (
                // A class average can hide struggling students (e.g. half the
                // class at 100% and half at 60% still averages 80%), so each
                // competency also shows how many students are below 80%.
                <div className="mt-3 space-y-1 text-xs text-[#053225]">
                  {competenciesData.map((c) => (
                    <div key={c.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/40 px-3 py-1.5">
                      <span className="font-semibold">{c.name}</span>
                      {c.insufficientEvidence ? (
                        <span className="text-slate-600">
                          Only {c.totalItems} item{c.totalItems === 1 ? "" : "s"} — too few to label learning gaps (needs 5+)
                        </span>
                      ) : (
                        <span>
                          <span className="font-semibold">{c.learningGap} of {c.studentsAssessed}</span> students below 80%
                          {c.learningGapPercentage != null ? ` (${c.learningGapPercentage}%)` : ""}
                          {c.gapScope && c.gapScope !== "None" ? ` · ${c.gapScope}` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {competenciesData.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-[#053225]/10 justify-center text-[10px] text-[#053225]/70">
                  {Object.entries(DESCRIPTOR_COLORS).map(([label, color]) => (
                    <span key={label} className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-5 rounded-2xl bg-[#053225]/20 p-6 shadow-sm overflow-hidden">
              <h2 className="text-lg font-semibold text-[#053225] mb-2">Percentage of Grade Descriptors</h2>
              {gradeData.every((g) => g.value === 0) ? (
                <p className="text-sm text-[#053225]/60 text-center mt-8">No scores yet. Upload a CSV to populate this chart.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-6 items-center -mt-1">
                  <div className="w-full md:w-[180px] h-[180px] mx-auto md:mx-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={gradeData} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={72}>
                          {gradeData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, _n, item) => [`${v}% (${item?.payload?.count ?? 0} ${item?.payload?.count === 1 ? "student" : "students"})`, item?.payload?.name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="min-w-0">
                    <div className="space-y-3 text-sm text-slate-700">
                      {gradeData.map((g, i) => (
                        <div key={i} className="flex items-start gap-3 min-w-0">
                          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: g.color }} />
                          <span className="break-words text-sm leading-5">{g.name} ({g.value}%) &ndash; {g.count} {g.count === 1 ? "student" : "students"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-8 min-h-0">
              <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm flex flex-col h-full min-h-0">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-xl font-bold text-[#053225] text-center flex-1">Item Analysis</h2>
                </div>
                {itemAnalysis?.discriminationNote && (
                  <p className="text-[11px] text-[#053225]/60 text-center mb-3">{itemAnalysis.discriminationNote}</p>
                )}
                <div className="rounded-lg border border-[#053225]/10 bg-[#053225]/20 p-4 flex-1 min-h-0 overflow-hidden">
                  <div className="hidden sm:grid grid-cols-12 gap-4 items-center font-semibold text-[#053225] text-sm px-3 py-2">
                    <div className="col-span-5">Questions</div>
                    <div className="col-span-2 text-center">Difficulty</div>
                    <div className="col-span-2 text-center">Discrimination</div>
                    <div className="col-span-3 text-center">Status</div>
                  </div>

                  <div className="mt-2 overflow-y-auto h-full min-h-0" style={{ maxHeight: 420 }}>
                    {loadingItemAnalysis ? (
                      <div className="flex items-center gap-2 text-[#053225]/70 justify-center py-6">
                        <Loader2 className="animate-spin" size={16} /> Loading item analysis...
                      </div>
                    ) : items.length === 0 ? (
                      <p className="text-sm text-[#053225]/60 text-center mt-6">No item data yet.</p>
                    ) : (
                      items.map((it, idx) => {
                        const isOpen = expandedQuestion === it.questionNumber;
                        const flagStyle = FLAG_STYLES[it.flag] || FLAG_STYLES["Performing Well"];
                        return (
                          <div key={idx} className="border-t border-[#053225]/20">
                            <button
                              type="button"
                              onClick={() => setExpandedQuestion(isOpen ? null : it.questionNumber)}
                              className="w-full grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 items-center px-3 py-3 text-left"
                            >
                              <div className="sm:col-span-5 text-sm text-black flex items-center gap-1">
                                {isOpen ? <ChevronUp size={14} className="shrink-0 text-[#053225]/60" /> : <ChevronDown size={14} className="shrink-0 text-[#053225]/60" />}
                                <span>{it.q}</span>
                              </div>
                              <div className="sm:col-span-2 sm:text-center text-sm font-semibold text-[#053225] pl-5 sm:pl-0">
                                {it.difficultyPercentage}%
                                <div className="text-[10px] font-normal text-[#053225]/60">{it.correct} correct / {it.wrong} wrong{itemAnalysis?.totalStudents ? ` of ${itemAnalysis.totalStudents}` : ""}</div>
                              </div>
                              <div className="sm:col-span-2 sm:text-center text-sm font-semibold text-[#053225] pl-5 sm:pl-0">
                                {it.discriminationIndex ?? "—"}
                              </div>
                              <div className="sm:col-span-3 flex sm:justify-center pl-5 sm:pl-0">
                                <span
                                  className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                                  style={{ background: flagStyle.bg, color: flagStyle.text }}
                                >
                                  {it.flag}
                                </span>
                              </div>
                            </button>

                            {isOpen && (
                              <div className="px-3 pb-4 -mt-1 text-xs text-[#053225]/80 space-y-1">
                                <p><span className="font-semibold">Difficulty:</span> {it.difficultyLabel} ({it.difficultyPercentage}% answered correctly)</p>
                                <p><span className="font-semibold">Students:</span> {it.correct} got it right ({it.difficultyPercentage}%), {it.wrong} got it wrong ({it.percentWrong}%){it.blank > 0 ? `, including ${it.blank} left blank` : ""}</p>
                                <p><span className="font-semibold">Discrimination:</span> {it.discriminationLabel}{it.discriminationIndex !== null ? ` (index: ${it.discriminationIndex}${it.discriminationReliable ? "" : ", indicative only"})` : ""}</p>
                                {it.correctAnswer && (
                                  <p><span className="font-semibold">Correct answer:</span> {it.correctAnswer}</p>
                                )}
                                {it.topDistractor ? (
                                  <p>
                                    <span className="font-semibold">Most common wrong answer:</span> "{it.topDistractor.choice}" — chosen by {it.topDistractor.count} student{it.topDistractor.count === 1 ? "" : "s"} ({it.topDistractor.percentOfWrong}% of those who missed this item)
                                  </p>
                                ) : (
                                  <p className="text-[#053225]/50">No wrong answers recorded for this item yet.</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="xl:col-span-4 min-h-0">
              <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm flex flex-col h-full min-h-0">
                <div className="flex items-center justify-center mb-3">
                  <Star className="w-10 h-10 text-[#053225]" />
                </div>
                <h3 className="text-lg font-semibold text-[#053225] text-center">Score Tracking</h3>
                <div className="mt-4 border-t border-[#053225]/10 pt-4 overflow-y-auto flex-1 min-h-0" style={{ maxHeight: 420 }}>
                  {scores.length === 0 ? (
                    <p className="text-sm text-[#053225]/60 text-center mt-6">No scores yet.</p>
                  ) : (
                    scores.map((s, i) => (
                      <div key={i} className="flex items-center justify-between py-3 border-b border-[#053225]/10">
                        <span className="text-sm text-slate-800">{s.name}</span>
                        <span className="text-sm font-semibold text-slate-900">
                          {s.score}
                          {s.percentage != null && <span className="ml-1 text-xs font-normal text-slate-600">({Number(s.percentage).toFixed(1)}%)</span>}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Who has a gap in WHICH competency ────────────────────────────
              One row per student (anonymized code), one cell per competency.
              This is the student-level answer to "who needs help with what":
              the bar chart above only shows class-wide averages. */}
          <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <h2 className="text-lg font-semibold text-[#053225]">Learning Gaps by Student and Competency</h2>
              <label className="inline-flex items-center gap-2 text-sm text-[#053225] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGapsOnly}
                  onChange={(e) => setShowGapsOnly(e.target.checked)}
                  className="accent-[#053225]"
                />
                Show only students with a gap
              </label>
            </div>
            <p className="text-[11px] text-[#053225]/60 mb-3">
              A competency is a Learning Gap when the student answered below {studentGaps?.masteryCutoff ?? 80}% of its items correctly.
              Competencies with fewer than {studentGaps?.minItemsForEvidence ?? 5} items are marked "Few items" and not labelled, because one slip would decide the result.
            </p>

            {loadingGaps ? (
              <div className="flex items-center gap-2 text-[#053225]/70 justify-center py-6">
                <Loader2 className="animate-spin" size={16} /> Loading student results...
              </div>
            ) : !studentGaps || studentGaps.students.length === 0 ? (
              <p className="text-sm text-[#053225]/60 text-center py-6">No student results yet. Upload scores to see this table.</p>
            ) : (
              <div className="overflow-x-auto overflow-y-auto rounded-lg border border-[#053225]/10 bg-white/50" style={{ maxHeight: 420 }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#e3efe7] text-[#053225]">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">Student</th>
                      <th className="text-center font-semibold px-3 py-2 whitespace-nowrap">Overall</th>
                      {studentGaps.competencies.map((c) => (
                        <th key={c.competencyId} className="text-center font-semibold px-3 py-2">
                          <div>{c.name}</div>
                          <div className="text-[10px] font-normal text-[#053225]/60">
                            {c.totalItems} item{c.totalItems === 1 ? "" : "s"}{c.insufficientEvidence ? " · Few items" : ""}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {studentGaps.students
                      .filter((st) => !showGapsOnly || st.gapCount > 0)
                      .map((st) => (
                        <tr key={st.studentId} className="border-t border-[#053225]/10">
                          <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{st.codeName}</td>
                          <td className="px-3 py-2 text-center text-slate-800 whitespace-nowrap">
                            {st.overallScore ?? "—"}
                            {st.overallPercentage != null && <span className="ml-1 text-xs text-slate-600">({st.overallPercentage.toFixed(1)}%)</span>}
                          </td>
                          {studentGaps.competencies.map((c) => {
                            const r = st.results[c.competencyId];
                            if (!r) return <td key={c.competencyId} className="px-3 py-2 text-center text-slate-400">—</td>;
                            const style = STATUS_STYLES[r.status] || STATUS_STYLES["Insufficient Evidence"];
                            return (
                              <td key={c.competencyId} className="px-3 py-2 text-center">
                                <span
                                  className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                                  style={{ background: style.bg, color: style.text }}
                                  title={r.status}
                                >
                                  {r.correct}/{r.total} ({r.percentage.toFixed(0)}%) · {r.status === "Insufficient Evidence" ? "Few items" : r.status}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Competency Trend Over Time (Term 1-3) ────────────────────────
              Separate from the assessment picker above: this tracks ONE
              competency's average mastery across every term it has data
              for, across all of this teacher's classes — so a teacher can
              see whether an intervention actually moved the needle, instead
              of only ever seeing one test's snapshot at a time. */}
          <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <h2 className="text-lg font-semibold text-[#053225] flex items-center gap-2">
                <TrendingUp size={20} /> Competency Trend (Term 1–3)
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {competencies.length > 0 && (
                  <select
                    value={trendCompetencyId}
                    onChange={(e) => { setTrendCompetencyId(e.target.value); setTrendSchoolYear(""); setTrendSection(""); }}
                    className="rounded-lg border border-[#053225]/30 bg-white px-3 py-1.5 text-sm text-[#053225]"
                  >
                    {competencies.map((c) => (
                      <option key={c.competency_id} value={c.competency_id}>{c.competency_name}</option>
                    ))}
                  </select>
                )}
                <select
                  value={trendSchoolYear}
                  onChange={(e) => setTrendSchoolYear(e.target.value)}
                  className="rounded-lg border border-[#053225]/30 bg-white px-3 py-1.5 text-sm text-[#053225]"
                >
                  <option value="">All school years</option>
                  {trendMeta.availableSchoolYears.map((y) => (
                    <option key={y} value={y}>SY {y}</option>
                  ))}
                </select>
                {trendMeta.availableSections.length > 0 && (
                  <select
                    value={trendSection}
                    onChange={(e) => setTrendSection(e.target.value)}
                    className="rounded-lg border border-[#053225]/30 bg-white px-3 py-1.5 text-sm text-[#053225]"
                  >
                    <option value="">All sections</option>
                    {trendMeta.availableSections.map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {loadingTrend ? (
              <div className="flex items-center gap-2 text-[#053225]/70 py-8 justify-center">
                <Loader2 className="animate-spin" size={18} /> Loading trend...
              </div>
            ) : trend.length === 0 ? (
              <p className="text-sm text-[#053225]/60 text-center py-8">
                No term-over-term data yet for this competency. Once results exist for the same competency across more than one term, the trend line appears here.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#05322520" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => `${v}%`}
                      labelFormatter={(label, payload) => {
                        const pt = payload?.[0]?.payload;
                        return pt
                          ? `${label} — ${pt.totalItems} item${pt.totalItems === 1 ? "" : "s"}${pt.enoughEvidence === false ? " (few items - tentative)" : ""}, ${pt.studentCount} student${pt.studentCount === 1 ? "" : "s"}, ${pt.assessmentCount} test${pt.assessmentCount === 1 ? "" : "s"}`
                          : label;
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="averagePercentage"
                      name="Average Mastery %"
                      stroke="#053225"
                      strokeWidth={3}
                      dot={{ r: 5, fill: "#ffb800" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {!loadingTrend && trend.length > 0 && (
              <p className="text-[11px] text-[#053225]/60 mt-3">
                {trendMeta.note || "Each point pools every item for this competency in that term."} Use it as a guide, not proof: a dip can mean a harder test.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
