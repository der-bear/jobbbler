import { describe, expect, it } from "vitest";

import { validateRuntimeConfiguration } from "./runtime-configuration";

const productionEnvironment = {
  NODE_ENV: "production",
  PUBLIC_BASE_URL: "https://jobbbler.example",
  DATABASE_URL: "postgresql://jobbbler:secret@db.example/jobbbler",
  TRUST_PROXY_HEADERS: "true",
  TOKEN_HASH_SECRET: "token-hash-secret-that-is-at-least-32-bytes",
  PII_ENCRYPTION_KEY: "pii-encryption-secret-that-is-at-least-32-bytes",
  NOTIFICATION_DRIVER: "resend",
  RESEND_API_KEY: "re_production_secret",
  EMAIL_FROM: "Jobbbler <alerts@jobbbler.example>",
} as const;

describe("runtime configuration", () => {
  it("returns a non-secret production readiness summary", () => {
    const summary = validateRuntimeConfiguration(productionEnvironment);

    expect(summary).toEqual({
      environment: "production",
      publicOrigin: "https://jobbbler.example",
      databaseDriver: "postgres",
      notificationDriver: "resend",
      trustedProxy: true,
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("allows the zero-service local development defaults", () => {
    expect(validateRuntimeConfiguration({ NODE_ENV: "development" })).toEqual({
      environment: "development",
      publicOrigin: "http://localhost:3000",
      databaseDriver: "sqlite",
      notificationDriver: "capture",
      trustedProxy: false,
    });
  });

  it.each([
    ["trusted proxy", { TRUST_PROXY_HEADERS: "false" }],
    ["HTTPS", { PUBLIC_BASE_URL: "http://jobbbler.example" }],
    ["PostgreSQL", { DATABASE_URL: "" }],
    ["TOKEN_HASH_SECRET", { TOKEN_HASH_SECRET: "short" }],
    ["PII_ENCRYPTION_KEY", { PII_ENCRYPTION_KEY: "short" }],
    ["Resend", { NOTIFICATION_DRIVER: "capture" }],
    ["local OTP", { ALLOW_LOCAL_OTP_CAPTURE: "true" }],
  ])("fails closed on unsafe production %s configuration", (_label, override) => {
    expect(() => validateRuntimeConfiguration({ ...productionEnvironment, ...override })).toThrow();
  });

  it("never includes configured secrets in a validation error", () => {
    const exposed = "re_do_not_echo_this_value";
    let message = "";
    try {
      validateRuntimeConfiguration({
        ...productionEnvironment,
        RESEND_API_KEY: exposed,
        EMAIL_FROM: "invalid",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(exposed);
  });
});
