import type {
  EmploymentType,
  JobCategory,
  SalaryRange,
  Seniority,
  WorkModel,
} from "@jobbbler/contracts";

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

function amount(value: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

export function salaryLabel(salary: SalaryRange | null): string {
  if (salary === null) return "Salary undisclosed";
  const period = salary.period === "year" ? "yr" : salary.period === "month" ? "mo" : "hr";
  if (salary.minimum !== null && salary.maximum !== null) {
    return `${amount(salary.minimum, salary.currency)}–${amount(salary.maximum, salary.currency)} / ${period}`;
  }
  if (salary.minimum !== null) return `From ${amount(salary.minimum, salary.currency)} / ${period}`;
  if (salary.maximum !== null)
    return `Up to ${amount(salary.maximum, salary.currency)} / ${period}`;
  return `${salary.currency} range undisclosed`;
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
