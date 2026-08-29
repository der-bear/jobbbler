const maximumTokens = 32;

export function toFts5Query(value: string): string | null {
  const tokens = value
    .normalize("NFKC")
    .trim()
    .split(/\s+/u)
    .map((token) => token.replaceAll('"', '""').trim())
    .filter((token) => token.length > 0)
    .slice(0, maximumTokens);

  return tokens.length === 0 ? null : tokens.map((token) => `"${token}"`).join(" AND ");
}
