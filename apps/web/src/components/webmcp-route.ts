import { jobIdSchema } from "@jobbbler/contracts";

export type WebMcpRoute =
  | { readonly kind: "search" }
  | { readonly kind: "detail"; readonly jobId: string }
  | { readonly kind: "compare" }
  | { readonly kind: "none" };

export function resolveWebMcpRoute(pathname: string): WebMcpRoute {
  if (pathname === "/") return { kind: "search" };
  if (pathname === "/compare") return { kind: "compare" };

  const match = /^\/jobs\/([^/]+)$/u.exec(pathname);
  if (match === null) return { kind: "none" };

  try {
    const jobId = jobIdSchema.safeParse(decodeURIComponent(match[1] ?? ""));
    return jobId.success ? { kind: "detail", jobId: jobId.data } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}
