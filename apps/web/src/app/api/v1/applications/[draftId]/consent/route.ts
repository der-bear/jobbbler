import {
  handleCreateSubmissionReviewRequest,
  handleWithdrawApplicationConsentRequest,
} from "@/server/application-authorization-route-handlers";
import { getApplicationAuthorizationRouteDependencies } from "@/server/application-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
): Promise<Response> {
  return handleCreateSubmissionReviewRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
): Promise<Response> {
  return handleWithdrawApplicationConsentRequest(
    request,
    context,
    getApplicationAuthorizationRouteDependencies(),
  );
}
