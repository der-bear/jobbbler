import { entityIdSchema, jobIdSchema } from "@jobbbler/contracts";

export type WebMcpRoute =
  | { readonly kind: "search" }
  | { readonly kind: "detail"; readonly jobId: string }
  | { readonly kind: "compare" }
  | { readonly kind: "saved" }
  | { readonly kind: "application"; readonly draftId: string }
  | { readonly kind: "none" };

export function resolveWebMcpRoute(pathname: string): WebMcpRoute {
  if (pathname === "/") return { kind: "search" };
  if (pathname === "/compare") return { kind: "compare" };
  if (pathname === "/saved") return { kind: "saved" };

  const applicationMatch = /^\/apply\/([^/]+)$/u.exec(pathname);
  if (applicationMatch !== null) {
    try {
      const draftId = entityIdSchema.safeParse(decodeURIComponent(applicationMatch[1] ?? ""));
      return draftId.success ? { kind: "application", draftId: draftId.data } : { kind: "none" };
    } catch {
      return { kind: "none" };
    }
  }

  const match = /^\/jobs\/([^/]+)$/u.exec(pathname);
  if (match === null) return { kind: "none" };

  try {
    const jobId = jobIdSchema.safeParse(decodeURIComponent(match[1] ?? ""));
    return jobId.success ? { kind: "detail", jobId: jobId.data } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}
