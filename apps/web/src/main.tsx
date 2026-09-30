import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App, AppErrorBoundary } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Reviewer application root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
