import { handleApproveDelegationRequest } from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    readonly params: Promise<{ readonly draftId: string; readonly delegationId: string }>;
  },
): Promise<Response> {
  return handleApproveDelegationRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
