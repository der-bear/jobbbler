/**
 * The owner session cookie is HttpOnly, so the browser cannot read it. This
 * marker records that a private workspace has been created in this browser at
 * least once, which lets owner-scoped polling stay silent for first-time
 * visitors instead of provoking an expected 401 on every public page.
 *
 * It is a convenience hint, never an authorization signal: the server still
 * requires the real session for every owner-scoped request.
 */
const STORAGE_KEY = "jobbbler-owner-session";
const EVENT_NAME = "jobbbler:owner-session";
// Keep the browser-only hint bounded by the server's default owner-session
// lifetime. It remains advisory: every request is still authenticated server-side.
const MAX_MARKER_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

interface OwnerSessionMarker {
  readonly expiresAt: number;
}

function markerExpiry(expiresAt?: string): number {
  const maximum = Date.now() + MAX_MARKER_LIFETIME_MS;
  if (expiresAt === undefined) return maximum;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? Math.min(parsed, maximum) : maximum;
}

function readMarker(): OwnerSessionMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const marker: unknown = JSON.parse(stored);
    if (
      typeof marker !== "object" ||
      marker === null ||
      !("expiresAt" in marker) ||
      typeof marker.expiresAt !== "number" ||
      !Number.isFinite(marker.expiresAt) ||
      marker.expiresAt <= Date.now()
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { expiresAt: marker.expiresAt };
  } catch {
    return null;
  }
}

export function markOwnerSessionStarted(expiresAt?: string): void {
  if (typeof window === "undefined") return;
  const expiry = markerExpiry(expiresAt);
  if (expiry <= Date.now()) {
    clearOwnerSessionMarker();
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ expiresAt: expiry }));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The event
    // below still starts polling for the current page.
  }
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function clearOwnerSessionMarker(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; polling still suspends in memory.
  }
}

export function hasOwnerSessionMarker(): boolean {
  return readMarker() !== null;
}

export function subscribeOwnerSessionStarted(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT_NAME, listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && hasOwnerSessionMarker()) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener("storage", onStorage);
  };
}
