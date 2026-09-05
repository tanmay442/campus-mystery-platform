import { useState } from "react";
import type { FormEvent } from "react";

type SubmitState = "idle" | "pending" | "success" | "failure";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>("idle");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "pending") return;
    if (email.trim().length === 0) {
      setState("failure");
      return;
    }
    setState("pending");
    window.setTimeout(() => setState("success"), 600);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>Accounts are open to everyone. Email verification is required before you can join an event.</p>
      <form onSubmit={handleSubmit} aria-label="Sign in">
        <label htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div id="turnstile-mount" role="region" aria-label="Bot verification" />
        <button type="submit" disabled={state === "pending"} aria-busy={state === "pending"}>
          {state === "pending" ? "Signing in…" : "Continue with email"}
        </button>
      </form>
      <div aria-live="polite">
        {state === "success" ? <p role="status">Check your inbox for a verification link.</p> : null}
        {state === "failure" ? <p role="alert">Enter a valid email address to continue.</p> : null}
      </div>
    </main>
  );
}
