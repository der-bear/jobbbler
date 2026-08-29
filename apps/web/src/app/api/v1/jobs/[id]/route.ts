import { handleJobDetailRequest, type JobDetailRouteContext } from "@/server/job-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  routeContext: JobDetailRouteContext,
): Promise<Response> {
  return handleJobDetailRequest(request, routeContext);
}
