import type {
  EmploymentType,
  JobCategory,
  SalaryRange,
  Seniority,
  WorkModel,
} from "@jobbbler/contracts";
import { convertSalaryAmount } from "@jobbbler/jobs-domain";

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

function amount(value: number, currency: string, compact: boolean): string {
  const formatted = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
  return compact ? formatted.replace(/K$/u, "k") : formatted;
}

export function salaryLabel(salary: SalaryRange | null, displayCurrency?: string): string {
  if (salary === null) return "Salary not listed";
  const targetCurrency = displayCurrency?.toUpperCase() ?? salary.currency;
  const convertedMinimum =
    salary.minimum === null
      ? null
      : convertSalaryAmount(salary.minimum, salary.currency, targetCurrency);
  const convertedMaximum =
    salary.maximum === null
      ? null
      : convertSalaryAmount(salary.maximum, salary.currency, targetCurrency);
  const conversionAvailable = convertedMinimum !== null || convertedMaximum !== null;
  const changedCurrency = targetCurrency !== salary.currency && conversionAvailable;
  const currency = changedCurrency ? targetCurrency : salary.currency;
  const minimum = changedCurrency ? convertedMinimum : salary.minimum;
  const maximum = changedCurrency ? convertedMaximum : salary.maximum;
  const period = salary.period === "year" ? "yr" : salary.period === "month" ? "mo" : "hr";
  const prefix = changedCurrency ? "≈" : "";
  const compact = salary.period === "year" && Math.max(minimum ?? 0, maximum ?? 0) >= 10_000;
  if (minimum !== null && maximum !== null) {
    return `${prefix}${amount(minimum, currency, compact)}–${amount(maximum, currency, compact)} / ${period}`;
  }
  if (minimum !== null) return `${prefix}From ${amount(minimum, currency, compact)} / ${period}`;
  if (maximum !== null) return `${prefix}Up to ${amount(maximum, currency, compact)} / ${period}`;
  return "Salary not listed";
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
  if (hours < 1) return "Updated just now";
  if (hours < 24) return `Updated ${String(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `Updated ${String(days)}d ago`;
}
