export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function toIsoInstant(clock: Clock): string {
  return clock.now().toISOString();
}
