import React, { useEffect, useState } from "react";
import { Loader2, Users, ClipboardList, GraduationCap, AlertTriangle } from "lucide-react";
import { getAdminOverview } from "../../services/api";

// ── AdminOverview ───────────────────────────────────────────────────────────
// The rollup dashboard for school Administrators. Previously, admins saw the
// exact same per-assessment dashboard a single teacher sees. This page is
// the cross-teacher, cross-section view that actually makes BRIDGE useful to
// a principal: school-wide totals, competency mastery across every class,
// and a per-teacher breakdown flagging classes whose average has fallen
// below the DepEd "Satisfactory" cutoff (80%).
const AdminOverview = () => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await getAdminOverview();
      if (!active) return;
      if (err) setError(err);
      else setOverview(data);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-950">School Overview</h1>
        <p className="max-w-2xl text-slate-600">
          A school-wide rollup across every teacher's completed assessments — competency mastery
          trends and at-risk classes at a glance.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[#053225]/70">
          <Loader2 className="animate-spin" size={18} /> Loading school overview...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 text-sm">{error}</div>
      )}

      {!loading && !error && overview && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={<Users size={22} />} label="Teachers" value={overview.totalTeachers} />
            <StatCard icon={<ClipboardList size={22} />} label="Completed Assessments" value={overview.totalAssessments} />
            <StatCard icon={<GraduationCap size={22} />} label="Students with Recorded Scores" value={overview.totalStudents} />
          </div>

          {overview.totalAssessments === 0 ? (
            <div className="rounded-xl border border-[#053225]/20 bg-white p-6 text-[#053225]/70">
              No completed assessments yet across {overview.schoolName}. Once teachers upload scores, the
              school-wide competency and teacher breakdowns will appear here.
            </div>
          ) : (
            <>
              {/* Competency breakdown */}
              <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#053225] mb-4">Competency Mastery — School-wide</h2>
                <div className="space-y-3">
                  {overview.competencyBreakdown.map((c) => (
                    <div key={c.competencyName}>
                      <div className="flex justify-between text-sm text-[#053225] mb-1">
                        <span className="font-medium">{c.competencyName}</span>
                        <span>{c.averagePercentage}% avg · {c.learningGapPercentage != null ? `${c.learningGapPercentage}% of results below 80% (${c.learningGapCount} of ${c.totalResults - c.insufficientEvidenceCount})` : "too few items to label gaps"}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-white overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#053225]"
                          style={{ width: `${Math.min(c.averagePercentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-teacher breakdown */}
              <div className="rounded-2xl bg-white border border-[#053225]/10 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#053225] mb-4">Per-Teacher Breakdown</h2>
                <div className="grid grid-cols-12 gap-4 items-center font-semibold text-[#053225] text-sm px-3 py-2 border-b border-[#053225]/10">
                  <div className="col-span-4">Teacher</div>
                  <div className="col-span-2 text-center">Assessments</div>
                  <div className="col-span-2 text-center">Students</div>
                  <div className="col-span-2 text-center">Avg. Score</div>
                  <div className="col-span-2 text-center">Status</div>
                </div>
                {overview.teacherBreakdown.map((t, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4 items-center px-3 py-3 border-b border-[#053225]/5">
                    <div className="col-span-4 text-sm text-slate-800">{t.teacherName}</div>
                    <div className="col-span-2 text-center text-sm text-[#053225]">{t.assessmentCount}</div>
                    <div className="col-span-2 text-center text-sm text-[#053225]">{t.studentCount}</div>
                    <div className="col-span-2 text-center text-sm font-semibold text-[#053225]">
                      {t.averagePercentage != null ? `${t.averagePercentage}%` : "—"}
                    </div>
                    <div className="col-span-2 text-center">
                      {t.averagePercentage == null ? (
                        <span className="text-xs text-slate-400">No scores yet</span>
                      ) : t.atRisk ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                          <AlertTriangle size={12} /> Below 80%
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                          On track
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};

function StatCard({ icon, label, value }) {
  return (
    <div className="rounded-2xl bg-[#053225]/20 p-6 shadow-sm flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-[#053225] text-white flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-[#053225]">{value}</div>
        <div className="text-sm text-[#053225]/70">{label}</div>
      </div>
    </div>
  );
}

export default AdminOverview;
