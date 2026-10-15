import { useState, useRef, useEffect } from "react";
import { UploadCloud, CheckCircle2, Loader2, FileClock, FileCheck2, Pencil, RefreshCw, Trash2, Inbox } from "lucide-react";
import QuestionBuilder from "../modals/QuestionBuilder";
import { uploadCSV, listAssessments, deleteAssessment } from "../../services/api";

const Upload = () => {
  const [creating, setCreating] = useState(false);
  const [testType, setTestType] = useState(null);
  const [resumeId, setResumeId] = useState(null);

  // "My Tests" — every assessment the teacher owns, at any stage (Draft /
  // Ready for Upload / Completed). This is what lets a teacher pick back up
  // right where they left off, from any device, any time.
  const [tests, setTests] = useState([]);
  const [loadingTests, setLoadingTests] = useState(true);
  const [testsError, setTestsError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // The test currently selected as the CSV upload target.
  const [selected, setSelected] = useState(null); // { assessmentId, assessmentTitle }

  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null);
  const [uploadErr, setUploadErr] = useState(null);
  const [keyWarning, setKeyWarning] = useState(null);
  const [keyMismatches, setKeyMismatches] = useState([]);
  const fileInputRef = useRef(null);

  async function refreshTests() {
    setLoadingTests(true);
    const { data, error } = await listAssessments();
    setLoadingTests(false);
    if (error) { setTestsError(error); return; }
    setTestsError(null);
    setTests(data || []);
  }

  useEffect(() => { refreshTests(); }, []);

  function startCreating(type) {
    setTestType(type);
    setResumeId(null);
    setCreating(true);
  }

  function resumeDraft(test) {
    setTestType(test.assessment_type);
    setResumeId(test.assessment_id);
    setCreating(true);
  }

  // Called by QuestionBuilder once the test is published (locked in + ready for scores).
  function handleAssessmentCreated({ assessmentId: id, assessmentTitle: title }) {
    setCreating(false);
    setSelected({ assessmentId: id, assessmentTitle: title });
    setUploadMsg(null);
    setUploadErr(null);
    refreshTests();
  }

  function handleBackFromBuilder() {
    setCreating(false);
    refreshTests();
  }

  async function handleDeleteTest(test) {
    // Drafts have nothing to lose; a published test's questions and answer key
    // would be gone for good, so ask first.
    if (test.status === "Ready for Upload") {
      const ok = window.confirm(`Delete "${test.assessment_title}"? It hasn't received any scores yet, but its questions and answer key will be permanently removed.`);
      if (!ok) return;
    }
    setDeletingId(test.assessment_id);
    const { error } = await deleteAssessment(test.assessment_id);
    setDeletingId(null);
    if (error) { setTestsError(error); return; }
    if (selected?.assessmentId === test.assessment_id) setSelected(null);
    refreshTests();
  }

  function selectForUpload(test) {
    setSelected({ assessmentId: test.assessment_id, assessmentTitle: test.assessment_title });
    setUploadMsg(null);
    setUploadErr(null);
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  async function handleUpload(file) {
    if (!selected) {
      setUploadErr("Pick a published test above first, then upload its CSV.");
      return;
    }
    setUploading(true);
    setUploadErr(null);
    setUploadMsg(null);
    setKeyWarning(null);
    setKeyMismatches([]);

    const { data, error } = await uploadCSV(selected.assessmentId, file);
    setUploading(false);

    if (error) {
      setUploadErr(error);
      return;
    }

    setUploadMsg(data?.message || "CSV uploaded successfully.");
    // The backend reports per-row reasons for anything it skipped (e.g. no
    // student name found) — surface those too, or "0 processed" looks like
    // a silent failure instead of the specific, fixable reason it actually is.
    if (data?.errors?.length) {
      setUploadErr(data.errors.slice(0, 10).join(" \u2022 ") + (data.errors.length > 10 ? ` \u2026 and ${data.errors.length - 10} more` : ""));
    }
    // A key/order mismatch between BRIDGE and ZipGrade is the #1 cause of
    // "the scores look wrong" — flag it plainly instead of leaving it to
    // show up as a confusing item analysis later.
    if (data?.keyWarning) {
      setKeyWarning(data.keyWarning);
      setKeyMismatches(data.keyMismatches || []);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    refreshTests();
  }

  if (creating) {
    return (
      <QuestionBuilder
        testType={testType}
        resumeAssessmentId={resumeId}
        onBack={handleBackFromBuilder}
        onCreated={handleAssessmentCreated}
      />
    );
  }

  const drafts = tests.filter((t) => t.status === "Draft");
  const readyTests = tests.filter((t) => t.status === "Ready for Upload");
  const completedTests = tests.filter((t) => t.status === "Completed");

  return (
    <section className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl text-[#053225] font-semibold">Upload</h1>
      </div>

      {/* Notice Message */}
      <div className="rounded-xl border-l-4 border-[#053225] bg-[#6E9277]/50 p-4 mb-8">
        <strong className="block text-[#053225]">Notice</strong>
        <p className="text-sm text-[#053225]">Every question is saved to the database the moment you add it, so it's safe to exit at any point while building a test — just come back to "My Tests" below to resume.</p>
        <p className="text-sm text-[#053225]">Once a test is published, it stays ready here for CSV score uploads any time, from any device.</p>
      </div>

      {/* Test type  */}
      <div className="rounded-2xl bg-[#6E9277]/50 p-10 mb-8 shadow-inner">
        <h2 className="text-center text-xl text-[#053225] font-semibold mb-6">Please select the type of test you're creating:</h2>
        <div className="flex justify-center gap-8">
          <button
            onClick={() => startCreating("Summative Test")}
            className="rounded-lg bg-[#6E9277] px-10 py-4 text-lg text-[#F1FFF5] font-semibold shadow-md hover:bg-[#053225] transition"
          >
            Summative Test
          </button>
          <button
            onClick={() => startCreating("Term Examination")}
            className="rounded-lg bg-[#6E9277] px-10 py-4 text-lg text-[#F1FFF5] font-semibold shadow-md hover:bg-[#053225] transition"
          >
            Term Examination
          </button>
        </div>
      </div>

      {/* My Tests */}
      <div className="rounded-2xl bg-white border border-[#053225]/15 p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl text-[#053225] font-semibold">My Tests</h2>
          <button onClick={refreshTests} className="inline-flex items-center gap-1 text-sm text-[#053225] hover:underline">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loadingTests && (
          <div className="flex items-center gap-2 text-[#053225]/70 text-sm py-4">
            <Loader2 size={16} className="animate-spin" /> Loading your tests...
          </div>
        )}
        {testsError && (
          <div className="text-sm text-red-600 mb-3">Could not load tests: {testsError}</div>
        )}

        {!loadingTests && tests.length === 0 && !testsError && (
          <div className="flex flex-col items-center justify-center py-10 text-[#053225]/50">
            <Inbox size={64} className="mb-2" />
            <p>No tests yet. Create one above to get started.</p>
          </div>
        )}

        {!loadingTests && tests.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Drafts */}
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#053225] mb-2">
                <FileClock size={16} /> Drafts ({drafts.length})
              </div>
              <div className="space-y-2">
                {drafts.length === 0 && <p className="text-xs text-[#053225]/50">Nothing in progress.</p>}
                {drafts.map((t) => (
                  <div key={t.assessment_id} className="rounded-lg bg-[#6E9277]/15 border border-[#053225]/15 p-3">
                    <div className="text-sm text-[#053225] font-semibold truncate">{t.assessment_title}</div>
                    <div className="text-xs text-[#053225]/70 mb-2">{t.assessment_type} &middot; {t.question_count} question{t.question_count === 1 ? "" : "s"} so far</div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resumeDraft(t)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#053225] text-[#F1FFF5] hover:bg-[#6E9277]"
                      >
                        <Pencil size={12} /> Resume editing
                      </button>
                      <button
                        onClick={() => handleDeleteTest(t)}
                        disabled={deletingId === t.assessment_id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> {deletingId === t.assessment_id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ready for Upload */}
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#053225] mb-2">
                <UploadCloud size={16} /> Ready for scores ({readyTests.length})
              </div>
              <div className="space-y-2">
                {readyTests.length === 0 && <p className="text-xs text-[#053225]/50">Nothing awaiting scores.</p>}
                {readyTests.map((t) => (
                  <div
                    key={t.assessment_id}
                    className={`rounded-lg border p-3 ${selected?.assessmentId === t.assessment_id ? "bg-[#053225]/10 border-[#053225]" : "bg-[#6E9277]/15 border-[#053225]/15"}`}
                  >
                    <div className="text-sm text-[#053225] font-semibold truncate">{t.assessment_title}</div>
                    <div className="text-xs text-[#053225]/70 mb-2">{t.assessment_type} &middot; {t.total_items} question{t.total_items === 1 ? "" : "s"}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => selectForUpload(t)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#053225] text-[#F1FFF5] hover:bg-[#6E9277]"
                      >
                        <UploadCloud size={12} /> {selected?.assessmentId === t.assessment_id ? "Selected below" : "Select for CSV upload"}
                      </button>
                      <button
                        onClick={() => resumeDraft(t)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#6E9277] text-[#F1FFF5] hover:bg-[#053225]"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTest(t)}
                        disabled={deletingId === t.assessment_id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> {deletingId === t.assessment_id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Completed */}
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#053225] mb-2">
                <FileCheck2 size={16} /> Completed ({completedTests.length})
              </div>
              <div className="space-y-2">
                {completedTests.length === 0 && <p className="text-xs text-[#053225]/50">No scores uploaded yet.</p>}
                {completedTests.map((t) => (
                  <div
                    key={t.assessment_id}
                    className={`rounded-lg border p-3 ${selected?.assessmentId === t.assessment_id ? "bg-[#053225]/10 border-[#053225]" : "bg-[#6E9277]/15 border-[#053225]/15"}`}
                  >
                    <div className="text-sm text-[#053225] font-semibold truncate">{t.assessment_title}</div>
                    <div className="text-xs text-[#053225]/70 mb-2">{t.assessment_type} &middot; scores uploaded</div>
                    <button
                      onClick={() => selectForUpload(t)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#6E9277] text-[#F1FFF5] hover:bg-[#053225]"
                    >
                      <RefreshCw size={12} /> {selected?.assessmentId === t.assessment_id ? "Selected below" : "Re-upload CSV"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Currently selected assessment indicator */}
      {selected && (
        <div className="rounded-xl border border-[#053225]/30 bg-white p-4 mb-6 flex items-center gap-3">
          <CheckCircle2 className="text-[#053225]" size={20} />
          <p className="text-sm text-[#053225]">
            Ready to upload scores for: <span className="font-semibold">{selected.assessmentTitle}</span>
          </p>
        </div>
      )}

      {/* CSV upload */}
      <div className="rounded-2xl bg-[#053225]/50 p-10 flex flex-col items-center gap-6">
        <h3 className="text-center text-xl text-[#F1FFF5] font-semibold">Done with the exams? Upload test scores here:</h3>
        <p className="text-center text-sm text-[#F1FFF5]/80 -mt-3">
          Export the results from ZipGrade as a CSV ("Export Data" &rarr; CSV) and upload it here. Works for any
          number of items — it just needs to match the number of questions in the test you selected above.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
          id="csv-upload-input"
        />
        <label
          htmlFor="csv-upload-input"
          className={`inline-flex items-center gap-2 rounded-lg bg-[#053225] text-[#F1FFF5] font-semibold px-6 py-3 transition cursor-pointer ${
            !selected ? "opacity-50 cursor-not-allowed" : "hover:bg-[#6E9277]"
          }`}
          onClick={(e) => {
            if (!selected) {
              e.preventDefault();
              setUploadErr("Pick a published test above first, then upload its CSV.");
            }
          }}
        >
          <UploadCloud size={20} /> {uploading ? "Uploading..." : "Upload CSV file"}
        </label>

        {uploadMsg && <p className="text-sm text-[#F1FFF5]/90 bg-[#053225]/40 rounded-lg px-4 py-2">{uploadMsg}</p>}
        {uploadErr && <p className="text-sm text-red-200 bg-red-900/40 rounded-lg px-4 py-2">{uploadErr}</p>}

        {keyWarning && (
          <div className="w-full max-w-xl rounded-lg bg-amber-100 border border-amber-400 text-amber-900 text-sm px-4 py-3">
            <p className="font-semibold mb-2">⚠ Key mismatch detected</p>
            <p className="mb-2">{keyWarning}</p>
            {keyMismatches.length > 0 && (
              <table className="w-full text-xs mt-2">
                <thead>
                  <tr className="text-left border-b border-amber-400">
                    <th className="py-1 pr-2">Item</th>
                    <th className="py-1 pr-2">BRIDGE key</th>
                    <th className="py-1">ZipGrade key</th>
                  </tr>
                </thead>
                <tbody>
                  {keyMismatches.map((m) => (
                    <tr key={m.questionNumber} className="border-b border-amber-200/60">
                      <td className="py-1 pr-2">Q{m.questionNumber}</td>
                      <td className="py-1 pr-2 font-semibold">{m.bridgeKey}</td>
                      <td className="py-1">{m.zipGradeKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default Upload;
