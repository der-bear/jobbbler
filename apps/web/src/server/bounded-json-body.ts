import { DomainError } from "@jobbbler/core-domain";

interface BoundedJsonBodyOptions {
  readonly maxBytes: number;
  readonly emptyMessage: string;
}

export async function readBoundedJsonBody(
  request: Request,
  options: BoundedJsonBodyOptions,
): Promise<unknown> {
  const declaredHeader = request.headers.get("content-length");
  const declaredLength = declaredHeader === null ? null : Number(declaredHeader);
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > options.maxBytes)
  ) {
    throw new DomainError({ code: "VALIDATION", message: "The request body is too large." });
  }
  if (request.body === null) {
    throw new DomainError({ code: "VALIDATION", message: options.emptyMessage });
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DomainError({ code: "VALIDATION", message: "The request body is too large." });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) {
    throw new DomainError({ code: "VALIDATION", message: options.emptyMessage });
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new DomainError({ code: "VALIDATION", message: "Expected a JSON request body.", cause });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new DomainError({ code: "VALIDATION", message: "Expected a JSON request body.", cause });
  }
}
