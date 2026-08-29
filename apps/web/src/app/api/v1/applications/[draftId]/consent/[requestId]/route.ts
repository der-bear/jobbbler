import { handleDecideSubmissionReviewRequest } from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    readonly params: Promise<{ readonly draftId: string; readonly requestId: string }>;
  },
): Promise<Response> {
  return handleDecideSubmissionReviewRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
