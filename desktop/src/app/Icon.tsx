import type { ReactNode } from "react";

const paths = {
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  down: <path d="m7 10 5 5 5-5" />,
  send: <><path d="M12 19V5m-6 6 6-6 6 6" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  note: <><path d="M5 4h14v12h-8l-6 4z" /><path d="M8 8h8M8 12h5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18M8 14h2m4 0h2m-8 3h2" /></>,
  settings: <><path d="m9 3-.6 2.2-2 .9-2-.6-2 3.4L4 10.5v3l-1.6 1.6 2 3.4 2-.6 2 .9L9 21h4l.6-2.2 2-.9 2 .6 2-3.4-1.6-1.6v-3l1.6-1.6-2-3.4-2 .6-2-.9L13 3z" /><circle cx="11" cy="12" r="3" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
