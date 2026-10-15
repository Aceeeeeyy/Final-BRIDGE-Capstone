import { useLocation, Link } from "react-router-dom";
import { LayoutDashboard, Bot, UploadCloud, Archive, LogOut } from "lucide-react";
import logo from "../../assets/logo-white.png";

// The Export tab was merged into Archives — Archives now handles both
// browsing AI Intervention history and downloading the PDF reports.
const navItems = [
  { label: "Dashboard", path: "/teacher/dashboard", icon: LayoutDashboard },
  { label: "AI Intervention", path: "/teacher/ai-intervention", icon: Bot },
  { label: "Upload", path: "/teacher/upload", icon: UploadCloud },
  { label: "Archives", path: "/teacher/archives", icon: Archive },
];

export default function TeacherSidebar({ onSignOut, user }) {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 z-20 flex h-screen w-[240px] flex-col justify-between bg-[#7b966f] px-4 py-6 text-slate-900 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.25)]">
      {/* Top section with logo and role label */}
      <div className="space-y-8 overflow-hidden">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-24 w-24 overflow-hidden rounded-full bg-white p-3 shadow-lg shadow-slate-950/10">
            <img src={logo} alt="Bridge logo" className="h-full w-full object-contain" />
          </div>
          <div className="space-y-1">
            {user?.name && (
              <p className="break-words text-sm font-semibold leading-snug text-white">{user.name}</p>
            )}
            {user?.schoolName && (
              <p className="break-words text-xs leading-snug text-slate-100">{user.schoolName}</p>
            )}
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-200">Teacher</p>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 rounded-[20px] px-4 py-3 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[#053225] text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.35)]"
                    : "bg-white text-slate-950 shadow-sm hover:bg-slate-100"
                }`}
              >
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-transparent text-inherit transition">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Sign out button */}
      <button
        onClick={onSignOut}
        className="mt-4 flex items-center justify-center gap-3 rounded-[20px] bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
      >
        <LogOut className="h-4.5 w-4.5" />
        Sign out
      </button>
    </aside>
  );
}