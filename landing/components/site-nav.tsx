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
};

export function SiteNav({ current = "", flat = false }: SiteNavProps) {
  const [active, setActive] = useState(current);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (flat) return;
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
  }, [flat]);

  const home = flat ? "/" : "#top";
  const wait = flat ? "/#wait" : "#wait";

  return (
    <header className={`site-nav${open ? " open" : ""}${flat ? " flat" : ""}`}>
      <a className="wordmark" href={home} onClick={() => setOpen(false)}>
        <span className="nav-inky" aria-hidden="true">
          <InkyMascot state="idle" size={44} />
        </span>
        <span>studi</span>
      </a>
      <nav className="links" id="site-links" aria-label="Page">
        {NAV_LINKS.map(([href, label]) => {
          const dest = flat && href.startsWith("#") ? `/${href}` : href;
          return (
            <a
              href={dest}
              key={href}
              className={active === href || current === href ? "on" : ""}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          );
        })}
      </nav>
      <div className="nav-actions">
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <>
            <SignedOut>
              <a className="sign-in-link" href="/sign-in" onClick={() => { track("sign_in_started", { placement: "navigation" }); setOpen(false); }}>
                Sign in
              </a>
              <a className="cta" href={wait} onClick={() => { track("waitlist_cta_clicked", { placement: "navigation" }); setOpen(false); }}>
                Save me a seat
              </a>
            </SignedOut>
            <SignedIn>
              <a className="dashboard-link" href="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </a>
              <UserButton>
                <UserButton.MenuItems>
                  <UserButton.Link label="Dashboard" labelIcon={<span aria-hidden="true">⌂</span>} href="/dashboard" />
                  <UserButton.Link label="Settings" labelIcon={<span aria-hidden="true">⚙</span>} href="/settings" />
                  <UserButton.Link label="Feedback" labelIcon={<span aria-hidden="true">✎</span>} href="/feedback" />
                </UserButton.MenuItems>
              </UserButton>
            </SignedIn>
          </>
        ) : (
          <>
            <a className="sign-in-link" href="/sign-in" onClick={() => setOpen(false)}>
              Sign in
            </a>
            <a className="cta" href={wait} onClick={() => setOpen(false)}>
              Save me a seat
            </a>
          </>
        )}
      </div>
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
    </header>
  );
}
