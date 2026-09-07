/** Clerk sign-in page exchanging the session JWT for the app session cookie. */
import { useEffect, useRef, useState } from "react";
import { SignIn, useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { ApiError } from "../lib/api";
import { exchangeClerkSession } from "../lib/session";

type ExchangeState = "idle" | "pending" | "success" | "failure";

export default function Login() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ExchangeState>("idle");
  const [message, setMessage] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || attempted.current) return;
    attempted.current = true;
    setState("pending");
    setMessage("");
    exchangeClerkSession(getToken, queryClient).then(
      () => {
        setState("success");
      },
      (error: unknown) => {
        attempted.current = false;
        setState("failure");
        setMessage(error instanceof ApiError ? error.message : "Could not finish signing in. Retry.");
      }
    );
  }, [isLoaded, isSignedIn, getToken, queryClient]);

  if (!isLoaded) {
    return (
      <main>
        <p role="status">Loading sign-in…</p>
      </main>
    );
  }

  if (!isSignedIn) {
    return (
      <main>
        <h1>Sign in</h1>
        <SignIn forceRedirectUrl="/login" />
      </main>
    );
  }

  if (state === "success") {
    return <Navigate to="/" replace />;
  }

  return (
    <main>
      <h1>Sign in</h1>
      <div aria-live="polite">
        {state === "idle" ? <p role="status">Preparing your session…</p> : null}
        {state === "pending" ? <p role="status">Finishing sign-in…</p> : null}
        {state === "failure" ? <p role="alert">{message}</p> : null}
      </div>
    </main>
  );
}
