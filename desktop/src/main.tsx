import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import "./styles.css";
import { followAppearance } from "./theme.ts";

followAppearance();
createRoot(document.getElementById("root")!).render(<App />);
