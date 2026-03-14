import { Activity, LogOut, Server, Settings, ShieldCheck } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/connectionStore";

const navItems = [
	{ to: "/sessions", label: "Sessions", icon: Activity },
	{ to: "/config", label: "Global Config", icon: Settings },
	{ to: "/repositories", label: "Repositories", icon: Server },
	{ to: "/access-control", label: "Access Control", icon: ShieldCheck },
];

export function Shell() {
	const disconnect = useConnectionStore((s) => s.disconnect);
	const cyrusUrl = useConnectionStore((s) => s.cyrusUrl);

	return (
		<div className="flex h-screen bg-background">
			{/* Sidebar */}
			<aside className="w-56 flex flex-col border-r bg-muted/30">
				<div className="px-4 py-5 border-b">
					<p className="text-xs text-muted-foreground truncate">{cyrusUrl}</p>
				</div>
				<nav className="flex-1 py-4 px-2 space-y-1">
					{navItems.map(({ to, label, icon: Icon }) => (
						<NavLink
							key={to}
							to={to}
							className={({ isActive }) =>
								cn(
									"flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
									isActive
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
								)
							}
						>
							<Icon size={15} />
							{label}
						</NavLink>
					))}
				</nav>
				<div className="p-2 border-t">
					<button
						onClick={disconnect}
						className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
					>
						<LogOut size={15} />
						Disconnect
					</button>
				</div>
			</aside>

			{/* Main */}
			<main className="flex-1 overflow-auto">
				<Outlet />
			</main>
		</div>
	);
}
