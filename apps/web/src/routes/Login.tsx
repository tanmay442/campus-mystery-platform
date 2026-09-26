/** Clerk sign-in page exchanging the session JWT for the app session cookie. */
import { useEffect, useRef, useState } from "react";
import { SignIn, useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { ApiError } from "../lib/api";
import { exchangeClerkSession } from "../lib/session";

type ExchangeState = "idle" | "pending" | "success" | "failure";

export default function Login() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ExchangeState>("idle");
  const [message, setMessage] = useState("");
  const attempted = useRef(false);
  const announce = useAnnounce();

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

  useEffect(() => {
    if (state === "failure" && message.length > 0) {
      announce(message, "assertive");
    }
  }, [state, message, announce]);

  if (!isLoaded) {
    return <Spinner label="Loading sign-in…" />;
  }

  if (!isSignedIn) {
    return (
      <Layout
        contentWidth={640}
        content={
          <LayoutContent>
            <Section aria-label="Sign in">
              <VStack gap={2}>
                <Heading level={1}>Sign in</Heading>
                <SignIn forceRedirectUrl="/login" />
              </VStack>
            </Section>
          </LayoutContent>
        }
      />
    );
  }

  if (state === "success") {
    return <Navigate to="/" replace />;
  }

  return (
    <Layout
      contentWidth={640}
      content={
        <LayoutContent>
          <Section aria-label="Sign in progress">
            <VStack gap={2}>
              <Heading level={1}>Sign in</Heading>
              {state === "idle" ? <Text>Preparing your session…</Text> : null}
              {state === "pending" ? <Spinner label="Finishing sign-in…" /> : null}
              {state === "failure" ? (
                <Banner status="error" title="Sign-in failed" description={message} collapsible={false} />
              ) : null}
            </VStack>
          </Section>
        </LayoutContent>
      }
    />
  );
}
