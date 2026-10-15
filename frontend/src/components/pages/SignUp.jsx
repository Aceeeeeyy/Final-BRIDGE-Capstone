import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, CircleUserRound, School, GraduationCap, BookOpen, Sparkles, Eye, EyeOff } from "lucide-react";

// Fixed list of schools so the same school is always stored with the same spelling.
const SCHOOL_OPTIONS = [
  "Talon Elementary School",
  "Talon 3 Elementary School",
  "Pamplona Elementary School Central",
];
import logo from "../../assets/logo-white.png";
import { signUp } from "../../services/api";

function passwordStrength(pw) {
  if (!pw) return { label: "", width: "0%", color: "transparent" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: "Weak", width: "33%", color: "#cc2936" };
  if (score <= 3) return { label: "Okay", width: "66%", color: "#ffb800" };
  return { label: "Strong", width: "100%", color: "#053225" };
}

export default function SignUp() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    password: "",
    role: "Teacher",
    schoolName: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const strength = passwordStrength(formData.password);

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
    setSuccess("");

    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password || !formData.schoolName) {
      setError("Please fill in all required fields.");
      return;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    const { data, error: apiError } = await signUp(formData);
    setSubmitting(false);

    if (apiError) {
      setError(apiError);
      return;
    }

    // No login yet: the account must be verified with the code we just emailed.
    navigate("/verify-email", {
      state: { email: data?.email ?? formData.email.trim().toLowerCase(), codeSent: true },
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c2318] flex items-center justify-center p-4">
      {/* Animated moving-color background */}
      <div
        className="absolute inset-0 animate-gradient-move"
        style={{
          backgroundImage:
            "linear-gradient(120deg, #053225, #144533, #28584a, #6e9277, #b7cdae, #28584a, #053225)",
          backgroundSize: "300% 300%",
        }}
      />

      {/* Soft floating academic accents (decorative, non-interactive) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-16 -right-10 w-72 h-72 rounded-full bg-[#d9c07a]/20 blur-3xl animate-float-slow" />
        <div className="absolute top-1/3 -left-16 w-80 h-80 rounded-full bg-[#eafff0]/10 blur-3xl animate-float-slower" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full bg-[#6e9277]/30 blur-3xl animate-float" />

        <GraduationCap
          className="absolute top-[10%] right-[10%] text-[#f1fff5]/10 animate-float-slow"
          size={64}
        />
        <BookOpen
          className="absolute bottom-[14%] left-[10%] text-[#f1fff5]/10 animate-float-slower"
          size={56}
        />
        <Sparkles
          className="absolute top-[22%] left-[16%] text-[#d9c07a]/25 animate-float"
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

      <div className="relative w-full max-w-md">
        {/* Card Container */}
        <div className="bg-[#F1FFF5]/70 rounded-3xl p-8 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-sm animate-card-glow">
          {/* Logo/Badge */}
          <div className="flex justify-center mb-6">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[#d9c07a]/40 blur-xl animate-pulse-slow" />
              <div className="relative w-20 h-20 bg-white rounded-full flex items-center justify-center border-4 border-white shadow-md">
                <img src={logo} alt="BRIDGE Logo" className="w-16 h-16 object-contain" />
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-center mb-1" style={{ color: "#053225" }}>
            Get Started
          </h1>
          <div className="mx-auto mb-6 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#6e9277] via-[#d9c07a] to-[#6e9277] animate-gradient-move-fast" style={{ backgroundSize: "200% 200%" }} />

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {success}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* First / Middle / Last name */}
            <div className="grid grid-cols-2 gap-3">
              <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
                <CircleUserRound size={20} className="text-[#053225] ml-3 flex-shrink-0 transition-colors duration-300 group-focus-within:text-[#0a4a34]" />
                <input
                  type="text"
                  name="firstName"
                  placeholder="First name"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="flex-1 px-3 py-3 bg-white text-[#053225] placeholder-gray-400 focus:outline-none min-w-0"
                />
              </div>
              <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
                <input
                  type="text"
                  name="lastName"
                  placeholder="Last name"
                  value={formData.lastName}
                  onChange={handleChange}
                  className="flex-1 px-4 py-3 bg-white text-[#053225] placeholder-gray-400 focus:outline-none min-w-0"
                />
              </div>
            </div>

            <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
              <input
                type="text"
                name="middleName"
                placeholder="Middle name (optional)"
                value={formData.middleName}
                onChange={handleChange}
                className="flex-1 px-4 py-3 bg-white text-[#053225] placeholder-gray-400 focus:outline-none"
              />
            </div>

            {/* Email Input */}
            <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
              <Mail size={20} className="text-[#053225] ml-3 flex-shrink-0 transition-colors duration-300 group-focus-within:text-[#0a4a34]" />
              <input
                type="email"
                name="email"
                placeholder="name@gmail.com"
                value={formData.email}
                onChange={handleChange}
                className="flex-1 px-4 py-3 bg-white text-[#053225] placeholder-gray-400 focus:outline-none"
              />
            </div>

            {/* Password Input */}
            <div>
              <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
                <Lock size={20} className="text-[#053225] ml-3 flex-shrink-0 transition-colors duration-300 group-focus-within:text-[#0a4a34]" />
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="qwerty101"
                  value={formData.password}
                  onChange={handleChange}
                  className="flex-1 px-4 py-3 bg-white text-[#053225] placeholder-gray-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-gray-400 hover:text-[#053225] transition-colors mr-3 flex-shrink-0"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {formData.password && (
                <div className="mt-1.5 px-1">
                  <div className="h-1 w-full rounded-full bg-[#053225]/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: strength.width, backgroundColor: strength.color }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-[#053225]/60">
                    Password strength: <span className="font-semibold">{strength.label}</span> · at least 8 characters
                  </p>
                </div>
              )}
            </div>

            {/* School name */}
            <div className="group flex items-center bg-white rounded-lg shadow-sm overflow-hidden ring-1 ring-transparent transition-all duration-300 focus-within:ring-2 focus-within:ring-[#6e9277] focus-within:shadow-md">
              <School size={20} className="text-[#053225] ml-3 flex-shrink-0 transition-colors duration-300 group-focus-within:text-[#0a4a34]" />
              <select
                name="schoolName"
                value={formData.schoolName}
                onChange={handleChange}
                className={`flex-1 px-4 py-3 bg-white focus:outline-none ${
                  formData.schoolName ? "text-[#053225]" : "text-gray-400"
                }`}
              >
                <option value="" disabled>
                  Select school name
                </option>
                {SCHOOL_OPTIONS.map((school) => (
                  <option key={school} value={school} className="text-[#053225]">
                    {school}
                  </option>
                ))}
              </select>
            </div>

            {/* Role */}
            <div className="flex gap-4 px-1 text-sm text-[#053225]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="role"
                  value="Teacher"
                  checked={formData.role === "Teacher"}
                  onChange={handleChange}
                  className="accent-[#053225]"
                />
                Teacher
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="role"
                  value="Administrator"
                  checked={formData.role === "Administrator"}
                  onChange={handleChange}
                  className="accent-[#053225]"
                />
                Administrator
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="group relative w-full overflow-hidden bg-[#053225] hover:bg-[#6e9277] text-white font-semibold py-3 px-4 rounded-lg transition duration-200 ease-in-out disabled:opacity-60"
            >
              <span className="relative z-10">{submitting ? "Creating account..." : "Sign Up"}</span>
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#053225]/80">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-[#053225] hover:underline">
              Log In
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
