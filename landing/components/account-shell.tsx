"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteNav } from "./site-nav";

const ACCOUNT_LINKS = [
  ["/dashboard", "Dashboard"],
  ["/settings", "Account settings"],
  ["/billing", "Billing"],
  ["/connect/desktop", "Open Studi"],
] as const;

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <SiteNav flat />
      <main className="account-page">
        <div className="account-shell">
          <nav className="account-tabs" aria-label="Your Studi account">
            {ACCOUNT_LINKS.map(([href, label]) => (
              <a className={pathname.startsWith(href) ? "on" : ""} href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
          {children}
        </div>
      </main>
    </>
  );
}
