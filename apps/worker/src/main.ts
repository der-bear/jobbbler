import pino from "pino";

const logger = pino({ name: "jobbbler-worker" });

logger.info({ status: "ready" }, "Worker foundation initialized");
