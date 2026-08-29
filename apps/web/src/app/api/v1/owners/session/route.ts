import {
  handleCreateOwnerSessionRequest,
  handleGetOwnerSessionRequest,
} from "@/server/identity-route-handlers";
import { getIdentityRouteDependencies } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleGetOwnerSessionRequest(request, getIdentityRouteDependencies());
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateOwnerSessionRequest(request, getIdentityRouteDependencies());
}
