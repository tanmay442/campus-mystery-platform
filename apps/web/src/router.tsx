import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { createBrowserRouter } from "react-router";
import { Spinner } from "@astryxdesign/core/Spinner";
import AppFrame from "./components/AppFrame";
import RequireAdmin from "./components/RequireAdmin";
import EventCentre from "./routes/EventCentre";
import Landing from "./routes/Landing";
import LeaderboardPage from "./routes/LeaderboardPage";
import Login from "./routes/Login";
import Onboarding from "./routes/Onboarding";
import TeamPage from "./routes/TeamPage";

const ChallengeView = lazy(() => import("./routes/ChallengeView"));
const AdminLayout = lazy(() => import("./routes/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./routes/admin/AdminDashboard"));
const AdminEvents = lazy(() => import("./routes/admin/AdminEvents"));

function suspended(node: ReactNode) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{node}</Suspense>;
}

function admin(node: ReactNode) {
  return suspended(<RequireAdmin>{node}</RequireAdmin>);
}

export const router = createBrowserRouter([
  {
    element: <AppFrame />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/login", element: <Login /> },
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/events/:eventId", element: <EventCentre /> },
      { path: "/events/:eventId/challenges/:challengeId", element: suspended(<ChallengeView />) },
      { path: "/events/:eventId/leaderboard", element: <LeaderboardPage /> },
      { path: "/events/:eventId/team", element: <TeamPage /> },
      {
        path: "/admin",
        element: admin(<AdminLayout />),
        children: [
          { index: true, element: suspended(<AdminDashboard />) },
          { path: "events", element: suspended(<AdminEvents />) }
        ]
      }
    ]
  }
]);
