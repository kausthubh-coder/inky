import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "The waitlist is temporarily offline" }, { status: 503 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (typeof body.company === "string" && body.company.trim()) {
    return NextResponse.json({ joined: true, alreadyJoined: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length < 5 || email.length > 320 || !emailPattern.test(email)) {
    return NextResponse.json({ error: "Enter a real email address" }, { status: 400 });
  }

  try {
    const clerk = await clerkClient();
    const matches = await clerk.waitlistEntries.list({ query: email, limit: 20 });
    const existing = matches.data.some((entry) => entry.emailAddress.toLowerCase() === email);
    if (!existing) {
      try {
        await clerk.waitlistEntries.create({ emailAddress: email, notify: true });
      } catch {
        const racedMatches = await clerk.waitlistEntries.list({ query: email, limit: 20 });
        const joinedDuringRequest = racedMatches.data.some(
          (entry) => entry.emailAddress.toLowerCase() === email,
        );
        if (!joinedDuringRequest) throw new Error("Clerk waitlist creation failed");
        return NextResponse.json({ joined: true, alreadyJoined: true });
      }
    }
    return NextResponse.json({ joined: true, alreadyJoined: existing }, { status: existing ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "The waitlist could not save your email" }, { status: 502 });
  }
}
