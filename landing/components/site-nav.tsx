"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { track } from "../lib/analytics";
import { InkyMascot } from "./inky-mascot";

const NAV_LINKS = [
  ["#what", "Inky"],
  ["#trust", "Trust"],
  ["#faq", "FAQ"],
  ["/mission", "Mission"],
] as const;

type SiteNavProps = {
  current?: string;
  flat?: boolean;
  tour?: boolean;
  account?: boolean;
};

export function SiteNav({
  current = "",
  flat = false,
  tour = false,
  account = false,
}: SiteNavProps) {
  const [active, setActive] = useState(current);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (flat || tour) return;
    // Observe every section so the highlight clears on sections without a nav link.
    const ids = ["what", "compare", "trust", "sites", "wait", "faq"];
    const linked = new Set<string>(NAV_LINKS.map(([href]) => href));
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        if (!hit) return;
        const href = `#${hit.target.id}`;
        setActive(linked.has(href) ? href : "");
      },
      { rootMargin: "-40% 0px -50% 0px" },
    );
    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [flat, tour]);

  const home = account ? "/dashboard" : flat ? "/" : "#top";
  const wait = flat ? "/#wait" : "#wait";

  return (
    <header
      className={`site-nav${open ? " open" : ""}${flat ? " flat" : ""}${account ? " account-nav" : ""}`}
    >
      <a className="wordmark" href={home} onClick={() => setOpen(false)}>
        <span className="nav-inky" aria-hidden="true">
          <InkyMascot state="idle" size={44} />
        </span>
        <span>studi</span>
      </a>
      {!tour && !account && (
        <nav className="links" id="site-links" aria-label="Page">
          {NAV_LINKS.map(([href, label]) => {
            const dest = flat && href.startsWith("#") ? `/${href}` : href;
            const selected = active === href || current === href;
            return (
              <a
                href={dest}
                key={href}
                className={selected ? "on" : ""}
                aria-current={selected ? "location" : undefined}
                onClick={() => setOpen(false)}
              >
                {label}
              </a>
            );
          })}
        </nav>
      )}
      <div className="nav-actions">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <>
            <SignedOut>
              <a
                className="sign-in-link"
                href="/sign-in"
                onClick={() => {
                  track("sign_in_started", { placement: "navigation" });
                  setOpen(false);
                }}
              >
                Sign in
              </a>
              <a
                className="cta"
                href={wait}
                onClick={() => {
                  track("waitlist_cta_clicked", { placement: "navigation" });
                  setOpen(false);
                }}
              >
                Join the waitlist
              </a>
            </SignedOut>
            <SignedIn>
              {!account && (
                <a
                  className="dashboard-link"
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                >
                  Dashboard
                </a>
              )}
              <UserButton>
                <UserButton.MenuItems>
                  <UserButton.Link
                    label="Dashboard"
                    labelIcon={<span aria-hidden="true">⌂</span>}
                    href="/dashboard"
                  />
                  <UserButton.Link
                    label="Settings"
                    labelIcon={<span aria-hidden="true">⚙</span>}
                    href="/settings"
                  />
                  <UserButton.Link
                    label="Feedback"
                    labelIcon={<span aria-hidden="true">✎</span>}
                    href="/feedback"
                  />
                </UserButton.MenuItems>
              </UserButton>
            </SignedIn>
          </>
        ) : (
          <>
            <a
              className="sign-in-link"
              href="/sign-in"
              onClick={() => setOpen(false)}
            >
              Sign in
            </a>
            <a className="cta" href={wait} onClick={() => setOpen(false)}>
              Join the waitlist
            </a>
          </>
        )}
      </div>
      {!tour && !account && (
        <button
          type="button"
          className="menu"
          aria-expanded={open}
          aria-controls="site-links"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="visually-hidden">Menu</span>
          <i />
          <i />
        </button>
      )}
    </header>
  );
}
