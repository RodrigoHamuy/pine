import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { followAppearance } from "./theme.ts";
import { Toaster } from "@/components/ui/toast";

followAppearance();
// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed.
createRoot(document.getElementById("root")!).render(
	<>
		<App />
		<Toaster />
	</>,
);
