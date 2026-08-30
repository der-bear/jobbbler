import type { ApplicationToolDependencies } from "./webmcp-tools";

type Listener = () => void;

let currentSurface: ApplicationToolDependencies | null = null;
const listeners = new Set<Listener>();

export function publishApplicationWebMcpSurface(surface: ApplicationToolDependencies | null): void {
  currentSurface = surface;
  listeners.forEach((listener) => listener());
}

export function readApplicationWebMcpSurface(): ApplicationToolDependencies | null {
  return currentSurface;
}

export function subscribeApplicationWebMcpSurface(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function waitForApplicationWebMcpSurface(
  draftId: string,
  signal: AbortSignal,
  timeoutMilliseconds = 4_000,
): Promise<ApplicationToolDependencies | null> {
  const available = readApplicationWebMcpSurface();
  if (available?.currentReadiness().state.draftId === draftId) return Promise.resolve(available);
  if (signal.aborted) return Promise.reject(new DOMException("Cancelled.", "AbortError"));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      listeners.delete(onSurfaceChange);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (surface: ApplicationToolDependencies | null) => {
      cleanup();
      resolve(surface);
    };
    const onSurfaceChange = () => {
      const surface = readApplicationWebMcpSurface();
      if (surface?.currentReadiness().state.draftId === draftId) finish(surface);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Cancelled.", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => finish(null), timeoutMilliseconds);
    listeners.add(onSurfaceChange);
    signal.addEventListener("abort", onAbort, { once: true });
    onSurfaceChange();
  });
}
