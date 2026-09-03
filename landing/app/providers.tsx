"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo, type ReactNode } from "react";

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
  if (!clerkKey) return <ConvexTree>{children}</ConvexTree>;
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <ClerkConvexTree>{children}</ClerkConvexTree>
    </ClerkProvider>
  );
}
