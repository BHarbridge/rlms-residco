import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Force dark theme always
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
