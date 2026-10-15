import { useState, useEffect } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import logo from "../../assets/logo-white.png";
import { verifyLoginCode, resendLoginCode } from "../../services/api";

const RESEND_COOLDOWN_SECONDS = 60;

// Second step of logging in: the user already passed the password check on
// /login, and a one-time code was emailed to them. They only get a session
// once that code is accepted. The email + challenge token arrive in router
// state from App.jsx's login(); landing here without them (e.g. after a page
// refresh) sends the user back to /login.
export default function VerifyLogin({ onVerified = () => {} }) {
  const location = useLocation();
  const email = location.state?.email ?? "";
  const challengeToken = location.state?.challengeToken ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expired, setExpired] = useState(false);
  // A code was just emailed when the password was accepted, so resend starts on cooldown.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!email || !challengeToken) return <Navigate to="/login" replace />;

  const handleChange = (e) => {
    // The code is digits only — strip anything else (spaces, pasted dashes).
    setCode(e.target.value.replace(/\D/g, ""));
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    const { data, error: apiError, code: errorCode } = await resendLoginCode(challengeToken);
    if (apiError) {
      if (errorCode === "LOGIN_CHALLENGE_EXPIRED") setExpired(true);
      setError(apiError);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setInfo(data?.message ?? "A new login code has been sent to your email.");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (code.length !== 6) {
      return setError("Enter the 6-digit code from your email.");
    }

    setSubmitting(true);
    const { data, error: apiError, code: errorCode } = await verifyLoginCode({ challengeToken, code });
    setSubmitting(false);

    if (apiError || !data?.user) {
      if (errorCode === "LOGIN_CHALLENGE_EXPIRED") setExpired(true);
      setError(apiError || "Could not complete login. Please try again.");
      return;
    }
    onVerified(data.user);
  };

  const inputShell =
    "group flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md";
  const inputClass = "w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none";
  const iconClass = "text-slate-600 transition-colors duration-300 group-focus-within:text-[#053225]";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c2318] flex items-center justify-center px-4 py-10">
      <div
        className="absolute inset-0"
        style={{ backgroundImage: "linear-gradient(120deg, #0c2318, #163d29, #2f6b47, #163d29, #0c2318)" }}
      />

      <div className="relative w-full max-w-md">
        <div className="relative rounded-[28px] bg-[#d4e2cc]/95 border border-white/60 pt-14 px-8 pb-8 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-sm">
          {/* Logo badge */}
          <div className="absolute left-1/2 top-8 -translate-x-1/2">
            <div className="relative w-24 h-24 rounded-full bg-white/95 border border-white shadow-lg flex items-center justify-center">
              <img src={logo} alt="Bridge logo" className="w-16 h-16 object-contain" />
            </div>
          </div>

          {/* Heading section */}
          <div className="mt-24 text-center">
            <h1 className="text-3xl font-semibold" style={{ color: "#053225" }}>
              Check your email
            </h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277]" />
            <p className="mt-3 text-sm" style={{ color: "#053225" }}>
              We sent a 6-digit code to <span className="font-semibold break-all">{email}</span>.
              Enter it to finish logging in to BRIDGE.
            </p>
          </div>

          {expired ? (
            <div className="mt-8 space-y-4">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error || "Your login session has expired. Please log in again."}
              </div>
              <Link
                to="/login"
                replace
                className="block w-full rounded-2xl bg-[#6e9277] px-4 py-3 text-center text-base font-semibold text-white transition hover:bg-[#053225]"
              >
                Back to Log In
              </Link>
            </div>
          ) : (
            <>
              {/* Form section */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                {error && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {info && (
                  <div className="rounded-2xl border border-[#6e9277]/40 bg-white/70 px-4 py-3 text-sm text-[#053225]">
                    {info}
                  </div>
                )}

                {/* Code */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <label htmlFor="code" className="text-xs font-medium text-slate-700/80">Code</label>
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={cooldown > 0}
                      className="text-xs font-semibold text-[#053225]/70 hover:text-[#053225] hover:underline disabled:opacity-60 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                    </button>
                  </div>
                  <div className={inputShell}>
                    <ShieldCheck size={20} className={iconClass} />
                    <input
                      id="code"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      value={code}
                      onChange={handleChange}
                      placeholder="6-digit code"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-4 w-full rounded-2xl bg-[#6e9277] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#053225] disabled:opacity-70"
                >
                  {submitting ? "Verifying..." : "Verify & Log In"}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-700/80">
                <Link to="/login" replace className="font-semibold text-slate-900 hover:underline">
                  Back to Log In
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
