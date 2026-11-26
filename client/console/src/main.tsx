import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme/tokens.css";
import "./theme/base.css";
import { applyAppearance, readAppearance } from "./theme/appearance";

applyAppearance(readAppearance());

// A part loaded on demand (the script editor) that the newest deploy no longer has: load the page again (index.html).
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  (window as unknown as { __hgbReload?: () => void }).__hgbReload?.();
});

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
