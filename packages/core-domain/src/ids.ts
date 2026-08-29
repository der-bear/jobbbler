const PREFIX_PATTERN = /^[a-z][a-z0-9_]{0,30}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EntityId<TPrefix extends string = string> = `${TPrefix}_${string}`;
export type UuidFactory = () => string;

function defaultUuidFactory(): string {
  return globalThis.crypto.randomUUID();
}

export function createEntityId<TPrefix extends string>(
  prefix: TPrefix,
  uuidFactory: UuidFactory = defaultUuidFactory,
): EntityId<TPrefix> {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new TypeError("Entity ID prefix must be lowercase snake case.");
  }

  const uuid = uuidFactory();
  if (!UUID_PATTERN.test(uuid)) {
    throw new TypeError("Entity ID UUID source returned an invalid UUID.");
  }

  return `${prefix}_${uuid.toLowerCase()}` as EntityId<TPrefix>;
}

export function isEntityId<TPrefix extends string>(
  value: unknown,
  prefix?: TPrefix,
): value is EntityId<TPrefix> {
  if (typeof value !== "string") return false;

  const separator = value.lastIndexOf("_");
  if (separator <= 0) return false;

  const actualPrefix = value.slice(0, separator);
  const uuid = value.slice(separator + 1);

  return (
    PREFIX_PATTERN.test(actualPrefix) &&
    UUID_PATTERN.test(uuid) &&
    (prefix === undefined || actualPrefix === prefix)
  );
}
