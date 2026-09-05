import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./router";
import "./styles.css";

declare global {
  interface Window {
    deferredInstallPrompt?: Event;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: true
    }
  }
});

window.addEventListener("beforeinstallprompt", (event: Event) => {
  event.preventDefault();
  window.deferredInstallPrompt = event;
});

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
}
