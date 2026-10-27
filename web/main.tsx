import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

// apply the saved theme before the first paint, so there is no flash of the wrong colours
try {
  const choice = localStorage.getItem("fairshift.theme") ?? "system";
  const dark = choice === "dark" || (choice === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
} catch {
  /* storage blocked: the theme toggle still works for this visit */
}

createRoot(document.getElementById("root")!).render(<App />);
