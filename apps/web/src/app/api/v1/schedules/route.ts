import {
  handleCreateScheduleRequest,
  handleListSchedulesRequest,
} from "@/server/saved-search-route-handlers";
import { getSavedSearchRouteDependencies } from "@/server/saved-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleListSchedulesRequest(request, getSavedSearchRouteDependencies());
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateScheduleRequest(request, getSavedSearchRouteDependencies());
}
