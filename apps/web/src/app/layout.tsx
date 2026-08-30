import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@jobbbler/ui";

import { AppShell } from "@/components/app-shell";
import { WebMcpProvider } from "@/components/webmcp-provider";

import "./globals.css";

const siteTitle = "Jobbbler — Find once. Stay updated. Apply with control.";
const siteDescription =
  "Find explainable technology roles, monitor the right opportunities, and apply with human-controlled agent assistance.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env["PUBLIC_BASE_URL"] ?? "http://localhost:3000"),
  applicationName: "Jobbbler",
  title: {
    default: siteTitle,
    template: "%s · Jobbbler",
  },
  description: siteDescription,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Jobbbler",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/opengraph-jobbbler.png",
        width: 1200,
        height: 630,
        alt: siteTitle,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/opengraph-jobbbler.png"],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

const themeBootstrap = `(()=>{try{const s=localStorage.getItem("jobbbler-theme");const t=s==="dark"||s==="light"?s:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch{document.documentElement.dataset.theme="light"}})()`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ToastProvider>
          <WebMcpProvider>
            <AppShell>{children}</AppShell>
          </WebMcpProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
