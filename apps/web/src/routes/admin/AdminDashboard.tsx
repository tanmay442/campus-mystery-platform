import { Link } from "react-router";

export default function AdminDashboard() {
  return (
    <section aria-label="Admin dashboard">
      <h2>Dashboard</h2>
      <p className="muted">
        Live counts, events needing attention, and quick actions land here in Phase 2. Every action is enforced and
        audited on the server.
      </p>
      <Link className="button button-primary" to="/admin/events">
        Manage events
      </Link>
    </section>
  );
}
