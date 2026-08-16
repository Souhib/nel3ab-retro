import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { client } from "./client/client.gen";
import { applyTheme, storedTheme } from "./lib/theme";
import { exposeNothingYet } from "./media/session";
import "./index.css";

/* The generated client talks to this page's own origin. In production one
 * hostname reaches both services; in development the Vite proxy makes that true
 * as well, which is what keeps the worker's same-origin check satisfied. */
client.setConfig({ baseUrl: "" });

/* Before React mounts, so a browser driver that looks early is told zero rather
 * than finding nothing at all. */
exposeNothingYet();

/* Le thème AVANT le premier rendu, sinon la page clignote dans l'autre couleur
 * le temps que React se monte. */
applyTheme(storedTheme());

const query = new QueryClient({
  defaultOptions: {
    queries: {
      // The room is pushed over the lobby, so a retry storm would only add
      // requests to a service that is already telling us when to look.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    // StrictMode double-invokes effects in development, which is exactly the
    // pressure the session needs to survive: it must open, close and reopen its
    // sockets without leaving a decoder or a timer behind.
    <StrictMode>
      <QueryClientProvider client={query}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}
