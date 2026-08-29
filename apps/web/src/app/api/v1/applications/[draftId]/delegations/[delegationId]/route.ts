import { handleRevokeDelegationRequest } from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: {
    readonly params: Promise<{ readonly draftId: string; readonly delegationId: string }>;
  },
): Promise<Response> {
  return handleRevokeDelegationRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
