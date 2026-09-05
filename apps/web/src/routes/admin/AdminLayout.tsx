import { Link, Outlet } from "react-router";

export default function AdminLayout() {
  return (
    <main>
      <header>
        <p className="eyebrow">Organizers only</p>
        <h1>Admin</h1>
      </header>
      <nav aria-label="Admin">
        <ul className="stack">
          <li>
            <Link className="button" to="/admin">
              Dashboard
            </Link>
          </li>
          <li>
            <Link className="button" to="/admin/events">
              Events
            </Link>
          </li>
        </ul>
      </nav>
      <Outlet />
    </main>
  );
}
