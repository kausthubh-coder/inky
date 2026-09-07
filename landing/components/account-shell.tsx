"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteNav } from "./site-nav";

const ACCOUNT_LINKS = [
  ["/dashboard", "Home"],
  ["/settings", "Settings"],
  ["/billing", "Billing"],
  ["/usage", "Usage"],
  ["/feedback", "Feedback"],
] as const;

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <SiteNav flat account />
      <main className="account-page">
        <div className="account-shell">
          <nav className="account-tabs" aria-label="Your Studi account">
            {ACCOUNT_LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={pathname.startsWith(href) ? "on" : undefined}
                aria-current={pathname.startsWith(href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </main>
    </>
  );
}
