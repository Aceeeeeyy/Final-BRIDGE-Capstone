import { Trash2 } from "lucide-react";

// Props:
// - question: the question object
// - number: this question's current position marker (e.g. 1 for "Question #1").
//   Always derived from the question's live position in the list, so
//   deleting an earlier question automatically shifts every marker after
//   it down by one — nothing is stored, so there's never a gap to fix.
// - selected: boolean, whether this item is currently selected
// - onClick: function to call when clicked
// - onDelete: optional function to call when the delete icon is clicked
const QuestionCard = ({ question, number, selected, onClick, onDelete }) => {
  return (
    <div
      onClick={onClick}
      className={`cursor-pointer p-4 rounded-lg mb-3 transition-shadow relative ${
        selected ? "bg-[#053225]/60" : "bg-[#6E9277]/20"
      }`}
    >
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete question"
          className="absolute top-2 right-2 p-1 rounded hover:bg-black/10 text-[#053225]"
        >
          <Trash2 size={14} />
        </button>
      )}
      <div className="flex items-center gap-2 mb-1 pr-6">
        {number != null && (
          <span
            className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
              selected ? "bg-[#F1FFF5] text-[#053225]" : "bg-[#053225] text-[#F1FFF5]"
            }`}
          >
            Question #{number}
          </span>
        )}
        <div className="text-sm text-[#053225] font-semibold truncate">{question.competencyName || "Competency"}</div>
      </div>
      <div className="text-sm text-[#053225] mb-2 pr-6">{question.text || "Question text"}</div>
      {Array.isArray(question.options) && question.options.some((opt) => opt?.trim()) && (
        <ul className="text-xs text-[#053225]/80 mb-2 pr-6 space-y-0.5">
          {question.options.map((opt, i) =>
            opt?.trim() ? (
              <li key={i} className={question.answers.includes(i) ? "font-semibold" : ""}>
                {String.fromCharCode(65 + i)}. {opt}
              </li>
            ) : null
          )}
        </ul>
      )}
      <div className="text-xs text-[#053225] font-semibold">Correct answer: {question.answers.map((idx) => String.fromCharCode(65 + idx)).join(", ") || "None"}</div>
    </div>
  );
};

export default QuestionCard;
