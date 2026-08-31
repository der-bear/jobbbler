export type WebMcpNavigate = (
  href: string,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<void> | void;

function cancellationError(): DOMException {
  return new DOMException("Navigation cancelled.", "AbortError");
}

export function createWebMcpNavigator(
  options: Readonly<{
    navigate(href: string): Promise<void> | void;
    currentUrl?: () => string;
    pollIntervalMilliseconds?: number;
    timeoutMilliseconds?: number;
  }>,
): WebMcpNavigate {
  const currentUrl = options.currentUrl ?? (() => window.location.href);
  const pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 16;
  // A cold client-side route may compile before it commits in local previews,
  // and browser-agent hosts can briefly pause the page while refreshing the
  // global tool registry. Keep the transition bounded without turning either
  // condition into a false tool failure.
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 12_000;

  return async (href, { signal }) => {
    if (signal.aborted) throw cancellationError();
    const destination = new URL(href, currentUrl()).href;
    await options.navigate(href);
    if (signal.aborted) throw cancellationError();
    if (new URL(currentUrl(), destination).href === destination) return;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        globalThis.clearInterval(pollTimer);
        globalThis.clearTimeout(timeoutTimer);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(cancellationError());
      };
      const pollTimer = globalThis.setInterval(() => {
        if (new URL(currentUrl(), destination).href === destination) finish();
      }, pollIntervalMilliseconds);
      const timeoutTimer = globalThis.setTimeout(() => {
        cleanup();
        reject(new Error(`Navigation did not reach ${destination}.`));
      }, timeoutMilliseconds);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };
}
