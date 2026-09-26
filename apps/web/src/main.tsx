/** App entry: Astryx theme + CSS, Clerk auth provider, query client, router. */
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Theme } from "@astryxdesign/core";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { router } from "./router";
import { neutralTheme } from "./themes/neutral/neutralTheme";

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

const rawPublishableKey: unknown = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const publishableKey =
  typeof rawPublishableKey === "string" && rawPublishableKey.length > 0 ? rawPublishableKey : undefined;

const rootElement = document.getElementById("root");

if (rootElement) {
  if (publishableKey === undefined) {
    createRoot(rootElement).render(
      <StrictMode>
        <p role="alert">Authentication is unavailable: the app is missing its publishable key.</p>
      </StrictMode>
    );
  } else {
    createRoot(rootElement).render(
      <StrictMode>
        <Theme theme={neutralTheme} mode="system">
          <ClerkProvider publishableKey={publishableKey}>
            <QueryClientProvider client={queryClient}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </ClerkProvider>
        </Theme>
      </StrictMode>
    );
  }
}
