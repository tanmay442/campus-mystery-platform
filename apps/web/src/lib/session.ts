/** Session account state plus the Clerk-to-cookie session exchange. */
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "./api";

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  platformCredits: number;
  presenceVisibility: string;
  isAdmin: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["email"] === "string" &&
    typeof value["username"] === "string" &&
    (typeof value["displayName"] === "string" || value["displayName"] === null) &&
    typeof value["platformCredits"] === "number" &&
    typeof value["presenceVisibility"] === "string" &&
    typeof value["isAdmin"] === "boolean"
  );
}

export function useSession() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<SessionUser>("/me", isSessionUser),
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
