import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App.jsx";
import ErrorBoundary from "./ui/ErrorBoundary.jsx";
import { registerServiceWorker } from "./lib/push.js";

// holder push-abonnementet i live for brugere, der allerede har slået notifikationer til
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* G20: uden denne blanker ét render-kast hvor som helst i træet hele appen. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <Analytics />
  </React.StrictMode>
);
