import React, { useEffect, useMemo, useState } from "react";
import { Funnel, ArrowUpNarrowWide, Loader2, Bot, GraduationCap, FileDown } from "lucide-react";
import { listAllInterventions, getCurrentUser, exportInterventionsPdf } from "../../services/api";
import RecommendationMarkdown from "../shared/RecommendationMarkdown";

const sortOptions = [
  { value: "date-new", label: "Date (newest)" },
  { value: "date-old", label: "Date (oldest)" },
  { value: "a-z", label: "Assessment A – Z" },
  { value: "z-a", label: "Assessment Z – A" },
];

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}
function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const Archives = () => {
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === "Administrator";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("date-new");
  const [filter, setFilter] = useState("all");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Selection + PDF download — folded in from the old, separate Export tab
  // so there's a single place to both browse and download AI Intervention
  // history instead of two near-duplicate pages hitting the same data.
  const [selected, setSelected] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error: err } = await listAllInterventions();
      if (!active) return;
      if (err) setError(err);
      else setItems(data || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  // Build the filter dropdown from the assessments that actually appear.
  const filterOptions = useMemo(() => {
    const seen = new Map();
    for (const item of items) {
      if (item.assessmentId && !seen.has(item.assessmentId)) {
        seen.set(item.assessmentId, item.assessmentTitle);
      }
    }
    return [{ value: "all", label: "All Assessments" }, ...Array.from(seen, ([value, label]) => ({ value, label }))];
  }, [items]);

  const visibleItems = useMemo(() => {
    let rows = items;
    if (filter !== "all") rows = rows.filter((i) => i.assessmentId === filter);

    rows = [...rows];
    if (sort === "a-z") rows.sort((a, b) => a.assessmentTitle.localeCompare(b.assessmentTitle));
    else if (sort === "z-a") rows.sort((a, b) => b.assessmentTitle.localeCompare(a.assessmentTitle));
    else if (sort === "date-old") rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return rows;
  }, [items, sort, filter]);

  // Backend export includes the single latest Accepted/Edited entry for
  // EACH competency covered by an assessment (a multi-competency test keeps
  // one entry per competency, not just one for the whole assessment — see
  // reports.js). Superseded entries are therefore scoped to the same
  // assessment AND the same competency: an older draft of "Figures of
  // Speech" is superseded by a newer "Figures of Speech" entry, but it is
  // NOT superseded by a newer, unrelated "Tenses of Verbs" entry on the same
  // test — those are both current and both get exported.
  const latestInterventionIdByCompetency = useMemo(() => {
    const latest = new Map();
    for (const iv of items) {
      const key = `${iv.assessmentId}::${iv.competencyId}`;
      const current = latest.get(key);
      if (!current || new Date(iv.createdAt) > new Date(current.createdAt)) {
        latest.set(key, iv);
      }
    }
    return new Map(Array.from(latest, ([key, iv]) => [key, iv.interventionId]));
  }, [items]);

  // Selection is keyed per assessment + competency, so ticking one entry of a
  // mixed-competency assessment no longer ticks the other competencies that
  // belong to the same assessment.
  const selectionKey = (iv) => `${iv.assessmentId}::${iv.competencyId}`;

  function toggleSelect(key) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  }

  async function downloadSelected() {
    setExporting(true);
    setExportError(null);
    const selections = selected.map((key) => {
      const [assessmentId, competencyId] = key.split("::");
      return { assessmentId, competencyId };
    });
    const { error: err } = await exportInterventionsPdf(selections);
    setExporting(false);
    if (err) setExportError(err);
  }

  return (
    <section className="min-h-screen p-8">
      {/* Header */}
      <h1 className="text-3xl font-bold text-[#053225] mb-1">Archives</h1>
      <p className="text-sm text-[#053225]/70 mb-6">
        {isAdmin
          ? "Full history of AI Intervention recommendations generated by every teacher. Select assessment(s) below to download their reports as a single PDF."
          : "Full history of your past AI Intervention recommendations. Select assessment(s) below to download their reports as a single PDF."}
      </p>

      {/* Sort & Filter icons — top right */}
      <div className="flex justify-end gap-2 mb-3">
        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => {
              setShowSortMenu((s) => !s);
              setShowFilterMenu(false);
            }}
            className="p-2 rounded-md text-[#053225] hover:bg-[#dce9d8] transition-colors"
            aria-label="Sort"
          >
            <ArrowUpNarrowWide size={22} />
          </button>
          {showSortMenu && (
            <div className="absolute right-0 top-10 z-20 w-48 bg-[#f1fff5] rounded-lg border border-[#d4e2cf] shadow-md overflow-hidden">
              {sortOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setSort(opt.value);
                    setShowSortMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-[#6e9277]/50 transition-colors ${
                    sort === opt.value ? "font-semibold text-[#053225]" : "text-[#053225]/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            onClick={() => {
              setShowFilterMenu((s) => !s);
              setShowSortMenu(false);
            }}
            className="p-2 rounded-md text-[#053225] hover:bg-[#dce9d8] transition-colors"
            aria-label="Filter"
          >
            <Funnel size={22} />
          </button>
          {showFilterMenu && (
            <div className="absolute right-0 top-10 z-20 w-56 max-h-72 overflow-y-auto bg-[#f1fff5] rounded-lg border border-[#d4e2cf] shadow-md overflow-hidden">
              {filterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setFilter(opt.value);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-[#6e9277]/50 transition-colors ${
                    filter === opt.value ? "font-semibold text-[#053225]" : "text-[#053225]/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[#053225]/70 mb-4">
          <Loader2 className="animate-spin" size={18} /> Loading AI intervention history...
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 mb-4 text-sm">{error}</div>
      )}

      {/* History list */}
      {!loading && !error && (
        visibleItems.length === 0 ? (
          <div className="rounded-xl border border-[#d4e2cf] bg-white p-6 text-center text-sm text-[#053225]/60">
            No AI interventions generated yet. Go to <span className="font-semibold">AI Intervention</span> to create your first recommendation.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleItems.map((iv) => {
              const isLatestForCompetency =
                latestInterventionIdByCompetency.get(`${iv.assessmentId}::${iv.competencyId}`) === iv.interventionId;

              return (
              <details
                key={iv.interventionId}
                className="rounded-xl border border-[#053225]/20 bg-white p-4 open:shadow-sm"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex items-start gap-3">
                      {isLatestForCompetency ? (
                        <input
                          type="checkbox"
                          checked={selected.includes(selectionKey(iv))}
                          onChange={() => toggleSelect(selectionKey(iv))}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 mt-0.5 accent-[#053225] cursor-pointer shrink-0"
                          aria-label={`Select ${iv.assessmentTitle} for PDF export`}
                        />
                      ) : (
                        <span
                          className="w-4 h-4 mt-0.5 shrink-0"
                          title="An older draft for this same competency — superseded by a newer entry below/above."
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[#053225] font-semibold text-sm">
                          <Bot size={16} className="shrink-0" />
                          <span className="truncate">{iv.assessmentTitle}</span>
                        </div>
                        <p className="text-xs text-[#053225]/60 mt-0.5">
                          {iv.assessmentType} — {iv.term} — Competency: {iv.competencyName}
                        </p>
                        {!isLatestForCompetency && (
                          <p className="text-[11px] text-[#053225]/50 italic mt-0.5">
                            Superseded by a newer entry for this competency — not included in the export
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {isAdmin && iv.teacherName && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#053225]/70 bg-[#053225]/5 border border-[#053225]/15 rounded-full px-3 py-1">
                          <GraduationCap size={12} /> {iv.teacherName}
                        </span>
                      )}
                      {iv.aiProvider && (
                        <span className="text-xs font-medium text-[#053225]/70 bg-[#053225]/5 border border-[#053225]/15 rounded-full px-3 py-1">
                          {iv.aiProvider} ({iv.aiModel})
                        </span>
                      )}
                      <span className="text-xs text-[#053225]/50 whitespace-nowrap">
                        {formatDate(iv.createdAt)} · {formatTime(iv.createdAt)}
                      </span>
                    </div>
                  </div>
                </summary>

                <div className="mt-4 border-t border-[#e8f0e5] pt-4">
                  {iv.weaknessSummary && (
                    <details className="mb-4 rounded-lg bg-[#053225]/5 p-3 group">
                      <summary className="cursor-pointer text-xs font-semibold text-[#053225] select-none">
                        Class data used for this recommendation (click to view)
                      </summary>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 leading-relaxed mt-2">
                        {iv.weaknessSummary}
                      </pre>
                    </details>
                  )}
                  <RecommendationMarkdown>{iv.aiRecommendation}</RecommendationMarkdown>
                </div>
              </details>
              );
            })}
          </div>
        )
      )}

      {exportError && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 mt-4 text-sm">{exportError}</div>
      )}

      {/* Download button — replaces the old, separate Export tab */}
      {!loading && !error && visibleItems.length > 0 && (
        <div className="flex justify-end mt-6">
          <button
            onClick={downloadSelected}
            disabled={selected.length === 0 || exporting}
            className="inline-flex items-center gap-2 bg-[#053225] hover:bg-[#6e9277] text-[#f1fff5] text-sm font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
            {exporting ? "Generating PDF..." : `Download AI Interventions PDF (${selected.length})`}
          </button>
        </div>
      )}
    </section>
  );
};

export default Archives;
