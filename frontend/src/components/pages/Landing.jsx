import { Link } from "react-router-dom";
import {
  LogIn as LogInIcon,
  UserPlus,
  ShieldCheck,
  GraduationCap,
  BookOpen,
  Sparkles,
  TrendingUp,
  Target,
  Bot,
  FileText,
  Lightbulb,
  Pencil,
} from "lucide-react";
import logo from "../../assets/logo-white.png";

// Decorative floating icons: [Icon, position classes, size, color/opacity, animation]
const FLOATERS = [
  [GraduationCap, "top-[10%] left-[8%]", 64, "text-[#f1fff5]/15", "animate-float-slow"],
  [BookOpen, "bottom-[14%] right-[9%]", 58, "text-[#f1fff5]/15", "animate-float-slower"],
  [Sparkles, "top-[16%] right-[14%]", 30, "text-[#d9c07a]/40", "animate-float"],
  [TrendingUp, "top-[44%] left-[4%]", 46, "text-[#f1fff5]/15", "animate-float"],
  [Target, "bottom-[30%] left-[12%]", 40, "text-[#d9c07a]/30", "animate-float-slower"],
  [Bot, "top-[34%] right-[5%]", 48, "text-[#f1fff5]/15", "animate-float-slow"],
  [FileText, "bottom-[8%] left-[28%]", 38, "text-[#f1fff5]/15", "animate-float"],
  [Lightbulb, "top-[6%] left-[40%]", 36, "text-[#d9c07a]/30", "animate-float-slower"],
  [Pencil, "bottom-[40%] right-[22%]", 36, "text-[#f1fff5]/10", "animate-float-slow"],
  [Sparkles, "bottom-[22%] right-[36%]", 22, "text-[#d9c07a]/35", "animate-float-slow"],
  [Sparkles, "top-[28%] left-[26%]", 20, "text-[#f1fff5]/25", "animate-float"],
];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c2318] flex items-center justify-center px-4 py-14">
      {/* Animated moving-color background (same as Log In / Sign Up) */}
      <div
        className="absolute inset-0 animate-gradient-move"
        style={{
          backgroundImage:
            "linear-gradient(120deg, #0c2318, #163d29, #2f6b47, #6e9277, #b7cdae, #2f6b47, #0c2318)",
          backgroundSize: "300% 300%",
        }}
      />

      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(241,255,245,0.18) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 85%)",
        }}
      />

      {/* Faint hairline overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 46px)",
        }}
      />

      {/* Decorative layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Soft glows */}
        <div className="absolute -top-16 -left-10 w-72 h-72 rounded-full bg-[#d9c07a]/20 blur-3xl animate-float-slow" />
        <div className="absolute top-1/3 -right-16 w-80 h-80 rounded-full bg-[#eafff0]/10 blur-3xl animate-float-slower" />
        <div className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full bg-[#6e9277]/30 blur-3xl animate-float" />
        <div className="absolute -bottom-24 -right-10 w-96 h-96 rounded-full bg-[#d9c07a]/10 blur-3xl animate-float-slow" />

        {/* Concentric rings */}
        <div className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full border border-[#f1fff5]/10 animate-spin-slow" />
        <div className="absolute -top-28 -right-28 w-[22rem] h-[22rem] rounded-full border border-dashed border-[#d9c07a]/20 animate-spin-slow-rev" />
        <div className="absolute -bottom-48 -left-48 w-[34rem] h-[34rem] rounded-full border border-[#f1fff5]/10 animate-spin-slow-rev" />
        <div className="absolute -bottom-32 -left-32 w-[26rem] h-[26rem] rounded-full border border-dashed border-[#f1fff5]/15 animate-spin-slow" />

        {/* Bridge arches silhouette */}
        <svg
          className="absolute bottom-0 left-0 w-full h-40 sm:h-52 text-[#f1fff5]"
          viewBox="0 0 1200 200"
          preserveAspectRatio="none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.14"
        >
          <path d="M0 150 H1200" />
          <path d="M0 175 H1200" opacity="0.6" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${i * 240 + 20} 150 Q${i * 240 + 120} 40 ${i * 240 + 220} 150`} />
          ))}
          {Array.from({ length: 21 }).map((_, i) => (
            <path key={`s${i}`} d={`M${i * 60} 150 V175`} opacity="0.5" />
          ))}
        </svg>

        {/* Floating icons */}
        {FLOATERS.map(([Icon, pos, size, color, anim], i) => (
          <Icon
            key={i}
            size={size}
            className={`absolute ${pos} ${color} ${anim} ${i > 5 ? "hidden sm:block" : ""}`}
          />
        ))}
      </div>

      {/* Content */}
      <main className="relative w-full max-w-xl animate-fade-up">
        {/* Cover card: logo, title and description only */}
        <div className="relative rounded-[32px] bg-[#d4e2cc]/95 border border-white/60 pt-14 px-8 sm:px-12 pb-10 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-sm animate-card-glow text-center">
          {/* Logo badge */}
          <div className="absolute left-1/2 -top-12 -translate-x-1/2">
            <div className="absolute inset-0 rounded-full bg-[#d9c07a]/40 blur-xl animate-pulse-slow" />
            <div className="relative w-24 h-24 rounded-full bg-white/95 border border-white shadow-lg flex items-center justify-center">
              <img src={logo} alt="BRIDGE logo" className="w-16 h-16 object-contain" />
            </div>
          </div>

          <h1 className="mt-6 text-5xl sm:text-6xl font-bold tracking-[0.18em] text-[#053225]">
            BRIDGE
          </h1>
          <div
            className="mx-auto mt-3 h-[3px] w-16 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277] animate-gradient-move-fast"
            style={{ backgroundSize: "200% 200%" }}
          />

          <p className="mt-6 text-base sm:text-lg leading-relaxed text-[#053225]/90">
            BRIDGE closes the gap between assessment results and classroom action.
            Upload your students' test scores and instantly see which competencies
            need attention, then get AI-assisted intervention recommendations you
            can review, save, and download as a report.
          </p>

          <div className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#053225]/70 bg-white/60 border border-[#053225]/10 rounded-full px-3 py-1">
            <ShieldCheck size={13} />
            Student data stays anonymized &amp; secure
          </div>
        </div>

        {/* Buttons: separate from the card, sitting on the background */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          <Link
            to="/login"
            className="group relative flex-1 overflow-hidden rounded-2xl bg-[#053225] px-6 py-4 text-base font-semibold text-white shadow-[0_14px_36px_-12px_rgba(5,50,37,0.8)] ring-1 ring-white/25 transition hover:-translate-y-0.5 hover:bg-[#0a4633] flex items-center justify-center gap-2"
          >
            <LogInIcon size={18} className="relative z-10" />
            <span className="relative z-10">Log In</span>
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </Link>
          <Link
            to="/signup"
            className="flex-1 rounded-2xl bg-[#f1fff5] px-6 py-4 text-base font-semibold text-[#053225] shadow-[0_14px_36px_-12px_rgba(5,50,37,0.6)] ring-1 ring-white/60 transition hover:-translate-y-0.5 hover:bg-white flex items-center justify-center gap-2"
          >
            <UserPlus size={18} />
            Sign Up
          </Link>
        </div>
      </main>

      <style>{`
        @keyframes gradientMove {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-move { animation: gradientMove 14s ease infinite; }
        .animate-gradient-move-fast { animation: gradientMove 3s ease infinite; }
        @keyframes floatY {
          0%, 100% { transform: translateY(0) translateX(0); }
          50% { transform: translateY(-18px) translateX(8px); }
        }
        .animate-float { animation: floatY 6s ease-in-out infinite; }
        .animate-float-slow { animation: floatY 9s ease-in-out infinite; }
        .animate-float-slower { animation: floatY 12s ease-in-out infinite; }
        @keyframes spinSlow { to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spinSlow 80s linear infinite; }
        .animate-spin-slow-rev { animation: spinSlow 110s linear infinite reverse; }
        @keyframes pulseSlow {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.08); }
        }
        .animate-pulse-slow { animation: pulseSlow 3.5s ease-in-out infinite; }
        @keyframes cardGlow {
          0%, 100% { box-shadow: 0 28px 80px -32px rgba(15,23,42,0.55), 0 0 0 1px rgba(217,192,122,0.0); }
          50% { box-shadow: 0 28px 90px -28px rgba(15,23,42,0.6), 0 0 40px -6px rgba(110,146,119,0.45); }
        }
        .animate-card-glow { animation: cardGlow 5s ease-in-out infinite; }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up { animation: fadeUp 0.7s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-gradient-move, .animate-gradient-move-fast, .animate-float,
          .animate-float-slow, .animate-float-slower, .animate-spin-slow,
          .animate-spin-slow-rev, .animate-pulse-slow, .animate-card-glow,
          .animate-fade-up { animation: none; }
        }
      `}</style>
    </div>
  );
}
