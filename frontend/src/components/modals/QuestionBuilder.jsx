import { useState, useEffect, useRef } from "react";
import { ArrowLeft, SquarePen, Save, FileQuestionMark, Loader2, CloudCheck, CloudUpload, CloudAlert, Lock } from "lucide-react";
import QuestionCard from "./QuestionCard";
import {
  getCompetencies,
  createDraftAssessment,
  updateAssessmentDraft,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  publishAssessment,
  getAssessment,
  deleteAssessment,
} from "../../services/api";

// - `testType` prop: which test type was chosen on the Upload page (used only
//   when starting a brand-new draft; ignored when resuming one).
// - `resumeAssessmentId` prop: if set, reopens that existing draft instead of
//   creating a new one — this is what makes "exit and come back later" work.
// - `onBack` prop returns to the previous screen.
// - `onCreated({ assessmentId, assessmentTitle })` is called once the test is
//   published (locked in and ready to receive CSV score uploads).
const QuestionBuilder = ({ testType, resumeAssessmentId, onBack, onCreated }) => {
  // ── Draft identity + lifecycle ──────────────────────────────────────────
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState(null);
  const [assessmentId, setAssessmentId] = useState(resumeAssessmentId || null);
  // True when we reopened a test that is already published ("Ready for Upload").
  // Such a test is edited in place: no publish call, just "Save Changes".
  const [alreadyPublished, setAlreadyPublished] = useState(false);
  // True once the server reports the test has scores (status "Completed"). This
  // can happen mid-edit if a CSV is uploaded from another tab or device; the
  // builder then goes read-only instead of showing confusing save errors.
  const [locked, setLocked] = useState(false);
  // Set when the teacher tries to leave a published test in a broken state.
  const [leaveError, setLeaveError] = useState(false);
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentType, setAssessmentType] = useState(testType || "");
  const [term, setTerm] = useState("Term 1");
  // DepEd school year (e.g. "2026-2027"). New tests default on the server to
  // the current school year; it is editable so a test can be filed under the
  // right year, which keeps the Competency Trend from mixing years together.
  const [schoolYear, setSchoolYear] = useState("");

  // Autosave status for the title/term fields ("idle" | "saving" | "saved" | "error")
  const [draftSaveStatus, setDraftSaveStatus] = useState("idle");
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  // Guards the "create a brand-new draft" call below against firing twice.
  // React 18 StrictMode intentionally mounts effects twice in development
  // (mount → cleanup → mount again) to surface bugs like this one. We cache
  // the in-flight request itself (not just a boolean) so the second mount
  // awaits the SAME request instead of either firing a duplicate call or
  // bailing out before it ever finishes — the latter is what left the
  // draft screen stuck on "Setting up your draft..." forever.
  const creationPromiseRef = useRef(null);

  // Competencies loaded from the backend
  const [competencies, setCompetencies] = useState([]);
  const [loadingCompetencies, setLoadingCompetencies] = useState(true);
  const [competenciesError, setCompetenciesError] = useState(null);

  // Questions already saved to the database for this draft
  const [questions, setQuestions] = useState([]);
  const [questionSaving, setQuestionSaving] = useState(false);
  const [questionError, setQuestionError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Form state for creating or editing a single question.
  const [competencyId, setCompetencyId] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [answers, setAnswers] = useState([false, false, false, false]);
  const [editingId, setEditingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);

  // Converts a question row from the backend into the shape QuestionCard expects.
  function toDisplayQuestion(q, competencyNameOverride) {
    const letters = (q.correct_answer || "").split(",").map((s) => s.trim()).filter(Boolean);
    const ansIdx = letters.map((l) => l.charCodeAt(0) - 65);
    const cId = q.competency_id ?? q.competencies?.competency_id ?? "";
    const cName =
      competencyNameOverride ??
      q.competencies?.competency_name ??
      competencies.find((c) => c.competency_id === cId)?.competency_name;
    // Pad/trim to always give the form four option slots to edit, regardless
    // of how many the question was originally saved with.
    const savedOptions = Array.isArray(q.options) ? q.options : [];
    const paddedOptions = [0, 1, 2, 3].map((i) => savedOptions[i] ?? "");
    return {
      id: q.question_id,
      competencyId: cId,
      competencyName: cName,
      text: q.question_text,
      options: paddedOptions,
      answers: ansIdx,
      correctAnswer: q.correct_answer,
    };
  }

  // ── Load competencies ─────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await getCompetencies();
      if (!active) return;
      if (error) {
        setCompetenciesError(error);
      } else {
        setCompetencies(data || []);
      }
      setLoadingCompetencies(false);
    })();
    return () => { active = false; };
  }, []);

  // ── Create a new draft, or resume an existing one ────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      if (resumeAssessmentId) {
        const { data, error } = await getAssessment(resumeAssessmentId);
        if (!active) return;
        if (error || !data) {
          setInitError(error || "Could not load this draft.");
          setInitializing(false);
          return;
        }
        setAssessmentId(data.assessment_id);
        setAlreadyPublished(data.status === "Ready for Upload");
        setAssessmentTitle(data.assessment_title === "Untitled test" ? "" : data.assessment_title);
        setAssessmentType(data.assessment_type);
        setTerm(data.term);
        setSchoolYear(data.school_year || "");
        setQuestions((data.questions || []).map((q) => toDisplayQuestion(q)));
      } else {
        // Both StrictMode mounts share the same request: the first mount
        // starts it and caches the promise; the second mount (the one that
        // actually stays around) reuses that same promise and awaits it to
        // completion, instead of firing a second call or skipping init.
        if (!creationPromiseRef.current) {
          creationPromiseRef.current = createDraftAssessment({
            assessmentTitle: "",
            assessmentType: testType,
            term: "Term 1",
          });
        }

        const { data, error } = await creationPromiseRef.current;
        if (!active) return;
        if (error || !data) {
          creationPromiseRef.current = null; // allow a retry on failure
          setInitError(error || "Could not start a new draft.");
          setInitializing(false);
          return;
        }
        setAssessmentId(data.assessmentId);
      }
      setInitializing(false);
      // Defer marking "hydrated" until after this render/effect cycle so the
      // autosave effect below doesn't immediately re-save the just-loaded values.
      setTimeout(() => { hydratedRef.current = true; }, 0);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeAssessmentId]);

  // ── Autosave title / term as the teacher edits them ───────────────────
  useEffect(() => {
    if (!assessmentId || !hydratedRef.current || locked) return;
    setDraftSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const { error } = await updateAssessmentDraft(assessmentId, { assessmentTitle, term, ...(/^\d{4}-\d{4}$/.test(schoolYear) ? { schoolYear } : {}) });
      if (error && (await checkLocked())) return;
      setDraftSaveStatus(error ? "error" : "saved");
    }, 700);
    return () => clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentTitle, term, schoolYear, assessmentId, locked]);

  // After any failed save, ask the server whether the test has been locked
  // (scores uploaded elsewhere). If so, switch the builder to read-only.
  async function checkLocked() {
    if (locked) return true;
    const { data } = await getAssessment(assessmentId);
    if (data?.status === "Completed") {
      setLocked(true);
      return true;
    }
    return false;
  }

  // Default the competency radio to the first option once competencies load.
  useEffect(() => {
    if (competencies.length && !competencyId) setCompetencyId(competencies[0].competency_id);
  }, [competencies, competencyId]);

  // Reset form to empty values
  function resetForm() {
    setCompetencyId(competencies[0]?.competency_id || "");
    setQuestionText("");
    setOptions(["", "", "", ""]);
    setAnswers([false, false, false, false]);
    setEditingId(null);
    setSelectedId(null); // form is cleared, so nothing should look selected
    setQuestionError(null);
  }

  // Save button handler: writes the question straight to the database.
  async function handleSave() {
    if (!questionText.trim()) return;
    const correctLetters = answers
      .map((v, i) => (v ? String.fromCharCode(65 + i) : null))
      .filter(Boolean);

    if (correctLetters.length === 0) {
      setQuestionError("Tick the checkbox of at least one correct answer.");
      return;
    }

    // A ticked checkbox with no option text is a blank answer key — require
    // wording for every option that's marked correct.
    const uncheckedAnswerText = answers.some((checked, i) => checked && !options[i].trim());
    if (uncheckedAnswerText) {
      setQuestionError("Fill in the option text for every choice you've ticked as correct.");
      return;
    }

    // Require at least two filled-in options so the question is actually a
    // usable multiple choice item, not just a bare answer key.
    const filledOptionCount = options.filter((opt) => opt.trim()).length;
    if (filledOptionCount < 2) {
      setQuestionError("Add text for at least two answer choices.");
      return;
    }

    setQuestionSaving(true);
    setQuestionError(null);

    const payload = {
      questionText,
      competencyId,
      options,
      correctAnswer: correctLetters.join(","),
    };
    const competencyName = competencies.find((c) => c.competency_id === competencyId)?.competency_name;

    if (editingId) {
      const { data, error } = await updateQuestion(assessmentId, editingId, payload);
      setQuestionSaving(false);
      if (error) { if (!(await checkLocked())) setQuestionError(error); return; }
      const display = toDisplayQuestion(data.question, competencyName);
      setQuestions((prev) => prev.map((q) => (q.id === editingId ? display : q)));
    } else {
      const { data, error } = await addQuestion(assessmentId, payload);
      setQuestionSaving(false);
      if (error) { if (!(await checkLocked())) setQuestionError(error); return; }
      const display = toDisplayQuestion(data.question, competencyName);
      setQuestions((prev) => [...prev, display]);
    }

    resetForm();
  }

  // Click on a question in the right panel to edit/select it
  function handleSelect(q) {
    setSelectedId(q.id);
    setCompetencyId(q.competencyId || competencies[0]?.competency_id || "");
    setQuestionText(q.text || "");
    setOptions(Array.isArray(q.options) ? q.options : ["", "", "", ""]);
    const ansBools = [false, false, false, false];
    if (Array.isArray(q.answers)) q.answers.forEach((idx) => (ansBools[idx] = true));
    setAnswers(ansBools);
    setEditingId(q.id);
    setQuestionError(null);
  }

  async function handleDelete(q) {
    setDeletingId(q.id);
    const { error } = await deleteQuestion(assessmentId, q.id);
    setDeletingId(null);
    if (error) { if (!(await checkLocked())) setQuestionError(error); return; }
    setQuestions((prev) => prev.filter((item) => item.id !== q.id));
    if (editingId === q.id) resetForm();
  }

  function toggleAnswer(i) {
    setAnswers((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  }

  function updateOption(i, value) {
    setOptions((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  // Locks in the draft and moves it to "Ready for Upload". For a test that is
  // already published, this just validates and returns to the list (every
  // change was already saved as it was made).
  async function handlePublish() {
    setPublishError(null);

    if (!assessmentTitle.trim()) {
      setPublishError(alreadyPublished ? "A test needs a title." : "Give this test a title before publishing.");
      return;
    }
    if (questions.length === 0) {
      setPublishError(alreadyPublished ? "A test needs at least one question. Add one, or go back and delete the test." : "Add at least one question before publishing.");
      return;
    }

    if (alreadyPublished) {
      onBack?.();
      return;
    }

    setPublishing(true);
    const { error } = await publishAssessment(assessmentId);
    setPublishing(false);

    if (error) {
      setPublishError(error);
      return;
    }

    onCreated?.({ assessmentId, assessmentTitle });
  }

  // If the teacher leaves an untouched, empty draft, quietly delete it so the
  // "My Tests" list doesn't fill up with blank drafts.
  // A published test must never be left without a title or any questions, or
  // it would sit in "Ready for scores" but fail every CSV upload.
  const brokenPublished = alreadyPublished && !locked && (questions.length === 0 || !assessmentTitle.trim());

  async function handleBack() {
    if (brokenPublished) {
      setLeaveError(true);
      return;
    }
    if (!alreadyPublished && assessmentId && questions.length === 0 && !assessmentTitle.trim()) {
      await deleteAssessment(assessmentId);
    }
    onBack?.();
  }

  // Escape hatch for the guard above: abandon a published test that has no
  // questions left, rather than forcing the teacher to add a throwaway one.
  async function handleDeleteInstead() {
    if (!window.confirm(`Delete "${assessmentTitle.trim() || "this test"}"? It has no questions and no scores.`)) return;
    const { error } = await deleteAssessment(assessmentId);
    if (error) { setQuestionError(error); return; }
    onBack?.();
  }

  if (initializing) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-[#053225]">
        <Loader2 size={18} className="animate-spin" /> Setting up your draft...
      </div>
    );
  }

  if (initError) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-4 mb-4">{initError}</div>
        <button onClick={onBack} className="inline-flex items-center gap-2 px-4 py-2 bg-[#053225] text-[#F1FFF5] rounded-lg">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex p-6 gap-6">
      {/* Main content area */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={handleBack} className="p-2 rounded-md hover:bg-[#053225]/10 transition">
              <ArrowLeft />
            </button>
            <div>
              <h1 className="text-2xl text-[#053225] font-semibold">Create Questions</h1>
              <div className="text-sm text-[#053225]">Test type: {assessmentType || "-"}</div>
            </div>
          </div>

          {/* Autosave indicator */}
          <div className="flex items-center gap-2 text-xs text-[#053225]">
            {draftSaveStatus === "saving" && (<><CloudUpload size={14} className="animate-pulse" /> Saving draft...</>)}
            {draftSaveStatus === "saved" && (<><CloudCheck size={14} /> Draft saved — safe to exit any time</>)}
            {draftSaveStatus === "error" && (<><CloudAlert size={14} className="text-red-600" /> <span className="text-red-600">Couldn't save draft</span></>)}
          </div>
        </div>

        {locked && (
          <div className="rounded-lg bg-amber-100 border border-amber-400 text-amber-900 text-sm p-4 mb-4 flex items-start gap-3">
            <Lock size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">This test is now locked</p>
              <p>Scores were uploaded for this test (possibly from another tab or device), so it can no longer be edited. Everything you saved before then is kept.</p>
              <button onClick={onBack} className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[#053225] text-[#F1FFF5] rounded-lg font-semibold hover:bg-[#6E9277] transition">
                <ArrowLeft size={16} /> Back to My Tests
              </button>
            </div>
          </div>
        )}

        {leaveError && brokenPublished && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-4 mb-4">
            <p className="font-semibold">This published test can't be left incomplete</p>
            <p>
              {questions.length === 0
                ? "It has no questions, so CSV uploads would fail. Add at least one question, or delete the test."
                : "It needs a title. Type one below before leaving."}
            </p>
            {questions.length === 0 && (
              <button onClick={handleDeleteInstead} className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition">
                Delete this test instead
              </button>
            )}
          </div>
        )}

        <fieldset disabled={locked} className={`border-0 p-0 m-0 min-w-0 ${locked ? "opacity-60" : ""}`}>
        {/* Assessment title + term */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <input
            type="text"
            placeholder="Test title (e.g. Quiz 1: Verb Tenses)"
            value={assessmentTitle}
            onChange={(e) => setAssessmentTitle(e.target.value)}
            className="col-span-2 rounded-lg p-3 bg-[#6E9277]/25 border border-[#053225]/30 text-[#053225] placeholder-[#053225]/50 focus:outline-none"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="SY 2026-2027"
            title="School year, e.g. 2026-2027"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value.trim())}
            className="rounded-lg p-3 bg-[#6E9277]/25 border border-[#053225]/30 text-[#053225] placeholder-[#053225]/50 focus:outline-none"
          />
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="rounded-lg p-3 bg-[#6E9277]/25 border border-[#053225]/30 text-[#053225] focus:outline-none"
          >
            <option value="Term 1">Term 1</option>
            <option value="Term 2">Term 2</option>
            <option value="Term 3">Term 3</option>
          </select>
        </div>

        {/* Competency radios — loaded from backend */}
        <div className="mb-4">
          {loadingCompetencies && (
            <div className="flex items-center gap-2 text-[#053225]/70 text-sm">
              <Loader2 size={16} className="animate-spin" /> Loading competencies...
            </div>
          )}
          {competenciesError && (
            <div className="text-sm text-red-600">Could not load competencies: {competenciesError}</div>
          )}
          {!loadingCompetencies && !competenciesError && competencies.map((c) => (
            <label key={c.competency_id} className="inline-flex items-center mr-6 text-[#053225]">
              <input
                type="radio"
                name="competency"
                checked={competencyId === c.competency_id}
                onChange={() => setCompetencyId(c.competency_id)}
                className="mr-2 accent-[#053225]"
              />
              {c.competency_name}
            </label>
          ))}
        </div>

        {/* Question number marker: shows which question this form is currently
            building/editing so the teacher never loses track while adding a
            long run of questions. Purely derived from live list position —
            editing recomputes it and deleting shifts it automatically. */}
        <div className="mb-2 text-sm font-semibold text-[#053225]">
          {editingId
            ? `Editing Question #${questions.findIndex((q) => q.id === editingId) + 1}`
            : `Question #${questions.length + 1}`}
        </div>

        {/* Question text */}
        <div className="mb-4">
          <textarea
            placeholder="Type question here..."
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            className="w-full rounded-lg p-4 h-36 bg-[#6E9277]/25 border border-[#053225]/30 text-[#053225] placeholder-[#053225]/50 focus:outline-none"
          />
        </div>

        {/* Options with checkboxes */}
        <div className="mb-6 space-y-3">
          <div className="text-sm text-[#053225]">Tick the checkbox of the correct answer/s</div>
          {options.map((opt, i) => (
            <label key={i} className="flex items-center gap-3 bg-[#6E9277]/25 p-3 rounded-md">
              <input
                type="checkbox"
                checked={answers[i] || false}
                onChange={() => toggleAnswer(i)}
                className="accent-[#053225]"
              />
              <span className="text-[#053225] font-semibold mr-2">{String.fromCharCode(65 + i)}.</span>
              <input
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${String.fromCharCode(65 + i)} text`}
                className="flex-1 bg-transparent outline-none"
              />
            </label>
          ))}
        </div>

        {questionError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3 mb-4">
            {questionError}
          </div>
        )}

        {/* Edit & Save Buttons */}
        <div className="flex gap-4 mb-4">
          <button
            onClick={resetForm}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#6E9277] text-[#F1FFF5] rounded-lg font-semibold hover:bg-[#053225] transition"
          >
            <SquarePen size={16} />
            Clear
          </button>
          <button
            onClick={handleSave}
            disabled={questionSaving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#053225] text-[#F1FFF5] rounded-lg font-semibold hover:bg-[#6E9277] transition disabled:opacity-60"
          >
            {questionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {editingId ? "Update Question" : "Add Question"}
          </button>
        </div>

        {publishError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3 mb-4">
            {publishError}
          </div>
        )}

        {/* Publish: locks the draft in and makes it ready for CSV score uploads */}
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#053225] text-[#F1FFF5] rounded-lg font-semibold hover:bg-[#6E9277] transition disabled:opacity-60"
        >
          {publishing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {alreadyPublished
            ? `Save Changes (${questions.length} question${questions.length === 1 ? "" : "s"})`
            : publishing ? "Publishing test..." : `Publish Test (${questions.length} question${questions.length === 1 ? "" : "s"})`}
        </button>
        <p className="text-xs text-[#053225]/70 mt-2">
          {alreadyPublished
            ? "This test is already published. Changes are saved as you make them, and it stays ready for CSV scores. Editing is locked once scores are uploaded."
            : "Every question you add is saved right away, so it's safe to leave and come back later. Publishing locks the questions in and makes this test ready to receive a CSV of scores, any time."}
        </p>
        </fieldset>
      </div>

      {/* Right side panel: list of saved questions*/}
      <aside className="w-80 border-l pl-6 flex flex-col border-[#053225]/20">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Questions</h3>
        </div>
        <div className="flex-1 overflow-auto pr-2">
          {questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <div className="mb-3">
                <FileQuestionMark size={200} className="text-[#053225]/50" />
              </div>
              <div className="text-center text-[#053225]/50">No questions created yet</div>
            </div>
          ) : (
            <div className="space-y-2">
              {questions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  number={i + 1}
                  selected={selectedId === q.id}
                  onClick={() => { if (!locked) handleSelect(q); }}
                  onDelete={locked || deletingId === q.id ? undefined : () => handleDelete(q)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default QuestionBuilder;
