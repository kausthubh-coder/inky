import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/shantell-sans/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installDevPreview } from "./app/devPreview";
import { StudiApp } from "./app/StudiApp";
import "./app/app.css";

installDevPreview();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Studi renderer root is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <StudiApp />
  </StrictMode>,
);
