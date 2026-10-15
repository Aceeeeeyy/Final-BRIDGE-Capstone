import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, Lock, ShieldCheck, Eye, EyeOff } from "lucide-react";
import logo from "../../assets/logo-white.png";
import { forgotPassword, resetPassword } from "../../services/api";

const RESEND_COOLDOWN_SECONDS = 60;

export default function ResetPassword() {
  const location = useLocation();

  const [formData, setFormData] = useState({
    email: location.state?.email ?? "",
    code: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // A code was just sent if we arrived from the Forgot Password page, so the
  // resend button starts out on cooldown.
  const [cooldown, setCooldown] = useState(location.state?.codeSent ? RESEND_COOLDOWN_SECONDS : 0);
  // Once a code has been sent to an address, the email is locked so the code
  // can't end up being submitted against a different (mistyped) address.
  const [emailLocked, setEmailLocked] = useState(Boolean(location.state?.codeSent));

  // Tick the resend cooldown down once per second.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "email" && emailLocked) return;
    // The code is digits only — strip anything else (spaces, pasted dashes).
    setFormData((prev) => ({
      ...prev,
      [name]: name === "code" ? value.replace(/\D/g, "") : value,
    }));
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    const cleanEmail = formData.email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Enter your email first so we know where to send the code.");
      return;
    }

    const { data, error: apiError } = await forgotPassword(cleanEmail);
    if (apiError) {
      setError(apiError);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setEmailLocked(true);
    setInfo(data?.message ?? "A code has been sent to your email.");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const cleanEmail = formData.email.trim().toLowerCase();
    if (!cleanEmail) return setError("Please enter your email address.");
    if (formData.code.length < 6 || formData.code.length > 10) {
      return setError("Enter the 6 to 10 digit code from your email.");
    }
    if (formData.newPassword.length < 8) {
      return setError("Password must be at least 8 characters.");
    }
    if (formData.newPassword !== formData.confirmPassword) {
      return setError("Passwords do not match.");
    }

    setSubmitting(true);
    const { error: apiError } = await resetPassword({
      email: cleanEmail,
      code: formData.code,
      newPassword: formData.newPassword,
    });
    setSubmitting(false);

    if (apiError) {
      setError(apiError);
      return;
    }
    setDone(true);
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

          {done ? (
            /* Success message */
            <div className="mt-24 text-center">
              <h1 className="text-3xl font-semibold" style={{ color: "#053225" }}>
                Password updated
              </h1>
              <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277]" />
              <p className="mt-4 text-sm" style={{ color: "#053225" }}>
                Your password has been reset and your other sessions were signed out. You can now log in with your new password.
              </p>
              <Link
                to="/login"
                className="mt-8 block w-full rounded-2xl bg-[#6e9277] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#053225]"
              >
                Back to Log In
              </Link>
            </div>
          ) : (
            <>
              {/* Heading section */}
              <div className="mt-24 text-center">
                <h1 className="text-3xl font-semibold" style={{ color: "#053225" }}>
                  Reset password
                </h1>
                <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277]" />
                <p className="mt-3 text-sm" style={{ color: "#053225" }}>
                  Enter the code we emailed you and choose a new password.
                </p>
              </div>

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

                {/* Email */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <label htmlFor="email" className="text-xs font-medium text-slate-700/80">Email</label>
                    {emailLocked && (
                      <Link
                        to="/forgot-password"
                        className="text-xs font-semibold text-[#053225]/70 hover:text-[#053225] hover:underline"
                      >
                        Use a different email
                      </Link>
                    )}
                  </div>
                  <div className={emailLocked ? `${inputShell} bg-white/60` : inputShell}>
                    <Mail size={20} className={iconClass} />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="name@gmail.com"
                      autoComplete="email"
                      readOnly={emailLocked}
                      aria-readonly={emailLocked}
                      className={emailLocked ? `${inputClass} cursor-not-allowed text-slate-600` : inputClass}
                    />
                  </div>
                </div>

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
                      maxLength={10}
                      value={formData.code}
                      onChange={handleChange}
                      placeholder="Code from your email"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* New password */}
                <div className="space-y-2">
                  <label htmlFor="newPassword" className="px-1 text-xs font-medium text-slate-700/80">New password</label>
                  <div className={inputShell}>
                    <Lock size={20} className={iconClass} />
                    <input
                      id="newPassword"
                      name="newPassword"
                      type={showPassword ? "text" : "password"}
                      value={formData.newPassword}
                      onChange={handleChange}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className={inputClass}
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

                {/* Confirm password */}
                <div className="space-y-2">
                  <label htmlFor="confirmPassword" className="px-1 text-xs font-medium text-slate-700/80">Confirm new password</label>
                  <div className={inputShell}>
                    <Lock size={20} className={iconClass} />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="Re-enter new password"
                      autoComplete="new-password"
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
                  {submitting ? "Resetting..." : "Reset Password"}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-slate-700/80">
                <Link to="/login" className="font-semibold text-slate-900 hover:underline">
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
