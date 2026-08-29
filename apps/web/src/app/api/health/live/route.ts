import { handleLiveHealthRequest } from "@/server/health-route-handlers";

export const runtime = "nodejs";
export async function GET(): Promise<Response> {
  return handleLiveHealthRequest();
}
