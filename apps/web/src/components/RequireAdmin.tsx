import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAdminFlag, useSession } from "../lib/session";

interface RequireAdminProps {
  children: ReactNode;
}

export default function RequireAdmin({ children }: RequireAdminProps) {
  const session = useSession();
  const isAdmin = useAdminFlag();

  if (session.isPending) {
    return <p role="status">Checking access…</p>;
  }

  if (session.isError || !session.data) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <main>
        <h1>Not authorized</h1>
        <p>This area is reserved for event organizers. Access is verified on the server.</p>
      </main>
    );
  }

  return <>{children}</>;
}
