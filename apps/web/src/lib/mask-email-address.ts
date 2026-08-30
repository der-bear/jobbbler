import { DomainError } from "@jobbbler/core-domain";

export function maskEmailAddress(normalized: string): string {
  const separator = normalized.lastIndexOf("@");
  if (separator < 1 || separator === normalized.length - 1) {
    throw new DomainError({ code: "VALIDATION", message: "Invalid email address." });
  }
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 5))}@${domain}`;
}
