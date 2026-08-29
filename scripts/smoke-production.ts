interface SmokeInput {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly expectProductionSecurity?: boolean;
}

export interface SmokeSummary {
  readonly baseUrl: string;
  readonly driver: "sqlite" | "postgres";
  readonly migrations: number;
  readonly jobs: number;
  readonly searchResults: number;
}

interface SuccessEnvelope {
  readonly ok: true;
  readonly data: Record<string, unknown>;
}

interface ErrorEnvelope {
  readonly ok: false;
  readonly error: Record<string, unknown>;
}

type Envelope = SuccessEnvelope | ErrorEnvelope;

export function normalizeSmokeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Smoke base URL must be a credential-free HTTP(S) URL.");
  }
  return url.origin;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid object.`);
  }
  return value as Record<string, unknown>;
}

async function responseText(response: Response, label: string): Promise<string> {
  const body = await response.text();
  if (body.length > 1_000_000) throw new Error(`${label} response exceeded the smoke limit.`);
  return body;
}

async function jsonEnvelope(response: Response, label: string): Promise<Envelope> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error(`${label} did not return JSON.`);
  }
  const parsed = record(JSON.parse(await responseText(response, label)) as unknown, label);
  if (parsed["ok"] === true) return { ok: true, data: record(parsed["data"], label) };
  if (parsed["ok"] === false) return { ok: false, error: record(parsed["error"], label) };
  throw new Error(`${label} returned an invalid API envelope.`);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} did not report a positive integer.`);
  }
  return value as number;
}

function request(fetchImpl: typeof fetch, url: string): Promise<Response> {
  return fetchImpl(url, {
    headers: { accept: "application/json, text/html;q=0.9" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

function assertProductionHeaders(response: Response): void {
  const required: Readonly<Record<string, string>> = {
    "content-security-policy": "default-src 'self'",
    "strict-transport-security": "max-age=",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
  for (const [name, expected] of Object.entries(required)) {
    if (!(response.headers.get(name) ?? "").includes(expected)) {
      throw new Error(`Homepage is missing the production ${name} policy.`);
    }
  }
}

export async function runProductionSmoke(input: SmokeInput): Promise<SmokeSummary> {
  const baseUrl = normalizeSmokeBaseUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;

  const homepage = await request(fetchImpl, `${baseUrl}/`);
  if (!homepage.ok || !(homepage.headers.get("content-type") ?? "").startsWith("text/html")) {
    throw new Error("Homepage is not publicly available as HTML.");
  }
  const homepageBody = await responseText(homepage, "Homepage");
  if (!homepageBody.includes("Jobbbler")) throw new Error("Homepage does not identify Jobbbler.");
  if (input.expectProductionSecurity === true) assertProductionHeaders(homepage);

  const liveResponse = await request(fetchImpl, `${baseUrl}/api/health/live`);
  const live = await jsonEnvelope(liveResponse, "Liveness");
  if (!liveResponse.ok || !live.ok || live.data["status"] !== "live") {
    throw new Error("Liveness check failed.");
  }

  const readyResponse = await request(fetchImpl, `${baseUrl}/api/health/ready`);
  const ready = await jsonEnvelope(readyResponse, "Readiness");
  if (!readyResponse.ok || !ready.ok || ready.data["status"] !== "ready") {
    throw new Error("Readiness check failed.");
  }
  const driver = ready.data["driver"];
  if (driver !== "sqlite" && driver !== "postgres") {
    throw new Error("Readiness reported an unsupported storage driver.");
  }
  const migrations = positiveInteger(ready.data["migrations"], "Readiness migrations");
  const jobs = positiveInteger(ready.data["jobs"], "Readiness populated catalog");
  positiveInteger(ready.data["organizations"], "Readiness organizations");

  const searchResponse = await request(
    fetchImpl,
    `${baseUrl}/api/v1/jobs/search?query=TypeScript&limit=3`,
  );
  const search = await jsonEnvelope(searchResponse, "Discovery");
  if (!searchResponse.ok || !search.ok || !Array.isArray(search.data["jobs"])) {
    throw new Error("Public discovery check failed.");
  }
  const searchResults = search.data["jobs"].length;
  if (searchResults < 1 || searchResults > 3) {
    throw new Error("Public discovery did not return the bounded seeded fixture.");
  }

  const privateResponse = await request(fetchImpl, `${baseUrl}/api/v1/owners/activity`);
  const privateBoundary = await jsonEnvelope(privateResponse, "Private activity boundary");
  if (
    privateResponse.status !== 401 ||
    privateBoundary.ok ||
    privateBoundary.error["code"] !== "UNAUTHORIZED" ||
    privateResponse.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error("Private activity did not enforce the unauthenticated boundary.");
  }

  return { baseUrl, driver, migrations, jobs, searchResults };
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  const baseUrl = option("--base-url") ?? process.env["PUBLIC_BASE_URL"];
  if (baseUrl === undefined) throw new Error("Pass --base-url or set PUBLIC_BASE_URL.");
  runProductionSmoke({
    baseUrl,
    expectProductionSecurity: !process.argv.includes("--allow-development-security"),
  }).then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`));
}
