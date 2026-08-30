import { DomainError } from "./errors.js";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function configurationError(message: string): never {
  throw new DomainError({ code: "DEPENDENCY", message });
}

export function resolvePublicOrigin(environment: RuntimeEnvironment): string {
  const production = environment["NODE_ENV"] === "production";
  const configured =
    environment["PUBLIC_BASE_URL"] ?? (production ? undefined : "http://localhost:3000");
  if (configured === undefined) {
    return configurationError("PUBLIC_BASE_URL is required in production.");
  }

  try {
    const url = new URL(configured);
    if (
      (production && url.protocol !== "https:") ||
      (!production && url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return configurationError(
        production
          ? "PUBLIC_BASE_URL must be a clean HTTPS origin in production."
          : "PUBLIC_BASE_URL must be a clean HTTP or HTTPS origin.",
      );
    }
    return url.origin;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return configurationError("PUBLIC_BASE_URL must be a valid public origin.");
  }
}

export function jobbblerUserAgent(environment: RuntimeEnvironment, contactPath = ""): string {
  const origin = resolvePublicOrigin(environment);
  if (contactPath !== "" && (!contactPath.startsWith("/") || contactPath.includes("?"))) {
    return configurationError("The user-agent contact path must be an absolute clean path.");
  }
  return `Jobbbler/0.1 (+${origin}${contactPath})`;
}
