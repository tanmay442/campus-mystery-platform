import { Navigate } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import type { ReactNode } from "react";
import { useAdminFlag, useSession } from "../lib/session";

interface RequireAdminProps {
  children: ReactNode;
}

export default function RequireAdmin({ children }: RequireAdminProps) {
  const session = useSession();
  const isAdmin = useAdminFlag();

  if (session.isPending) {
    return <Spinner label="Checking access…" />;
  }

  if (session.isError || !session.data) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <Banner
        status="error"
        title="Not authorized"
        description="This area is reserved for event organizers. Access is verified on the server."
        collapsible={false}
      />
    );
  }

  return <>{children}</>;
}
