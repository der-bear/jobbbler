import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { webMcpCatalog } from "./webmcp-catalog";

const evalsDirectory = join(import.meta.dirname, "../../../../evals/webmcp");

function evalToolNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of readdirSync(evalsDirectory)) {
    if (!file.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(join(evalsDirectory, file), "utf8")) as {
      registeredTools?: readonly string[];
      cases?: readonly { registeredTools?: readonly string[] }[];
    };
    for (const name of fixture.registeredTools ?? []) names.add(name);
    for (const testCase of fixture.cases ?? []) {
      for (const name of testCase.registeredTools ?? []) names.add(name);
    }
  }
  return names;
}

function evalCaseIds(): readonly string[] {
  const ids: string[] = [];
  for (const file of readdirSync(evalsDirectory)) {
    if (!file.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(join(evalsDirectory, file), "utf8")) as {
      cases?: readonly { id: string }[];
    };
    for (const testCase of fixture.cases ?? []) ids.push(testCase.id);
  }
  return ids;
}

describe("webMcpCatalog", () => {
  it("stays in sync with the eval fixtures' tool inventory", () => {
    const catalogNames = new Set(
      webMcpCatalog.flatMap((route) => route.tools.map((tool) => tool.name)),
    );
    const fixtureNames = evalToolNames();

    for (const name of fixtureNames) {
      expect(catalogNames, `catalog is missing ${name}`).toContain(name);
    }
    for (const name of catalogNames) {
      expect(fixtureNames, `evals never exercise ${name}`).toContain(name);
    }
  });

  it("keeps every purpose short enough to scan", () => {
    for (const route of webMcpCatalog) {
      for (const tool of route.tools) {
        expect(tool.purpose.length).toBeLessThanOrEqual(120);
      }
    }
  });

  it("keeps exactly 50 uniquely identified routing cases", () => {
    const caseIds = evalCaseIds();

    expect(caseIds).toHaveLength(50);
    expect(new Set(caseIds).size).toBe(caseIds.length);
  });
});
