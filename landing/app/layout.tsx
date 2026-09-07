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
  title: "Studi — Your homework. Handled.",
  description:
    "Meet Inky, the homework helper in Studi. See how he finds your assignments and does the work, then join the private beta waitlist.",
  openGraph: {
    title: "Studi — Your homework. Handled.",
    description:
      "Meet Inky, the homework helper in Studi. See how he finds your assignments and does the work, then join the private beta waitlist.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${nunito.variable} ${shantell.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
