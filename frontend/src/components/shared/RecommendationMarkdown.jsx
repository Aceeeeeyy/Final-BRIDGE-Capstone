import React from "react";
import ReactMarkdown from "react-markdown";

/**
 * Renders AI-generated markdown (headers, bold, numbered/bulleted lists)
 * with styling that matches the app's green/slate palette, instead of
 * dumping raw markdown text into a <pre> block.
 *
 * Shared between the AI Intervention page (freshly generated result) and
 * the Archives page (full history of past recommendations).
 */
const RecommendationMarkdown = ({ children }) => (
  <div className="max-w-none">
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <h3 className="text-base font-bold text-[#053225] mt-5 mb-2 first:mt-0">{children}</h3>
        ),
        h2: ({ children }) => (
          <h3 className="text-base font-bold text-[#053225] uppercase tracking-wide border-b border-[#053225]/15 pb-1.5 mt-6 mb-3 first:mt-0">
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="text-sm font-bold text-[#053225] mt-5 mb-2 pl-3 border-l-4 border-[#053225] bg-[#053225]/5 rounded-r-md py-1.5">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="text-sm text-slate-700 leading-relaxed mb-3">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-[#053225]">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-6 space-y-2 mb-4 text-sm text-slate-700 marker:text-[#053225]/50">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-6 space-y-2.5 mb-4 text-sm text-slate-700 marker:font-semibold marker:text-[#053225]">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
        hr: () => <hr className="border-[#053225]/15 my-4" />,
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);

export default RecommendationMarkdown;
