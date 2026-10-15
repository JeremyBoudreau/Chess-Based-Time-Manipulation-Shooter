import { Toaster } from "@buckshot/ui/components/sonner";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  description:
    "You are the king. You have a shotgun. Time only moves when you move.",
  title: {
    default: "Buckshot Gambit",
    template: "%s · Buckshot Gambit",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className="dark" lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh`}>
        {children}
        {/* The app is dark-only and has no ThemeProvider, so pin sonner's theme explicitly. */}
        <Toaster position="top-center" theme="dark" />
      </body>
    </html>
  );
}
