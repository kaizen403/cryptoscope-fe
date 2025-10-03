import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cryptographic Code Analyzer",
  description:
    "Modern dashboard for auditing cryptographic usage across your repositories.",
  icons: {
    icon: [
      { url: "/favicon.ico", rel: "icon", type: "image/x-icon" },
      { url: "/globe.svg", rel: "icon", type: "image/svg+xml" }
    ]
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
