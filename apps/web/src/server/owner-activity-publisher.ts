import { ownerActivityEventSchema, type OwnerActivityEvent } from "@jobbbler/contracts";
import { createEntityId } from "@jobbbler/core-domain";
import type { OwnerActivityRepository } from "@jobbbler/storage";

import { logger, safeLogError } from "./logger";

type ActivityPayload = Omit<OwnerActivityEvent, "id" | "schemaVersion"> & {
  readonly ownerId: string;
};

export interface OwnerActivityPublisher {
  publish(input: ActivityPayload): Promise<boolean>;
}

export function createOwnerActivityPublisher(
  repository: Pick<OwnerActivityRepository, "append">,
  options: Readonly<{
    id?: () => string;
    onFailure?: (error: ReturnType<typeof safeLogError>) => void;
  }> = {},
): OwnerActivityPublisher {
  const id = options.id ?? (() => createEntityId("activity"));
  const onFailure =
    options.onFailure ??
    ((error: ReturnType<typeof safeLogError>) => {
      logger.warn(error, "Committed owner activity projection failed");
    });

  return {
    async publish({ ownerId, ...payload }) {
      try {
        const event = ownerActivityEventSchema.parse({
          id: id(),
          schemaVersion: 1,
          ...payload,
        });
        await repository.append({ ownerId, event });
        return true;
      } catch (error) {
        onFailure(safeLogError(error));
        return false;
      }
    },
  };
}
