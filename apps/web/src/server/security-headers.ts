type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const originTrialTokenPattern = /^[A-Za-z0-9+/_=-]{32,4096}$/u;

function webMcpOriginTrialToken(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!originTrialTokenPattern.test(value)) {
    throw new Error("WEBMCP_ORIGIN_TRIAL_TOKEN must be one unmodified Chrome origin-trial token.");
  }
  return value;
}

function realtimeConnectSources(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return [];
    }
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

function productionContentSecurityPolicy(environment: RuntimeEnvironment): string {
  const connectSources = [
    "'self'",
    ...realtimeConnectSources(environment["NEXT_PUBLIC_SUPABASE_URL"]),
  ];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(
  environment: RuntimeEnvironment = process.env,
): Record<string, string> {
  const originTrialToken = webMcpOriginTrialToken(environment["WEBMCP_ORIGIN_TRIAL_TOKEN"]);
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), tools=(self)",
  };
  if (originTrialToken !== undefined) headers["Origin-Trial"] = originTrialToken;
  if (environment["NODE_ENV"] === "production") {
    headers["Content-Security-Policy"] = productionContentSecurityPolicy(environment);
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }
  return headers;
}
