import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import App from "./App";
import { SessionsProvider } from "./sessions";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SessionsProvider>
      <App />
    </SessionsProvider>
  </React.StrictMode>,
);
