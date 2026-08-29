export type SearchDeltaKind = "new" | "updated" | "closed" | "no_longer_matching";

export interface SearchBaselineItem {
  readonly jobId: string;
  readonly fingerprint: string;
}

export interface CurrentSearchItem extends SearchBaselineItem {
  readonly state: "matching" | "closed" | "no_longer_matching";
}

export interface SearchDelta {
  readonly jobId: string;
  readonly kind: SearchDeltaKind;
}

export interface CalculateSearchDeltasInput {
  readonly previous: readonly SearchBaselineItem[] | null;
  readonly current: readonly CurrentSearchItem[];
  readonly notifyOnNoChanges?: boolean;
}

export interface SearchDeltaResult {
  readonly deltas: readonly SearchDelta[];
  readonly shouldNotify: boolean;
}

const deltaOrder: Record<SearchDeltaKind, number> = {
  new: 0,
  updated: 1,
  closed: 2,
  no_longer_matching: 3,
};

function uniqueByJobId<T extends { readonly jobId: string }>(items: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const item of items) {
    if (indexed.has(item.jobId)) throw new TypeError(`Found duplicate job ID: ${item.jobId}`);
    indexed.set(item.jobId, item);
  }
  return indexed;
}

export function calculateSearchDeltas(input: CalculateSearchDeltasInput): SearchDeltaResult {
  uniqueByJobId(input.current);
  if (input.previous === null) {
    return { deltas: [], shouldNotify: input.notifyOnNoChanges === true };
  }

  const previous = uniqueByJobId(input.previous);
  const deltas: SearchDelta[] = [];
  for (const item of input.current) {
    const before = previous.get(item.jobId);
    if (item.state === "matching" && before === undefined) {
      deltas.push({ jobId: item.jobId, kind: "new" });
    } else if (
      item.state === "matching" &&
      before !== undefined &&
      before.fingerprint !== item.fingerprint
    ) {
      deltas.push({ jobId: item.jobId, kind: "updated" });
    } else if (item.state === "closed" && before !== undefined) {
      deltas.push({ jobId: item.jobId, kind: "closed" });
    } else if (item.state === "no_longer_matching" && before !== undefined) {
      deltas.push({ jobId: item.jobId, kind: "no_longer_matching" });
    }
  }
  deltas.sort(
    (left, right) =>
      deltaOrder[left.kind] - deltaOrder[right.kind] || left.jobId.localeCompare(right.jobId),
  );
  return { deltas, shouldNotify: deltas.length > 0 || input.notifyOnNoChanges === true };
}
