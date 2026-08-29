import { handleSearchRequest } from "@/server/job-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleSearchRequest(request);
}
