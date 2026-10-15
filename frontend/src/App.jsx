import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";

// PAGE IMPORTS
import Landing from "./components/pages/Landing";
import LogIn from "./components/pages/LogIn";
import SignUp from "./components/pages/SignUp";
import ForgotPassword from "./components/pages/ForgotPassword";
import ResetPassword from "./components/pages/ResetPassword";
import VerifyEmail from "./components/pages/VerifyEmail";
import VerifyLogin from "./components/pages/VerifyLogin";
import Dashboard from "./components/pages/Dashboard";
import AIIntervention from "./components/pages/AIIntervention";
import Upload from "./components/pages/Upload";
import Archives from "./components/pages/Archives";
import AdminArchive from "./components/pages/AdminArchive";
import AdminOverview from "./components/pages/AdminOverview";
import ManageCompetencies from "./components/pages/ManageCompetencies";

// SIDEBAR IMPORTS
import TeacherSidebar from "./components/modals/TeacherSidebar";
import AdminSidebar from "./components/modals/AdminSidebar";

// API
import { logIn, logOut, getCurrentUser } from "./services/api";

// ─── App ───────────────────────────────────────────────────────────────────────
function AppRoutes() {
  // authUser is hydrated from whatever logIn() already stored in localStorage
  // ("bridge-user"), so a refresh keeps the session alive without re-calling the API.
  const [authUser, setAuthUser] = useState(() => {
    const stored = getCurrentUser();
    if (!stored) return null;
    return {
      name:       `${stored.firstName} ${stored.lastName}`,
      email:      stored.email,
      role:       stored.role === "Administrator" ? "admin" : "teacher",
      schoolName: stored.schoolName,
    };
  });

  const navigate   = useNavigate();
  const location   = useLocation();

  // Keep URL in sync with role after refresh
  useEffect(() => {
    if (!authUser) return;
    const home = authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard";
    if (!location.pathname.startsWith(`/${authUser.role}`)) {
      navigate(home, { replace: true });
    }
  }, [authUser, location.pathname, navigate]);

  // ── Auth actions ─────────────────────────────────────────────────────────────
  // Login is two steps: password (here), then the code emailed to the account
  // (VerifyLogin.jsx). logIn() only checks the password and triggers the email;
  // the session is created by finishLogin() once the code has been verified.
  //
  // login is async — LogIn.jsx awaits the return value before showing an error.
  // Returns `true` when the password was accepted (the user is sent on to enter
  // their code), or the backend's error message string on failure
  // (e.g. "Invalid email or password." vs an account-lockout message) so the
  // login page can show the specific reason instead of a generic one.
  const login = async ({ email, password }) => {
    const { data, error, code } = await logIn({ email, password });
    // An unverified account needs more than a message so LogIn.jsx can link to /verify-email.
    if (code === 'EMAIL_NOT_VERIFIED') return { code, error };
    if (error || !data) return error || 'Invalid email or password.';

    // Password OK → a code was emailed. The challenge token lives only in router
    // state (not the URL or storage), so a refresh sends the user back to log in.
    if (data.requiresTwoFactor) {
      navigate("/verify-login", {
        replace: true,
        state: { email: data.email, challengeToken: data.challengeToken },
      });
      return true;
    }

    // Defensive: a response that already carries a session (tokens stored by logIn()).
    if (data.user) {
      finishLogin(data.user);
      return true;
    }
    return 'Invalid email or password.';
  };

  // Called with the user object returned by a completed login (after the code step).
  const finishLogin = (user) => {
    const auth = {
      name:       `${user.firstName} ${user.lastName}`,
      email:      user.email,
      role:       user.role === "Administrator" ? "admin" : "teacher",
      schoolName: user.schoolName,
    };
    setAuthUser(auth);
    navigate(auth.role === "admin" ? "/admin/overview" : "/teacher/dashboard", { replace: true });
  };

  const signOut = () => {
    logOut();
    setAuthUser(null);
    navigate("/login", { replace: true });
  };

  // ── Guard ────────────────────────────────────────────────────────────────────
  const RequireAuth = ({ allowedRoles, children }) => {
    if (!authUser)                              return <Navigate to="/login" replace />;
    if (!allowedRoles.includes(authUser.role)) return <Navigate to="/login" replace />;
    return children;
  };

  // ── Layouts ──────────────────────────────────────────────────────────────────
  function TeacherLayout() {
    return (
      <div className="min-h-screen bg-[#f1fff5]">
        <TeacherSidebar onSignOut={signOut} user={authUser} />
        <main className="p-6" style={{ marginLeft: "calc(240px + 37px)", width: "calc(100% - (240px + 37px))" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  function AdminLayout() {
    return (
      <div className="min-h-screen bg-[#f1fff5]">
        <AdminSidebar onSignOut={signOut} user={authUser} />
        <main className="p-6" style={{ marginLeft: "calc(240px + 37px)", width: "calc(100% - (240px + 37px))" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  // ── Routes ───────────────────────────────────────────────────────────────────
  return (
    <Routes>
      {/* FRONT COVER — first page shown when the system runs */}
      <Route
        path="/"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <Landing />
        }
      />

      <Route path="/signup" element={<SignUp />} />

      <Route
        path="/login"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <LogIn onLogin={login} />
        }
      />

      <Route
        path="/verify-login"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <VerifyLogin onVerified={finishLogin} />
        }
      />

      <Route
        path="/forgot-password"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <ForgotPassword />
        }
      />

      <Route
        path="/reset-password"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <ResetPassword />
        }
      />

      <Route
        path="/verify-email"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <VerifyEmail />
        }
      />

      {/* TEACHER ROUTES */}
      <Route
        path="/teacher"
        element={
          <RequireAuth allowedRoles={["teacher"]}>
            <TeacherLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"       element={<Dashboard />} />
        <Route path="ai-intervention" element={<AIIntervention />} />
        <Route path="upload"          element={<Upload />} />
        <Route path="archives"        element={<Archives />} />
        {/* The old Export tab was folded into Archives, which now also
            handles PDF downloads — redirect any stale links/bookmarks. */}
        <Route path="export"          element={<Navigate to="../archives" replace />} />
      </Route>

      {/* ADMIN ROUTES */}
      <Route
        path="/admin"
        element={
          <RequireAuth allowedRoles={["admin"]}>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview"     element={<AdminOverview />} />
        <Route path="competencies" element={<ManageCompetencies />} />
        <Route path="archives"     element={<AdminArchive />} />
      </Route>

      {/* Fallback */}
      <Route
        path="*"
        element={
          authUser
            ? <Navigate to={authUser.role === "admin" ? "/admin/overview" : "/teacher/dashboard"} replace />
            : <Navigate to="/" replace />
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}