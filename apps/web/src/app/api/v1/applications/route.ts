import { handleStartApplication } from "@/server/application-route-handlers";
import { getApplicationRouteDependencies } from "@/server/applications";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{ return handleStartApplication(request,getApplicationRouteDependencies()); }
