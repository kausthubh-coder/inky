"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo, type ReactNode } from "react";
import { AnalyticsProvider } from "../components/analytics-provider";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

function ConvexTree({ children }: { children: ReactNode }) {
  const client = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), []);
  if (!client) return children;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

function ClerkConvexTree({ children }: { children: ReactNode }) {
  const client = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), []);
  if (!client) return children;
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  if (!clerkKey) return <AnalyticsProvider><ConvexTree>{children}</ConvexTree></AnalyticsProvider>;
  return (
    <AnalyticsProvider>
      <ClerkProvider
        publishableKey={clerkKey}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        waitlistUrl="/#wait"
        signInFallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
        afterSignOutUrl="/"
        appearance={{
          variables: {
            colorPrimary: "#1c1612",
            colorBackground: "#fffaf0",
            colorText: "#1c1612",
            colorInputBackground: "#ffffff",
            colorInputText: "#1c1612",
            borderRadius: "14px",
            fontFamily: "var(--font-nunito), Nunito Sans, sans-serif",
          },
        }}
      >
        <ClerkConvexTree>{children}</ClerkConvexTree>
      </ClerkProvider>
    </AnalyticsProvider>
  );
}
