import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pharos — Trade Observation Infrastructure",
  description: "Autonomous trade observation infrastructure for Solana AI agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
