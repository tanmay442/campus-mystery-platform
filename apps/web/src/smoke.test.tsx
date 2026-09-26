/** Smoke test: the Astryx app frame and landing page render without crashing. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Theme } from "@astryxdesign/core";
import AppFrame from "./components/AppFrame";
import Landing from "./routes/Landing";
import { neutralTheme } from "./themes/neutral/neutralTheme";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  UserButton: () => null
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
}

function renderWithProviders(path: string, element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } }
  });
  return render(
    <Theme theme={neutralTheme} mode="light">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </Theme>
  );
}

describe("app frame", () => {
  it("renders brand, nav, and an outlet child", () => {
    renderWithProviders("/", <AppFrame />);
    expect(screen.getByText("Campus Mystery")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("landing", () => {
  it("renders the hero and an empty featured-event state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ events: [] }) })
      )
    );
    renderWithProviders("/", <Landing />);
    expect(screen.getByRole("heading", { name: "Turn the campus into a game board" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No event right now")).toBeInTheDocument();
    });
  });
});
