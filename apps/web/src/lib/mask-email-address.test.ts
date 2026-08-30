import { describe, expect, it } from "vitest";

import { maskEmailAddress } from "./mask-email-address";

describe("maskEmailAddress", () => {
  it("preserves the domain while bounding the hidden local part", () => {
    expect(maskEmailAddress("a@example.com")).toBe("a••@example.com");
    expect(maskEmailAddress("person@example.com")).toBe("p•••••@example.com");
    expect(maskEmailAddress("averylonglocalpart@example.com")).toBe("a•••••@example.com");
  });

  it("rejects text that is not an email address", () => {
    expect(() => maskEmailAddress("not-an-email")).toThrow("Invalid email address");
  });
});
