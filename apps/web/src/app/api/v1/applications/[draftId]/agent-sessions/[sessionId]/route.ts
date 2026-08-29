import { handleRevokeAgentSessionRequest } from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: {
    readonly params: Promise<{ readonly draftId: string; readonly sessionId: string }>;
  },
): Promise<Response> {
  return handleRevokeAgentSessionRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
