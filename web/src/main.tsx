import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { HttpError } from "./http.ts";
import "./styles.css";

const client = new QueryClient({
  queryCache: new QueryCache({
    onError(error, query) {
      if (error instanceof HttpError && error.status === 401 && query.queryKey[0] !== "session")
        void client.invalidateQueries({ queryKey: ["session"] });
    },
  }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Console root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
