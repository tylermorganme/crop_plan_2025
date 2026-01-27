import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DevConsoleLogger } from "@/components/DevConsoleLogger";
import PlanStoreProvider from "@/components/PlanStoreProvider";
import UIStoreProvider from "@/components/UIStoreProvider";
import { ClientLogger } from "@/components/ClientLogger";
import { GlobalToast } from "@/components/GlobalToast";

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
          <UIStoreProvider>
            <ClientLogger />
            <DevConsoleLogger />
            <GlobalToast />
            {children}
          </UIStoreProvider>
        </PlanStoreProvider>
      </body>
    </html>
  );
}
