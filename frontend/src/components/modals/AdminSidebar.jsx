import { Link, useLocation } from "react-router-dom";
import { Archive, LayoutDashboard, ListChecks, LogOut } from "lucide-react";
import logo from "../../assets/logo-white.png";

const NAV_ITEMS = [
	{ to: "/admin/overview",     label: "School Overview",       icon: LayoutDashboard },
	{ to: "/admin/competencies", label: "Manage Competencies",   icon: ListChecks },
	{ to: "/admin/archives",     label: "Archives",              icon: Archive },
];

export default function AdminSidebar({ onSignOut, user }) {
	const location = useLocation();

	return (
		<aside className="fixed left-0 top-0 z-20 flex h-screen w-[240px] flex-col justify-between bg-[#7b966f] px-4 py-6 text-slate-900 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.25)]">
			<div className="space-y-8">
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
						<p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-200">Admin</p>
					</div>
				</div>

				<nav className="space-y-2">
					{NAV_ITEMS.map(({ to, label, icon: Icon }) => (
						<Link
							key={to}
							to={to}
							className={`flex items-center gap-3 rounded-[20px] px-4 py-3 text-sm font-semibold transition ${
								location.pathname === to
									? "bg-[#053225] text-white shadow-[0_14px_30px_-20px_rgba(15,23,42,0.35)]"
									: "bg-white text-slate-950 shadow-sm hover:bg-slate-100"
							}`}
						>
							<span className="grid h-10 w-10 place-items-center rounded-2xl bg-transparent text-inherit">
								<Icon className="h-4.5 w-4.5" />
							</span>
							<span>{label}</span>
						</Link>
					))}
				</nav>
			</div>

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
