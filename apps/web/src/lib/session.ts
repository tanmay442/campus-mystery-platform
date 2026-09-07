/** Session account state plus the Clerk-to-cookie session exchange. */
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["username"] === "string" &&
    (typeof value["displayName"] === "string" || value["displayName"] === null) &&
    typeof value["isAdmin"] === "boolean"
  );
}

function isNullableSessionUser(value: unknown): value is SessionUser | null {
  return value === null || isSessionUser(value);
}

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<SessionUser | null>("/me", isNullableSessionUser),
    staleTime: 60_000
  });
}

export function useAdminFlag(): boolean {
  const session = useSession();
  return session.data?.isAdmin === true;
}

export type GetClerkToken = () => Promise<string | null>;

export async function exchangeClerkSession(
  getToken: GetClerkToken,
  queryClient: QueryClient
): Promise<void> {
  const token = await getToken();
  if (token === null) {
    throw new ApiError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
  await apiPost("/auth/login", { provider: "clerk", token }, isRecord);
  await queryClient.invalidateQueries({ queryKey: ["me"] });
}
