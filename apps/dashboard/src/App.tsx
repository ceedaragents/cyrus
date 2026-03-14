import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { AccessControlPage } from "@/pages/AccessControlPage";
import { ConnectPage } from "@/pages/ConnectPage";
import { GlobalConfigPage } from "@/pages/GlobalConfigPage";
import { RepositoriesPage } from "@/pages/RepositoriesPage";
import { SessionsPage } from "@/pages/SessionsPage";
import { useConnectionStore } from "@/store/connectionStore";

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function AppRoutes() {
	const connected = useConnectionStore((s) => s.connected);

	if (!connected) return <ConnectPage />;

	return (
		<Routes>
			<Route element={<Shell />}>
				<Route index element={<Navigate to="/sessions" replace />} />
				<Route path="/sessions" element={<SessionsPage />} />
				<Route path="/config" element={<GlobalConfigPage />} />
				<Route path="/repositories" element={<RepositoriesPage />} />
				<Route path="/access-control" element={<AccessControlPage />} />
				<Route path="*" element={<Navigate to="/sessions" replace />} />
			</Route>
		</Routes>
	);
}

// Vite exposes the base path it was built with via import.meta.env.BASE_URL.
// This lets the app work correctly whether served from / or /dashboard/.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter basename={basename}>
				<AppRoutes />
			</BrowserRouter>
		</QueryClientProvider>
	);
}
