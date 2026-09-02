import { DomainError, resolvePublicOrigin } from "@jobbbler/core-domain";

import { configuredDatabaseUrl } from "./database-url";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface RuntimeConfigurationSummary {
  readonly environment: "development" | "production";
  readonly publicOrigin: string;
  readonly databaseDriver: "sqlite" | "postgres";
  readonly notificationDriver: "capture" | "resend";
  readonly trustedProxy: boolean;
}

function configurationError(message: string): never {
  throw new DomainError({ code: "DEPENDENCY", message });
}

function databaseDriver(
  environment: RuntimeEnvironment,
  production: boolean,
): "sqlite" | "postgres" {
  const configured = configuredDatabaseUrl(environment);
  if (configured === undefined || configured.length === 0) {
    if (production) {
      configurationError("Production requires a PostgreSQL DATABASE_URL or POSTGRES_URL.");
    }
    return "sqlite";
  }
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      url.hostname.length === 0 ||
      url.pathname.length < 2
    ) {
      configurationError("The configured database URL must identify a PostgreSQL database.");
    }
    return "postgres";
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return configurationError("The configured database URL must identify a PostgreSQL database.");
  }
}

function requireSecret(environment: RuntimeEnvironment, name: string): void {
  const value = environment[name];
  if (value === undefined || value.length < 32) {
    configurationError(`${name} must contain at least 32 characters in production.`);
  }
}

function notificationDriver(
  environment: RuntimeEnvironment,
  production: boolean,
): "capture" | "resend" {
  const driver = environment["NOTIFICATION_DRIVER"] ?? "capture";
  if (!production && driver === "capture") return "capture";
  if (driver !== "resend") {
    configurationError("Production notification delivery must use Resend.");
  }
  const apiKey = environment["RESEND_API_KEY"];
  if (apiKey === undefined || !apiKey.startsWith("re_") || apiKey.length < 12) {
    configurationError("A valid server-only Resend API key is required in production.");
  }
  const sender = environment["EMAIL_FROM"];
  if (
    sender === undefined ||
    sender.length < 3 ||
    sender.length > 320 ||
    !sender.includes("@") ||
    /[\r\n]/u.test(sender)
  ) {
    configurationError("EMAIL_FROM must be a bounded verified sender address.");
  }
  return "resend";
}

export function validateRuntimeConfiguration(
  environment: RuntimeEnvironment = process.env,
): RuntimeConfigurationSummary {
  const production = environment["NODE_ENV"] === "production";
  const trustedProxy = environment["TRUST_PROXY_HEADERS"] === "true";
  if (production) {
    if (!trustedProxy) {
      configurationError("Production rate limits require a trusted proxy boundary.");
    }
    if (environment["ALLOW_LOCAL_OTP_CAPTURE"] === "true") {
      configurationError("Production must not expose local OTP capture.");
    }
    requireSecret(environment, "TOKEN_HASH_SECRET");
    requireSecret(environment, "PII_ENCRYPTION_KEY");
  }

  return {
    environment: production ? "production" : "development",
    publicOrigin: resolvePublicOrigin(environment),
    databaseDriver: databaseDriver(environment, production),
    notificationDriver: notificationDriver(environment, production),
    trustedProxy,
  };
}
