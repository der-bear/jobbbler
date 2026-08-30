const referenceLocations = [
  "Remote",
  "Worldwide",
  "Global",
  "Africa",
  "Americas",
  "APAC",
  "Asia",
  "Asia-Pacific",
  "Central Asia",
  "Central and Eastern Europe",
  "DACH",
  "EMEA",
  "Europe",
  "European Union",
  "Latin America",
  "Middle East",
  "North America",
  "Nordics",
  "Oceania",
  "Southeast Asia",
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Bulgaria",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Croatia",
  "Czechia",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "India",
  "Indonesia",
  "Ireland",
  "Israel",
  "Italy",
  "Japan",
  "Kenya",
  "Latvia",
  "Lithuania",
  "Malaysia",
  "Mexico",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "Norway",
  "Poland",
  "Philippines",
  "Portugal",
  "Romania",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Taiwan",
  "Thailand",
  "T\u00fcrkiye",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Amsterdam, Netherlands",
  "Atlanta, GA",
  "Austin, TX",
  "Bangkok, Thailand",
  "Barcelona, Spain",
  "Beijing, China",
  "Bengaluru, India",
  "Berlin, Germany",
  "Boston, MA",
  "Bucharest, Romania",
  "Budapest, Hungary",
  "Cape Town, South Africa",
  "Chicago, IL",
  "Copenhagen, Denmark",
  "Dallas, TX",
  "Denver, CO",
  "Dubai, United Arab Emirates",
  "Dublin, Ireland",
  "Helsinki, Finland",
  "Hong Kong",
  "Jakarta, Indonesia",
  "Kyiv, Ukraine",
  "Lagos, Nigeria",
  "Lisbon, Portugal",
  "London, United Kingdom",
  "Los Angeles, CA",
  "Madrid, Spain",
  "Manila, Philippines",
  "Melbourne, Australia",
  "Mexico City, Mexico",
  "Miami, FL",
  "Montr\u00e9al, Canada",
  "Munich, Germany",
  "Nairobi, Kenya",
  "New York, NY",
  "Oslo, Norway",
  "Paris, France",
  "Phoenix, AZ",
  "Prague, Czechia",
  "Raleigh, NC",
  "San Diego, CA",
  "San Francisco, CA",
  "S\u00e3o Paulo, Brazil",
  "Seattle, WA",
  "Seoul, South Korea",
  "Shanghai, China",
  "Stockholm, Sweden",
  "Sydney, Australia",
  "Taipei, Taiwan",
  "Tallinn, Estonia",
  "Tel Aviv, Israel",
  "Tokyo, Japan",
  "Toronto, Canada",
  "Vancouver, Canada",
  "Vienna, Austria",
  "Warsaw, Poland",
  "Washington, DC",
  "Z\u00fcrich, Switzerland",
] as const;

function normalizedLocation(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
}

function matchPriority(location: string, query: string): number {
  if (location === query) return 0;
  if (location.startsWith(query)) return 1;
  if (location.split(/[^\p{Letter}\p{Number}]+/u).some((word) => word.startsWith(query))) return 2;
  return 3;
}

export function referenceLocationSuggestions(query: string, limit: number): readonly string[] {
  const normalizedQuery = normalizedLocation(query).slice(0, 120);
  if (normalizedQuery.length === 0) return [];
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));

  return referenceLocations
    .map((value, index) => ({ index, normalized: normalizedLocation(value), value }))
    .filter(({ normalized }) => normalized.includes(normalizedQuery))
    .sort(
      (left, right) =>
        matchPriority(left.normalized, normalizedQuery) -
          matchPriority(right.normalized, normalizedQuery) || left.index - right.index,
    )
    .slice(0, safeLimit)
    .map(({ value }) => value);
}

export function mergeLocationSuggestions(
  catalogLocations: readonly string[],
  referenceSuggestions: readonly string[],
  limit: number,
): readonly string[] {
  const safeLimit = Math.min(20, Math.max(1, Math.trunc(limit)));
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const candidate of [...catalogLocations, ...referenceSuggestions]) {
    const value = candidate.trim();
    const key = normalizedLocation(value);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
    if (merged.length === safeLimit) break;
  }
  return merged;
}
