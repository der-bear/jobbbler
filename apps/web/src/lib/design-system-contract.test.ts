import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokenSheet = new URL("../../../../packages/ui/src/tokens.css", import.meta.url);
const webSource = fileURLToPath(new URL("..", import.meta.url));
const uiSource = fileURLToPath(new URL("../../../../packages/ui/src", import.meta.url));

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../gu)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function hexToken(css: string, name: string): string {
  const value = css.match(new RegExp(`--jb-${name}:\\s*(#[0-9a-f]{6});`, "iu"))?.[1];
  if (value === undefined) throw new Error(`Missing hex token --jb-${name}`);
  return value;
}

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

  it("defines the shared frosted-material scale beside the other design tokens", async () => {
    const css = await readFile(tokenSheet, "utf8");

    expect(css).toContain("--jb-glass-control:");
    expect(css).toContain("--jb-glass-fill:");
    expect(css).toContain("--jb-glass-float:");
    expect(css).toContain("--jb-glass-menu:");
    expect(css).toContain("--jb-glass-sheet:");
    expect(css).toContain("--jb-glass-blur-control:");
    expect(css).toContain("--jb-glass-blur:");
    expect(css).toContain("--jb-glass-blur-float:");
    expect(css).toContain("--jb-glass-blur-sheet:");
  });

  it("routes backdrop blur and visible border weights through the shared system", async () => {
    const tokens = await readFile(tokenSheet, "utf8");
    const paths = [...(await cssFiles(webSource)), ...(await cssFiles(uiSource))];
    const rawBackdropFilters: string[] = [];
    const twoPixelBorders: string[] = [];

    for (const path of paths) {
      const css = await readFile(path, "utf8");
      if (/^\s*(?:-webkit-)?backdrop-filter:(?!\s*var\()[^;]+;/mu.test(css)) {
        rawBackdropFilters.push(path);
      }
      if (/border(?:-[a-z-]+)?:\s*2px\s+solid\b/u.test(css)) twoPixelBorders.push(path);
    }

    expect(rawBackdropFilters, "backdrop blur must use the material scale").toEqual([]);
    expect(twoPixelBorders, "visible borders may not exceed the control stroke").toEqual([]);
    expect(tokens, "active indicators must stay on the one-pixel control stroke").toContain(
      "--jb-stroke-indicator: 1px;",
    );
  });

  it("keeps normal text and action states at WCAG AA contrast in both themes", async () => {
    const css = await readFile(tokenSheet, "utf8");
    const darkThemeStart = css.indexOf(':root[data-theme="dark"]');
    const lightTheme = css.slice(0, darkThemeStart);
    const darkTheme = css.slice(darkThemeStart);

    const themes = [
      {
        name: "light",
        css: lightTheme,
        pairs: [
          ["text", "canvas"],
          ["text-muted", "canvas"],
          ["signal", "canvas"],
          ["danger", "canvas"],
          ["warning", "canvas"],
          ["signal-contrast", "signal"],
          ["signal-disabled-contrast", "signal-disabled"],
          ["toast-muted", "toast-bg"],
        ],
      },
      {
        name: "dark",
        css: darkTheme,
        pairs: [
          ["text", "canvas"],
          ["text-muted", "canvas"],
          ["signal", "canvas"],
          ["danger", "canvas"],
          ["warning", "canvas"],
          ["signal-contrast", "signal"],
          ["signal-disabled-contrast", "signal-disabled"],
          ["toast-muted", "toast-bg"],
        ],
      },
    ] as const;

    for (const theme of themes) {
      for (const [foregroundName, backgroundName] of theme.pairs) {
        const ratio = contrastRatio(
          hexToken(theme.css, foregroundName),
          hexToken(theme.css, backgroundName),
        );
        expect(
          ratio,
          `${theme.name} --${foregroundName} on --${backgroundName} must remain readable`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
