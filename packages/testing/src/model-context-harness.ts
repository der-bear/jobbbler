export interface FakeBrowserTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: Readonly<{
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  }>;
  execute(input: unknown, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface FakeRegistration {
  readonly tool: FakeBrowserTool;
  readonly signal: AbortSignal;
}

export class FakeModelContext {
  readonly registrations: FakeRegistration[] = [];
  readonly abortedToolNames: string[] = [];
  failWhenName: string | null = null;

  async registerTool(
    tool: FakeBrowserTool,
    options: { readonly signal: AbortSignal },
  ): Promise<void> {
    if (this.failWhenName === tool.name) throw new Error(`Registration rejected: ${tool.name}`);
    if (options.signal.aborted) throw new DOMException("Registration aborted.", "AbortError");

    this.registrations.push({ tool, signal: options.signal });
    options.signal.addEventListener(
      "abort",
      () => {
        this.abortedToolNames.push(tool.name);
      },
      { once: true },
    );
  }
}
