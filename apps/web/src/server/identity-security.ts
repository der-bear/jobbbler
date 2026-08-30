import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

import { DomainError, type EmailProtector, type SecretCodec } from "@jobbbler/core-domain";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const LOCAL_TOKEN_SECRET = "jobbbler-local-token-secret-change-before-production";
const LOCAL_PII_SECRET = "jobbbler-local-pii-secret-change-before-production";
const SECRET_MINIMUM_LENGTH = 32;
const SEARCH_ALERT_OTP_DOMAIN = "jobbbler:search-alert-otp:v1";

function requiredSecret(
  environment: RuntimeEnvironment,
  name: "TOKEN_HASH_SECRET" | "PII_ENCRYPTION_KEY",
  localFallback: string,
): string {
  const configured = environment[name];
  if (configured !== undefined && configured.length >= SECRET_MINIMUM_LENGTH) return configured;
  if (environment["NODE_ENV"] !== "production") return localFallback;
  throw new Error(`${name} must contain at least ${String(SECRET_MINIMUM_LENGTH)} characters.`);
}

function encryptionKey(secret: string): Uint8Array {
  return createHash("sha256").update("jobbbler:email:v1\u0000").update(secret).digest();
}

function maskEmail(normalized: string): string {
  const separator = normalized.lastIndexOf("@");
  if (separator < 1)
    throw new DomainError({ code: "VALIDATION", message: "Invalid email address." });
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 5))}@${domain}`;
}

export interface RevealableEmailProtector extends EmailProtector {
  reveal(ciphertext: string): string;
}

export function createSecretCodec(environment: RuntimeEnvironment = process.env): SecretCodec {
  const secret = requiredSecret(environment, "TOKEN_HASH_SECRET", LOCAL_TOKEN_SECRET);
  return {
    createSessionToken: () => randomBytes(32).toString("base64url"),
    createVerificationCode: () => String(randomInt(0, 1_000_000)).padStart(6, "0"),
    deriveSearchAlertVerificationCode(challengeId) {
      const digest = createHmac("sha256", secret)
        .update(SEARCH_ALERT_OTP_DOMAIN)
        .update("\u0000")
        .update(challengeId)
        .digest();
      return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
    },
    hash: (purpose, value) =>
      createHmac("sha256", secret).update(`jobbbler:${purpose}:v1\u0000${value}`).digest("hex"),
  };
}

export function createEmailProtector(
  environment: RuntimeEnvironment = process.env,
): RevealableEmailProtector {
  const key = encryptionKey(requiredSecret(environment, "PII_ENCRYPTION_KEY", LOCAL_PII_SECRET));
  const addressHashSecret = requiredSecret(environment, "TOKEN_HASH_SECRET", LOCAL_TOKEN_SECRET);
  return {
    protect(rawEmail) {
      const normalized = rawEmail.trim().toLowerCase();
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from("jobbbler:email:v1", "utf8"));
      const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        normalized,
        addressHash: createHmac("sha256", addressHashSecret)
          .update(`jobbbler:email-lookup:v1\u0000${normalized}`)
          .digest("hex"),
        addressCiphertext: [iv, tag, encrypted].map((part) => part.toString("base64url")).join("."),
        maskedAddress: maskEmail(normalized),
      };
    },
    reveal(ciphertext) {
      const parts = ciphertext.split(".");
      if (parts.length !== 3) throw new Error("Invalid protected email envelope.");
      const iv = Buffer.from(parts[0] ?? "", "base64url");
      const tag = Buffer.from(parts[1] ?? "", "base64url");
      const encrypted = Buffer.from(parts[2] ?? "", "base64url");
      if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
        throw new Error("Invalid protected email envelope.");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from("jobbbler:email:v1", "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    },
  };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function sensitiveRateLimitKey(
  scope: string,
  value: string,
  environment: RuntimeEnvironment = process.env,
): string {
  const secret = requiredSecret(environment, "TOKEN_HASH_SECRET", LOCAL_TOKEN_SECRET);
  return createHmac("sha256", secret)
    .update(`jobbbler:rate-limit:${scope}:v1\u0000${value}`)
    .digest("hex");
}

export function canExposeLocalOtp(environment: RuntimeEnvironment = process.env): boolean {
  if (environment["ALLOW_LOCAL_OTP_CAPTURE"] !== "true") return false;
  if (environment["NODE_ENV"] === "test") return true;
  if (environment["NODE_ENV"] !== "development") return false;
  try {
    const hostname = new URL(environment["PUBLIC_BASE_URL"] ?? "http://localhost").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function assertTrustedMutationOrigin(
  request: Request,
  environment: RuntimeEnvironment = process.env,
): void {
  const configured = environment["PUBLIC_BASE_URL"];
  const trustedOrigin =
    configured === undefined ? new URL(request.url).origin : new URL(configured).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== trustedOrigin || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "This action must be initiated from the Jobbbler interface.",
    });
  }
}

export interface OwnerSessionCookie {
  readonly name: "__Host-jobbbler_owner" | "jobbbler_owner";
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: "lax";
    readonly secure: boolean;
    readonly path: "/";
    readonly expires: Date;
    readonly priority: "high";
  };
}

export function ownerSessionCookie(
  rawToken: string,
  expiresAt: string,
  environment: RuntimeEnvironment = process.env,
): OwnerSessionCookie {
  const production = environment["NODE_ENV"] === "production";
  return {
    name: production ? "__Host-jobbbler_owner" : "jobbbler_owner",
    value: rawToken,
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      path: "/",
      expires: new Date(expiresAt),
      priority: "high",
    },
  };
}

export function ownerSessionCookieName(
  environment: RuntimeEnvironment = process.env,
): OwnerSessionCookie["name"] {
  return environment["NODE_ENV"] === "production" ? "__Host-jobbbler_owner" : "jobbbler_owner";
}
