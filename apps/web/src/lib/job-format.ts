import type {
  EmploymentType,
  JobCategory,
  SalaryRange,
  Seniority,
  WorkModel,
} from "@jobbbler/contracts";
import {
  annualizeSalaryAmount,
  comparableCurrencies,
  convertSalaryAmount,
} from "@jobbbler/jobs-domain";

const categoryLabels: Readonly<Record<JobCategory, string>> = {
  software_engineering: "Software engineering",
  data_ai: "Data & AI",
  product: "Product",
  design_research: "Design & research",
  security: "Security",
  infrastructure: "Infrastructure",
  quality_assurance: "Quality assurance",
  developer_relations: "Developer relations",
  technical_support_success: "Technical support",
  technical_recruiting: "Technical recruiting",
  tech_operations_sales: "Technology operations",
};

const seniorityLabels: Readonly<Record<Seniority, string>> = {
  entry: "Entry",
  mid: "Mid-level",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  lead: "Lead",
  manager: "Manager",
  director: "Director",
  executive: "Executive",
};

const workModelLabels: Readonly<Record<WorkModel, string>> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  flexible: "Flexible",
};

const employmentLabels: Readonly<Record<EmploymentType, string>> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
};

export const defaultDisplayCurrency = "USD";
const displayCurrencies = new Set(comparableCurrencies);

export function displayCurrencyFromSearch(criteriaSearch: string): string {
  const parameters = new URLSearchParams(
    criteriaSearch.startsWith("?") ? criteriaSearch.slice(1) : criteriaSearch,
  );
  const requested = parameters.get("currency")?.toUpperCase();
  return requested !== undefined && displayCurrencies.has(requested)
    ? requested
    : defaultDisplayCurrency;
}

export function categoryLabel(value: JobCategory): string {
  return categoryLabels[value];
}

export function seniorityLabel(value: Seniority): string {
  return seniorityLabels[value];
}

export function workModelLabel(value: WorkModel): string {
  return workModelLabels[value];
}

export function employmentLabel(value: EmploymentType): string {
  return employmentLabels[value];
}

/*
 * The work-model chip already names remoteness, so a location that repeats it
 * ("Remote - Europe" printed beside a "Remote" chip) is reduced to the part the
 * chip does not carry. A location that says nothing else returns null.
 */
export function locationBesideWorkModel(
  location: string | undefined,
  workModel: WorkModel,
): string | null {
  if (location === undefined) return null;
  const label = workModelLabels[workModel].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const remainder = location.replace(new RegExp(`^${label}\\s*[-–—·,]?\\s*`, "iu"), "").trim();
  return remainder.length > 0 ? remainder : null;
}

function normalizedLocation(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

export function concreteJobLocations(locations: readonly string[]): readonly string[] {
  return locations.filter((location) => location.includes(","));
}

export function locationForSearch(
  locations: readonly string[],
  requestedLocations: readonly string[],
): string | undefined {
  const concreteLocations = concreteJobLocations(locations);
  for (const requested of requestedLocations) {
    const normalizedRequested = normalizedLocation(requested);
    const exact = concreteLocations.find(
      (location) => normalizedLocation(location) === normalizedRequested,
    );
    if (exact !== undefined) return exact;

    const containing = concreteLocations.find((location) => {
      const normalizedActual = normalizedLocation(location);
      return (
        normalizedActual.includes(normalizedRequested) ||
        normalizedRequested.includes(normalizedActual)
      );
    });
    if (containing !== undefined) return containing;
  }
  return concreteLocations[0];
}

/* Full-time is the default every reader assumes, so only deviations are shown. */
export function deviatingEmploymentLabel(value: EmploymentType): string | null {
  return value === "full_time" ? null : employmentLabels[value];
}

/*
 * Employment type is carried by the facts line, so a title that ends by repeating
 * it ("… Monitoring (Part-Time)") sheds the suffix. That parenthetical is also
 * what pushed titles past the truncation boundary on narrow screens.
 */
export function titleWithoutEmploymentSuffix(title: string, value?: EmploymentType): string {
  if (value === "full_time") return title;
  /*
   * The employment type is optional because not every surface carries it: the
   * applications list, for one, holds only the stored title. Without it the
   * suffix is matched against every known label instead, which strips the same
   * parenthetical and keeps one role named one way across the whole product.
   */
  const candidates =
    value === undefined ? Object.values(employmentLabels) : [employmentLabels[value]];
  for (const candidate of candidates) {
    const label = candidate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const stripped = title.replace(new RegExp(`\\s*\\(\\s*${label}\\s*\\)\\s*$`, "iu"), "").trim();
    if (stripped !== title.trim() && stripped.length > 0) return stripped;
  }
  return title;
}

function amount(value: number, currency: string, compact: boolean): string {
  const formatted = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
  return compact ? formatted.replace(/K$/u, "k") : formatted;
}

function salaryPeriodLabel(period: SalaryRange["period"], abbreviated: boolean): string {
  if (period === "year") return abbreviated ? "yr" : "year";
  if (period === "month") return abbreviated ? "mo" : "month";
  return abbreviated ? "hr" : "hour";
}

function formatSalaryRange(
  minimum: number | null,
  maximum: number | null,
  currency: string,
  period: SalaryRange["period"],
  compact: boolean,
): string {
  const periodLabel = salaryPeriodLabel(period, true);
  if (minimum !== null && maximum !== null) {
    return `${amount(minimum, currency, compact)}–${amount(maximum, currency, compact)} / ${periodLabel}`;
  }
  if (minimum !== null) return `From ${amount(minimum, currency, compact)} / ${periodLabel}`;
  if (maximum !== null) return `Up to ${amount(maximum, currency, compact)} / ${periodLabel}`;
  return "Salary not listed";
}

function sourceSalaryLabel(salary: SalaryRange, compact: boolean): string {
  return formatSalaryRange(salary.minimum, salary.maximum, salary.currency, salary.period, compact);
}

function sourceSalaryDescription(salary: SalaryRange): string {
  const period = salaryPeriodLabel(salary.period, false);
  if (salary.minimum !== null && salary.maximum !== null) {
    return `${amount(salary.minimum, salary.currency, false)}–${amount(salary.maximum, salary.currency, false)} per ${period}`;
  }
  if (salary.minimum !== null) {
    return `from ${amount(salary.minimum, salary.currency, false)} per ${period}`;
  }
  if (salary.maximum !== null) {
    return `up to ${amount(salary.maximum, salary.currency, false)} per ${period}`;
  }
  return "compensation without a disclosed amount";
}

export interface SalaryCardPresentation {
  readonly label: string;
  readonly explanation: string | null;
}

export function salaryCardPresentation(
  salary: SalaryRange | null,
  displayCurrency: string,
): SalaryCardPresentation {
  if (salary === null) return { label: "Salary not listed", explanation: null };
  if (salary.minimum === null && salary.maximum === null) {
    return { label: "Salary not listed", explanation: null };
  }
  const targetCurrency = displayCurrency.toUpperCase();
  const convertedMinimum =
    salary.minimum === null
      ? null
      : convertSalaryAmount(salary.minimum, salary.currency, targetCurrency);
  const convertedMaximum =
    salary.maximum === null
      ? null
      : convertSalaryAmount(salary.maximum, salary.currency, targetCurrency);
  const conversionAvailable =
    (salary.minimum === null || convertedMinimum !== null) &&
    (salary.maximum === null || convertedMaximum !== null) &&
    (salary.minimum !== null || salary.maximum !== null);
  if (!conversionAvailable) {
    const compact =
      salary.period === "year" && Math.max(salary.minimum ?? 0, salary.maximum ?? 0) >= 10_000;
    return {
      label: sourceSalaryLabel(salary, compact),
      explanation: `Shown as listed because ${salary.currency} is not available in Jobbbler's fixed demo conversion table.`,
    };
  }

  const annualMinimum =
    convertedMinimum === null ? null : annualizeSalaryAmount(convertedMinimum, salary.period);
  const annualMaximum =
    convertedMaximum === null ? null : annualizeSalaryAmount(convertedMaximum, salary.period);
  const actions = [
    salary.currency === targetCurrency ? null : "converted using Jobbbler's fixed demo rates",
    salary.period === "hour"
      ? "annualized at 2,080 hours per year"
      : salary.period === "month"
        ? "annualized at 12 months per year"
        : null,
  ].filter((action): action is string => action !== null);

  return {
    label: formatSalaryRange(
      annualMinimum,
      annualMaximum,
      targetCurrency,
      "year",
      Math.max(annualMinimum ?? 0, annualMaximum ?? 0) >= 10_000,
    ),
    explanation:
      actions.length === 0
        ? null
        : `Estimated annual compensation in ${targetCurrency}. Originally listed as ${sourceSalaryDescription(salary)}; ${actions.join(" and ")}.`,
  };
}

export function salaryLabel(salary: SalaryRange | null, displayCurrency?: string): string {
  if (salary === null) return "Salary not listed";
  if (displayCurrency !== undefined) return salaryCardPresentation(salary, displayCurrency).label;
  const compact =
    salary.period === "year" && Math.max(salary.minimum ?? 0, salary.maximum ?? 0) >= 10_000;
  return sourceSalaryLabel(salary, compact);
}

export function compactDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function relativeFreshness(value: string, now = new Date()): string {
  const hours = Math.max(0, Math.round((now.getTime() - Date.parse(value)) / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${String(days)}d ago`;
}
