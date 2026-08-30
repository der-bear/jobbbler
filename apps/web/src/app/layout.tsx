import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ToastProvider } from "@jobbbler/ui";

import { AppShell } from "@/components/app-shell";
import { WebMcpProvider } from "@/components/webmcp-provider";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env["PUBLIC_BASE_URL"] ?? "http://localhost:3000"),
  title: {
    default: "Jobbbler — Find once. Stay updated. Apply with control.",
    template: "%s · Jobbbler",
  },
  description:
    "Find explainable technology roles, monitor the right opportunities, and apply with human-controlled agent assistance.",
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
