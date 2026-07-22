import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Import reactflow styles so esbuild bundles them
import "reactflow/dist/style.css";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  console.error("Root element not found");
}
