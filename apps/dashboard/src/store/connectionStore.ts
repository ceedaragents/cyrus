import { create } from "zustand";

interface ConnectionStore {
	cyrusUrl: string;
	apiKey: string;
	connected: boolean;
	setConnection: (cyrusUrl: string, apiKey: string) => void;
	disconnect: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
	cyrusUrl: localStorage.getItem("cyrus_url") ?? "http://localhost:3456",
	apiKey: localStorage.getItem("cyrus_api_key") ?? "",
	connected: !!localStorage.getItem("cyrus_api_key"),
	setConnection: (cyrusUrl, apiKey) => {
		localStorage.setItem("cyrus_url", cyrusUrl);
		localStorage.setItem("cyrus_api_key", apiKey);
		set({ cyrusUrl, apiKey, connected: true });
	},
	disconnect: () => {
		localStorage.removeItem("cyrus_url");
		localStorage.removeItem("cyrus_api_key");
		set({ cyrusUrl: "http://localhost:3456", apiKey: "", connected: false });
	},
}));
