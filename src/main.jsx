import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { registerServiceWorker } from "./lib/push.js";

// holder push-abonnementet i live for brugere, der allerede har slået notifikationer til
registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
); 
