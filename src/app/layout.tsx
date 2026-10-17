import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { INTRO_SCRIPT } from "@/components/brand/intro";
import "./globals.css";

// SF Pro is used where the OS ships it (Apple devices); Inter everywhere else.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sports Social",
  description: "Motion-controlled games in a glass hub. Your phone is the controller.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // INTRO_SCRIPT sets <html data-intro> before paint, so React must not object to it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
