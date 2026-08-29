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
