import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const uiRoot = fileURLToPath(new URL("../../../../packages/ui/src", import.meta.url));

/*
 * A design system only holds if the product actually builds from it. An exported
 * primitive with no call site is not a system, it is a suggestion — and features
 * that hand-roll their own version are how one product ends up with four chip
 * shapes and sixteen font weights.
 *
 * This is a ratchet, not a wish: `adopted` may only grow. Moving a primitive out
 * of `awaitingAdoption` is a deliberate act, and losing the last call site of an
 * adopted one fails here rather than being noticed in a later audit.
 */
const adopted = [
  "Button",
  "Chip",
  "MultiSelect",
  "ThemeToggle",
  "ToastProvider",
  "useToast",
] as const;

const awaitingAdoption = ["Card", "Dialog", "Input", "Sheet", "Skeleton"] as const;

async function collectSources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSources(path)));
      continue;
    }
    if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) continue;
    files.push(await readFile(path, "utf8"));
  }
  return files;
}

async function importedNames(): Promise<ReadonlySet<string>> {
  const sources = await collectSources(sourceRoot);
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@jobbbler\/ui"/gu)) {
      const clause = match[1];
      if (clause === undefined) continue;
      for (const part of clause.split(",")) {
        const name = part.replace(/^\s*type\s+/u, "").trim();
        if (name.length > 0) names.add(name);
      }
    }
  }
  return names;
}

describe("design system adoption", () => {
  it("keeps every adopted primitive in use by the product", async () => {
    const used = await importedNames();
    const dropped = adopted.filter((name) => !used.has(name));
    expect(dropped, "adopted primitives must keep at least one call site").toEqual([]);
  });

  it("records every exported primitive as either adopted or awaiting adoption", async () => {
    const index = await readFile(join(uiRoot, "index.ts"), "utf8");
    const modules = [...index.matchAll(/export \* from "\.\/([a-z-]+)\.js"/gu)].map(
      (match) => match[1] ?? "",
    );
    const exported = new Set<string>();
    for (const moduleName of modules) {
      const source = await readFile(join(uiRoot, `${moduleName}.tsx`), "utf8");
      for (const match of source.matchAll(/export (?:function|const) ([A-Z]\w+|use[A-Z]\w+)/gu)) {
        const name = match[1];
        if (name !== undefined) exported.add(name);
      }
    }
    const accounted = new Set<string>([...adopted, ...awaitingAdoption]);
    const unaccounted = [...exported].filter((name) => !accounted.has(name)).sort();
    expect(unaccounted, "a new primitive must be listed as adopted or awaiting adoption").toEqual(
      [],
    );
  });
});
