import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Lock, GraduationCap, BookOpen, Sparkles, Eye, EyeOff, ShieldCheck } from "lucide-react";
import logo from "../../assets/logo-white.png";
import { resendVerification } from "../../services/api";

export default function LogIn({ onLogin = () => {} }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setUnverifiedEmail("");
    setSubmitting(true);

    // onLogin resolves to `true` on success, or an error message string on
    // failure (e.g. an account-lockout message distinct from a plain
    // wrong-password error) — show whatever it gives us.
    const result = await onLogin(formData);
    setSubmitting(false);
    if (result !== true) {
      // Correct password but the email was never verified: send a fresh code
      // (the backend answers generically) and point the user at /verify-email.
      if (result?.code === "EMAIL_NOT_VERIFIED") {
        const email = formData.email.trim().toLowerCase();
        setUnverifiedEmail(email);
        resendVerification(email);
        return;
      }
      setError(result || "Invalid email or password.");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c2318] flex items-center justify-center px-4 py-10">
      {/* Animated moving-color background */}
      <div
        className="absolute inset-0 animate-gradient-move"
        style={{
          backgroundImage:
            "linear-gradient(120deg, #0c2318, #163d29, #2f6b47, #6e9277, #b7cdae, #2f6b47, #0c2318)",
          backgroundSize: "300% 300%",
        }}
      />

      {/* Soft floating academic accents (decorative, non-interactive) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-16 -left-10 w-72 h-72 rounded-full bg-[#d9c07a]/20 blur-3xl animate-float-slow" />
        <div className="absolute top-1/3 -right-16 w-80 h-80 rounded-full bg-[#eafff0]/10 blur-3xl animate-float-slower" />
        <div className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full bg-[#6e9277]/30 blur-3xl animate-float" />

        <GraduationCap
          className="absolute top-[12%] left-[10%] text-[#f1fff5]/10 animate-float-slow"
          size={64}
        />
        <BookOpen
          className="absolute bottom-[15%] right-[12%] text-[#f1fff5]/10 animate-float-slower"
          size={56}
        />
        <Sparkles
          className="absolute top-[20%] right-[18%] text-[#d9c07a]/25 animate-float"
          size={28}
        />
      </div>

      {/* Faint hairline overlay for a subtle campus-paper feel */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 46px)",
        }}
      />

      {/* Page wrapper*/}
      <div className="relative w-full max-w-md">
        {/* Card container*/}
        <div className="relative rounded-[28px] bg-[#d4e2cc]/95 border border-white/60 pt-14 px-8 pb-8 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-sm animate-card-glow">
          {/* Logo badge*/}
          <div className="absolute left-1/2 top-8 -translate-x-1/2">
            <div className="absolute inset-0 rounded-full bg-[#d9c07a]/40 blur-xl animate-pulse-slow" />
            <div className="relative w-24 h-24 rounded-full bg-white/95 border border-white shadow-lg flex items-center justify-center">
              <img src={logo} alt="Bridge logo" className="w-16 h-16 object-contain" />
            </div>
          </div>

          {/* Heading section */}
          <div className="mt-24 text-center">
            <h1 className="text-3xl font-semibold" style={{ color: "#053225" }}>
              Welcome!
            </h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277] animate-gradient-move-fast" style={{ backgroundSize: "200% 200%" }} />
            <p className="mt-3 text-sm" style={{ color: "#053225" }}>
              Use your account details to log in.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#053225]/70 bg-white/60 border border-[#053225]/10 rounded-full px-3 py-1">
              <ShieldCheck size={13} />
              Student data stays anonymized &amp; secure
            </div>
          </div>

          {/* Form section: email and password fields */}
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {unverifiedEmail && (
              <div className="rounded-2xl border border-[#d9c07a]/60 bg-[#fff8e1] px-4 py-3 text-sm text-[#053225]">
                Your email address isn't verified yet. We've sent a fresh code to {unverifiedEmail}.{" "}
                <Link
                  to="/verify-email"
                  state={{ email: unverifiedEmail, codeSent: true }}
                  className="font-semibold underline hover:text-[#6e9277]"
                >
                  Enter your code
                </Link>
              </div>
            )}
            {/* Email */}
            <div className="space-y-2">
              <label htmlFor="email" className="px-1 text-xs font-medium text-slate-700/80">Email</label>
              <div className="group flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
                <Mail size={20} className="text-slate-600 transition-colors duration-300 group-focus-within:text-[#053225]" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="name@gmail.com"
                  className="w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label htmlFor="password" className="text-xs font-medium text-slate-700/80">Password</label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-semibold text-[#053225]/70 hover:text-[#053225] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="group flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
                <Lock size={20} className="text-slate-600 transition-colors duration-300 group-focus-within:text-[#053225]" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="qwerty101"
                  className="w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-slate-400 hover:text-[#053225] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting}
              className="group relative mt-4 w-full overflow-hidden rounded-2xl bg-[#6e9277] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#053225] disabled:opacity-70"
            >
              <span className="relative z-10">{submitting ? "Logging in..." : "Log In"}</span>
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
          </form>

          {/* Bottom link: navigate to signup page */}
          <p className="mt-8 text-center text-sm text-slate-700/80">
            New here?{' '}
            <Link to="/signup" className="font-semibold text-slate-900 hover:underline ">
              Sign Up
            </Link>
          </p>
        </div>
      </div>

      {/* Scoped animation keyframes */}
      <style>{`
        @keyframes gradientMove {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-move {
          animation: gradientMove 14s ease infinite;
        }
        .animate-gradient-move-fast {
          animation: gradientMove 3s ease infinite;
        }
        @keyframes floatY {
          0%, 100% { transform: translateY(0) translateX(0); }
          50% { transform: translateY(-18px) translateX(8px); }
        }
        .animate-float {
          animation: floatY 6s ease-in-out infinite;
        }
        .animate-float-slow {
          animation: floatY 9s ease-in-out infinite;
        }
        .animate-float-slower {
          animation: floatY 12s ease-in-out infinite;
        }
        @keyframes pulseSlow {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.08); }
        }
        .animate-pulse-slow {
          animation: pulseSlow 3.5s ease-in-out infinite;
        }
        @keyframes cardGlow {
          0%, 100% { box-shadow: 0 28px 80px -32px rgba(15,23,42,0.55), 0 0 0 1px rgba(217,192,122,0.0); }
          50% { box-shadow: 0 28px 90px -28px rgba(15,23,42,0.6), 0 0 40px -6px rgba(110,146,119,0.45); }
        }
        .animate-card-glow {
          animation: cardGlow 5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
