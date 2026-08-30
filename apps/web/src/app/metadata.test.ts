import type { Metadata } from "next";
import { describe, expect, it } from "vitest";

import * as ApplicationPageModule from "./apply/[draftId]/page";
import * as ComparePageModule from "./compare/page";
import * as JobDetailPageModule from "./jobs/[jobId]/page";
import * as JobsPageModule from "./jobs/page";
import { metadata as rootMetadata, viewport } from "./layout";
import manifest from "./manifest";

function metadataFrom(module: object): Metadata | undefined {
  return Reflect.get(module, "metadata") as Metadata | undefined;
}

describe("Jobbbler metadata identity", () => {
  it("publishes one installable and shareable product identity", () => {
    expect(rootMetadata).toMatchObject({
      applicationName: "Jobbbler",
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
        title: "Jobbbler — Find once. Stay updated. Apply with control.",
        description:
          "Find explainable technology roles, monitor the right opportunities, and apply with human-controlled agent assistance.",
        images: [
          {
            url: "/opengraph-jobbbler.png",
            width: 1200,
            height: 630,
            alt: "Jobbbler — Find once. Stay updated. Apply with control.",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "Jobbbler — Find once. Stay updated. Apply with control.",
        images: ["/opengraph-jobbbler.png"],
      },
    });
  });

  it("keeps browser and installed-app chrome neutral in both color schemes", () => {
    expect(viewport).toMatchObject({
      colorScheme: "light dark",
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
        { media: "(prefers-color-scheme: dark)", color: "#191919" },
      ],
    });
    expect(manifest()).toMatchObject({
      background_color: "#191919",
      theme_color: "#191919",
    });
  });

  it.each([
    ["job catalog", JobsPageModule, "Technology jobs"],
    ["role detail", JobDetailPageModule, "Role details"],
    ["comparison", ComparePageModule, "Compare technology roles"],
    ["private application", ApplicationPageModule, "Application review"],
  ])("gives the %s route a stable title", (_label, module, title) => {
    expect(metadataFrom(module)).toMatchObject({ title });
  });

  it("keeps private application metadata free of draft identifiers", () => {
    const applicationMetadata = metadataFrom(ApplicationPageModule);

    expect(applicationMetadata).toMatchObject({
      title: "Application review",
      description: "Review one private Jobbbler application and keep the final decision yours.",
      robots: { index: false, follow: false },
    });
    expect(JSON.stringify(applicationMetadata)).not.toContain("draftId");
  });
});
