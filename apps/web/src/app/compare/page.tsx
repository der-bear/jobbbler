import { CompareWorkspace } from "@/features/compare/compare-workspace";

function values(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : value;
}

export default async function ComparePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>) {
  const parameters = await searchParams;
  const criteriaParameters = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (key === "id" || value === undefined) continue;
    if (typeof value === "string") criteriaParameters.append(key, value);
    else for (const item of value) criteriaParameters.append(key, item);
  }
  return (
    <CompareWorkspace
      criteriaSearch={criteriaParameters.toString()}
      jobIds={values(parameters["id"])}
    />
  );
}
