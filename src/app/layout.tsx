import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Curavilo - Healthcare Operating Platform",
  description:
    "Configurable, multi-tenant, AI-powered healthcare operating platform for hospitals, clinics, diagnostic centres, laboratories and pharmacies.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%230f766e'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>C</text></svg>",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* External file: runs before hydration, needs no CSP nonce (script-src 'self'),
            and introduces no server/client attribute drift. See Task 6 for background.
            Synchronous execution is intentional - it must complete before React hydrates. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/ext-attr-cleanup.js" />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
