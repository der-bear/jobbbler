export type Result<TValue, TError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError>(error: TError): Result<never, TError> {
  return { ok: false, error };
}

export function mapResult<TValue, TNext, TError>(
  result: Result<TValue, TError>,
  mapper: (value: TValue) => TNext,
): Result<TNext, TError> {
  return result.ok ? ok(mapper(result.value)) : result;
}

export function flatMapResult<TValue, TNext, TError, TNextError>(
  result: Result<TValue, TError>,
  mapper: (value: TValue) => Result<TNext, TNextError>,
): Result<TNext, TError | TNextError> {
  return result.ok ? mapper(result.value) : result;
}
