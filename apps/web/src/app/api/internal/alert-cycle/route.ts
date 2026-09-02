import { safeWorkerLogError } from "@jobbbler/worker";

import { createAlertCyclePostHandler, runProductionAlertCycle } from "@/server/alert-cycle";

export const runtime = "nodejs";
export const maxDuration = 60;

const post = createAlertCyclePostHandler({
  environment: process.env,
  async run(input) {
    try {
      return await runProductionAlertCycle(input);
    } catch (error) {
      console.error("Alert cycle failed", safeWorkerLogError(error));
      throw error;
    }
  },
});

export async function POST(request: Request): Promise<Response> {
  return post(request);
}
