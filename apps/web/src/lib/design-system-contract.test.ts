import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokenSheet = new URL("../../../../packages/ui/src/tokens.css", import.meta.url);
const webSource = fileURLToPath(new URL("..", import.meta.url));
const uiSource = fileURLToPath(new URL("../../../../packages/ui/src", import.meta.url));

async function cssFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await cssFiles(path)));
    } else if (entry.name.endsWith(".css") && entry.name !== "tokens.css") {
      files.push(path);
    }
  }
  return files;
}

describe("Jobbbler design tokens", () => {
  it("defines one semantic, rem-based typography scale for product surfaces", async () => {
    const css = await readFile(tokenSheet, "utf8");

    expect(css).toContain("--jb-type-caption: 0.75rem;");
    expect(css).toContain("--jb-type-label: 0.8125rem;");
    expect(css).toContain("--jb-type-ui: 0.875rem;");
    expect(css).toContain("--jb-type-body-sm: 0.9375rem;");
    expect(css).toContain("--jb-type-body: 1rem;");
  });

  it("routes compact product typography through the shared scale", async () => {
    const paths = [...(await cssFiles(webSource)), ...(await cssFiles(uiSource))];
    const oneOffSizes: string[] = [];

    for (const path of paths) {
      const css = await readFile(path, "utf8");
      if (/font-size:\s*(?:1[0-6]px|(?:0\.(?:625|6875|75|8125|875|9375)|1)rem)\b/u.test(css)) {
        oneOffSizes.push(path);
      }
    }

    expect(oneOffSizes, "compact text must use a semantic typography token").toEqual([]);
  });

  it("routes pill geometry through the shared radius token", async () => {
    const paths = [...(await cssFiles(webSource)), ...(await cssFiles(uiSource))];
    const rawPillRadii: string[] = [];

    for (const path of paths) {
      const css = await readFile(path, "utf8");
      if (/border-radius:\s*999px\b/u.test(css)) rawPillRadii.push(path);
    }

    expect(rawPillRadii, "pill radii must use the shared design token").toEqual([]);
  });
});
