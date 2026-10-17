import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MedVent Simulator",
  description: "Mechanical ventilation teaching simulator. Education only, not for clinical use.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <div
          role="note"
          className="bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-900"
        >
          Education only. Not for clinical use.
        </div>
        {children}
      </body>
    </html>
  );
}
