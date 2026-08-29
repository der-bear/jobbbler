import { describe, expect, it, vi } from "vitest";

import { err, mapResult, ok } from "./result.js";

describe("Result", () => {
  it("maps successful values", () => {
    expect(mapResult(ok(3), (value) => value * 2)).toEqual({ ok: true, value: 6 });
  });

  it("does not run a mapper for an error", () => {
    const mapper = vi.fn((value: number) => value * 2);
    const result = mapResult(err("denied"), mapper);

    expect(result).toEqual({ ok: false, error: "denied" });
    expect(mapper).not.toHaveBeenCalled();
  });
});
