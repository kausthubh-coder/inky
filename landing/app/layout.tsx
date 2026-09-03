import type { Metadata } from "next";
import { Nunito_Sans, Shantell_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
import "../designs/inky.css";

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
  title: "It does your homework for you · Studi",
  description: "A Windows app. One school browser you can watch. You keep logins and submit.",
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
