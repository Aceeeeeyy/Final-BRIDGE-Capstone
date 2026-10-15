import React, { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, RotateCcw, Trash2, X, Check } from "lucide-react";
import { getCompetencies, createCompetency, updateCompetency, retireCompetency } from "../../services/api";

// ── ManageCompetencies ───────────────────────────────────────────────────────
// Administrator-only. Competencies were previously two hardcoded, immutable
// seed rows (Tenses of Verbs, Figures of Speech) baked into schema.sql. This
// page makes the taxonomy admin-editable — the study itself still scopes
// BRIDGE's evaluation to those two MATATAG competencies, but the system no
// longer requires a code change to add a third (e.g. Reading Comprehension)
// down the line, which is what lets it generalize past this capstone.
const ManageCompetencies = () => {
  const [competencies, setCompetencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  async function load() {
    setLoading(true);
    const { data, error: err } = await getCompetencies({ includeInactive });
    if (err) setError(err);
    else { setCompetencies(data || []); setError(null); }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeInactive]);

  async function handleAdd() {
    if (!newName.trim()) { setFormError("Competency name is required."); return; }
    setSaving(true);
    setFormError(null);
    const { error: err } = await createCompetency({ competencyName: newName.trim(), description: newDescription.trim() || undefined });
    setSaving(false);
    if (err) { setFormError(err); return; }
    setNewName(""); setNewDescription(""); setShowAddForm(false);
    load();
  }

  function startEdit(c) {
    setEditingId(c.competency_id);
    setEditName(c.competency_name);
    setEditDescription(c.description || "");
  }

  async function saveEdit(id) {
    setSaving(true);
    const { error: err } = await updateCompetency(id, { competencyName: editName.trim(), description: editDescription.trim() || null });
    setSaving(false);
    if (err) { setError(err); return; }
    setEditingId(null);
    load();
  }

  async function toggleActive(c) {
    if (c.is_active) {
      if (!window.confirm(`Retire "${c.competency_name}"? Existing questions and results that reference it are kept — it just won't appear as an option for new tests.`)) return;
      await retireCompetency(c.competency_id);
    } else {
      await updateCompetency(c.competency_id, { isActive: true });
    }
    load();
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-slate-950">Manage Competencies</h1>
          <p className="max-w-2xl text-slate-600">
            Add, edit, or retire the English competencies teachers can select when building tests and
            generating AI interventions.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#053225] text-white font-semibold px-5 py-2.5 hover:bg-[#6E9277] transition"
        >
          <Plus size={16} /> Add Competency
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-2xl bg-[#053225]/10 p-6 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Competency name (e.g. Reading Comprehension)"
              className="rounded-lg border border-[#053225]/30 bg-white px-4 py-2 text-sm"
            />
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Short description (optional)"
              className="rounded-lg border border-[#053225]/30 bg-white px-4 py-2 text-sm"
            />
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#053225] text-white text-sm font-semibold px-4 py-2 hover:bg-[#6E9277] transition disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
            <button
              onClick={() => { setShowAddForm(false); setFormError(null); }}
              className="inline-flex items-center gap-2 rounded-lg bg-white border border-[#053225]/30 text-[#053225] text-sm font-semibold px-4 py-2"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-[#053225]/80 w-fit">
        <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
        Show retired competencies
      </label>

      {loading && (
        <div className="flex items-center gap-2 text-[#053225]/70">
          <Loader2 className="animate-spin" size={18} /> Loading competencies...
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4 text-sm">{error}</div>}

      {!loading && !error && (
        <div className="rounded-2xl bg-white border border-[#053225]/10 shadow-sm overflow-hidden">
          {competencies.length === 0 ? (
            <p className="p-6 text-sm text-[#053225]/60">No competencies yet. Add one above.</p>
          ) : (
            competencies.map((c) => (
              <div key={c.competency_id} className={`p-5 border-b border-[#053225]/5 last:border-0 ${!c.is_active ? "opacity-60" : ""}`}>
                {editingId === c.competency_id ? (
                  <div className="space-y-2">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-lg border border-[#053225]/30 px-3 py-1.5 text-sm" />
                    <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description" className="w-full rounded-lg border border-[#053225]/30 px-3 py-1.5 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(c.competency_id)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#053225] text-white text-xs font-semibold px-3 py-1.5">
                        <Check size={12} /> Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#053225]/30 text-[#053225] text-xs font-semibold px-3 py-1.5">
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <div className="font-semibold text-[#053225] flex items-center gap-2">
                        {c.competency_name}
                        {!c.is_active && <span className="text-xs font-medium text-slate-400 border border-slate-300 rounded-full px-2 py-0.5">Retired</span>}
                      </div>
                      {c.description && <div className="text-sm text-slate-600 mt-0.5">{c.description}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(c)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#053225]/30 text-[#053225] text-xs font-semibold px-3 py-1.5 hover:bg-[#053225]/5">
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => toggleActive(c)}
                        className={`inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-3 py-1.5 border ${
                          c.is_active ? "border-red-300 text-red-600 hover:bg-red-50" : "border-green-300 text-green-700 hover:bg-green-50"
                        }`}
                      >
                        {c.is_active ? <><Trash2 size={12} /> Retire</> : <><RotateCcw size={12} /> Restore</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};

export default ManageCompetencies;
