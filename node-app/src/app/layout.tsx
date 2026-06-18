import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";
import AuthSessionProvider from "@/components/auth-session-provider";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Legal Document Analysis AI - Kansas Law Compliance",
  description:
    "Comprehensive AI-powered legal document analysis for Kansas state and federal courts",
  generator: "v0.app",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthSessionProvider>
          {children}
          <Toaster />
        </AuthSessionProvider>
      </body>
    </html>
  );
}