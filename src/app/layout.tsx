import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DevConsoleLogger } from "@/components/DevConsoleLogger";
import AppHeader from "@/components/AppHeader";
import PlanStoreProvider from "@/components/PlanStoreProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crop Planner",
  description: "Plan your crop rotations and bed assignments",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PlanStoreProvider>
          <DevConsoleLogger />
          <AppHeader />
          {children}
        </PlanStoreProvider>
      </body>
    </html>
  );
}
