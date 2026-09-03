import {
  handleDiscardApplication,
  handleGetApplication,
  handleSubmitApplication,
} from "@/server/application-route-handlers";
import { getApplicationRouteDependencies } from "@/server/applications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<Response> {
  return handleGetApplication(request, context, getApplicationRouteDependencies());
}
export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<Response> {
  return handleSubmitApplication(request, context, getApplicationRouteDependencies());
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<Response> {
  return handleDiscardApplication(request, context, getApplicationRouteDependencies());
}
