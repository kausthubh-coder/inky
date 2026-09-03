import type { Metadata } from "next";
import { Nunito_Sans, Shantell_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

const shantell = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-shantell",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Studi — Hi. I’m Inky. I do your homework.",
  description:
    "Your week on one board. The assignment you’re avoiding, done while you watch. The last click stays yours.",
  openGraph: {
    title: "Hi. I’m Inky. I do your homework.",
    description:
      "Your week on one board. The assignment you’re avoiding, done while you watch. The last click stays yours.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${shantell.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
