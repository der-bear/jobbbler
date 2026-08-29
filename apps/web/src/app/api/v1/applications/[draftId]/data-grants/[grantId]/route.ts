import { handleWithdrawDataGrantRequest } from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: {
    readonly params: Promise<{ readonly draftId: string; readonly grantId: string }>;
  },
): Promise<Response> {
  return handleWithdrawDataGrantRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
