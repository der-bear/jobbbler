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

function evalExpectedToolNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const file of readdirSync(evalsDirectory)) {
    if (!file.endsWith(".json")) continue;
    const fixture = JSON.parse(readFileSync(join(evalsDirectory, file), "utf8")) as {
      cases?: readonly {
        expected?: Readonly<{ tool?: string; intendedTool?: string }>;
      }[];
    };
    for (const testCase of fixture.cases ?? []) {
      if (testCase.expected?.tool !== undefined) names.add(testCase.expected.tool);
      if (testCase.expected?.intendedTool !== undefined) {
        names.add(testCase.expected.intendedTool);
      }
    }
  }
  return names;
}

describe("webMcpCatalog", () => {
  it("documents one unique global inventory of 29 agent capabilities", () => {
    const tools = webMcpCatalog.flatMap((route) => route.tools);
    const names = tools.map(({ name }) => name);

    expect(names).toHaveLength(29);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("get_job_application_capability");
    expect(names).toEqual(
      expect.arrayContaining([
        "request_search_alert",
        "save_job_search",
        "decide_search_alert",
        "enable_workspace_recovery",
        "recover_jobbbler_workspace",
        "get_applications",
      ]),
    );
    expect(webMcpCatalog[0]?.note).toContain("Every capability stays registered");
  });

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

  it("routes or rejects at least one current case for every global tool", () => {
    const catalogNames = new Set(
      webMcpCatalog.flatMap((route) => route.tools.map((tool) => tool.name)),
    );
    const exercisedNames = evalExpectedToolNames();

    for (const name of catalogNames) {
      expect(exercisedNames, `no eval case selects ${name}`).toContain(name);
    }
  });

  it("keeps exactly 51 uniquely identified routing cases", () => {
    const caseIds = evalCaseIds();

    expect(caseIds).toHaveLength(51);
    expect(new Set(caseIds).size).toBe(caseIds.length);
  });
});
