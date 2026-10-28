import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import { ToastProvider } from "./components/Toast";
import { AppProvider } from "./app/AppProvider";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <AppProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AppProvider>
    </ToastProvider>
  </StrictMode>,
);
