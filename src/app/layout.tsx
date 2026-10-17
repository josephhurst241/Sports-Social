import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
