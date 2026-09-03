"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

function ConvexTree({ children }: { children: ReactNode }) {
  const client = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), []);
  if (!client) return children;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const tree = <ConvexTree>{children}</ConvexTree>;
  if (!clerkKey) return tree;
  return <ClerkProvider publishableKey={clerkKey}>{tree}</ClerkProvider>;
}
