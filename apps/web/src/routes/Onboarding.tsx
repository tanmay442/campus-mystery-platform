/** How-it-works guide; requires Clerk sign-in. */
import { useAuth } from "@clerk/react";
import { Link, Navigate } from "react-router";

const CARDS = [
  {
    title: "What this is",
    body: "Campus Mystery turns campus culture and hidden corners into playable stories you solve with your feet and your head."
  },
  {
    title: "Solo or team",
    body: "Play alone or build a team of up to five. Any active member can complete objectives for the whole team."
  },
  {
    title: "The current story",
    body: "Each event opens with a premise. Follow chapters from the event centre and unlock what comes next."
  },
  {
    title: "Prizes and recognition",
    body: "Earn event points for your participant and platform credits for yourself. The live leaderboard shows the top 10."
  },
  {
    title: "Stay safe",
    body: "Never enter roads, rooftops, construction zones, or restricted rooms. Walk, do not run, and follow the emergency contact in the event centre."
  },
  {
    title: "Points, credits, hints",
    body: "Hints can cost points. Wrong answers can trigger cooldowns. Every completed objective is saved immediately."
  }
];

export default function Onboarding() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <main>
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main>
      <h1>How it works</h1>
      <p>
        Skipped it before? <Link to="/">Back to the start</Link> whenever you like.
      </p>
      <ol className="onboarding-cards">
        {CARDS.map((card) => (
          <li key={card.title} className="card">
            <h2>{card.title}</h2>
            <p>{card.body}</p>
          </li>
        ))}
      </ol>
      <section aria-label="Location permission">
        <h2>About location access</h2>
        <p>
          Location permission is requested just in time, when you open your first location objective. It is never asked
          for on the landing page.
        </p>
      </section>
      <div className="actions">
        <Link className="button button-primary" to="/login">
          Continue to sign in
        </Link>
        <Link className="button" to="/">
          Skip for now
        </Link>
      </div>
    </main>
  );
}
