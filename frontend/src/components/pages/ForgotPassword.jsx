import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import logo from "../../assets/logo-white.png";
import { forgotPassword } from "../../services/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    setSubmitting(true);
    const { error: apiError } = await forgotPassword(cleanEmail);
    setSubmitting(false);

    if (apiError) {
      setError(apiError);
      return;
    }

    // Only reached when the backend confirmed the email is registered and sent
    // the code (unknown emails come back as an error above). codeSent lets the
    // next page lock the email and start its resend cooldown.
    navigate("/reset-password", { state: { email: cleanEmail, codeSent: true } });
  };

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
              Forgot password?
            </h1>
            <div className="mx-auto mt-2 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277]" />
            <p className="mt-3 text-sm" style={{ color: "#053225" }}>
              Enter your account email and we&apos;ll send you a code to reset your password.
            </p>
          </div>

          {/* Form section */}
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  autoComplete="email"
                  className="w-full bg-transparent text-slate-900 placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 w-full rounded-2xl bg-[#6e9277] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#053225] disabled:opacity-70"
            >
              {submitting ? "Sending code..." : "Send Code"}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-700/80">
            Remembered it?{" "}
            <Link to="/login" className="font-semibold text-slate-900 hover:underline">
              Back to Log In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
