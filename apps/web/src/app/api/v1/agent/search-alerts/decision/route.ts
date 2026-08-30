import { handleDecideSearchAlert } from "@/server/search-alert-agent-route-handlers";
import { getSearchAlertAgentRouteDependencies } from "@/server/saved-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleDecideSearchAlert(request, getSearchAlertAgentRouteDependencies());
}
