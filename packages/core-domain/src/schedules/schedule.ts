export type ScheduleWeekday =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type ScheduleRecurrence =
  | {
      readonly frequency: "daily";
      readonly time: string;
      readonly timeZone: string;
    }
  | {
      readonly frequency: "weekly";
      readonly time: string;
      readonly timeZone: string;
      readonly days: readonly ScheduleWeekday[];
    };

export interface ScheduleState {
  readonly status: "active" | "paused";
  readonly nextRunAt: string | null;
  readonly version: number;
}

interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const weekdayNumbers: Record<ScheduleWeekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    const created = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "iso8601",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    created.format(new Date(0));
    formatters.set(timeZone, created);
    return created;
  } catch {
    throw new TypeError("Expected a valid IANA time zone.");
  }
}

function localDateTime(instant: number, timeZone: string): LocalDateTime {
  const fields = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: fields["year"]!,
    month: fields["month"]!,
    day: fields["day"]!,
    hour: fields["hour"]!,
    minute: fields["minute"]!,
  };
}

function compareLocal(left: LocalDateTime, right: LocalDateTime): number {
  for (const key of ["year", "month", "day", "hour", "minute"] as const) {
    const difference = left[key] - right[key];
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseTime(time: string): Pick<LocalDateTime, "hour" | "minute"> {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(time);
  if (match === null) throw new TypeError("Expected time in HH:mm format.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function addDays(date: Pick<LocalDateTime, "year" | "month" | "day">, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function weekday(date: Pick<LocalDateTime, "year" | "month" | "day">): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function offsetAt(instant: number, timeZone: string): number {
  const local = localDateTime(instant, timeZone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instant;
}

function knownOffsets(naiveInstant: number, timeZone: string): readonly number[] {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    offsets.add(offsetAt(naiveInstant + hours * 60 * 60 * 1_000, timeZone));
  }
  return [...offsets];
}

function resolveLocalDateTime(target: LocalDateTime, timeZone: string): number {
  const naive = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const candidates = knownOffsets(naive, timeZone)
    .map((offset) => naive - offset)
    .map((instant) => ({ instant, local: localDateTime(instant, timeZone) }));
  const exact = candidates
    .filter((candidate) => compareLocal(candidate.local, target) === 0)
    .sort((left, right) => left.instant - right.instant);
  if (exact.length > 0) return exact[0]!.instant;

  const nextValid = candidates
    .filter((candidate) => compareLocal(candidate.local, target) > 0)
    .sort((left, right) => left.instant - right.instant);
  if (nextValid.length === 0) {
    throw new RangeError("Could not resolve the next valid local schedule time.");
  }
  return nextValid[0]!.instant;
}

function isScheduledDate(
  recurrence: ScheduleRecurrence,
  date: Pick<LocalDateTime, "year" | "month" | "day">,
): boolean {
  if (recurrence.frequency === "daily") return true;
  return recurrence.days.some((day) => weekdayNumbers[day] === weekday(date));
}

function validVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError("Schedule version must be a non-negative integer.");
  }
}

export function calculateNextRun(recurrence: ScheduleRecurrence, after: string): string {
  const afterInstant = Date.parse(after);
  if (Number.isNaN(afterInstant)) throw new TypeError("Expected a valid ISO instant.");
  const time = parseTime(recurrence.time);
  const localAfter = localDateTime(afterInstant, recurrence.timeZone);

  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addDays(localAfter, offset);
    if (!isScheduledDate(recurrence, date)) continue;
    const candidate = resolveLocalDateTime({ ...date, ...time }, recurrence.timeZone);
    if (candidate > afterInstant) return new Date(candidate).toISOString();
  }
  throw new RangeError("Could not calculate a next run within one recurrence week.");
}

export function deriveEvaluationJitterSeconds(identity: string, maximumSeconds: number): number {
  if (!Number.isSafeInteger(maximumSeconds) || maximumSeconds < 0) {
    throw new TypeError("Maximum jitter seconds must be a non-negative integer.");
  }
  let hash = 2_166_136_261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0) % (maximumSeconds + 1);
}

export function pauseSchedule(schedule: ScheduleState): ScheduleState {
  validVersion(schedule.version);
  if (schedule.status === "paused") return schedule;
  return { status: "paused", nextRunAt: null, version: schedule.version + 1 };
}

export function resumeSchedule(
  schedule: ScheduleState,
  recurrence: ScheduleRecurrence,
  resumedAt: string,
): ScheduleState {
  validVersion(schedule.version);
  if (schedule.status === "active") return schedule;
  return {
    status: "active",
    nextRunAt: calculateNextRun(recurrence, resumedAt),
    version: schedule.version + 1,
  };
}
