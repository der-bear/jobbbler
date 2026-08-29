CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  organization_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json)),
  work_model TEXT NOT NULL CHECK (work_model IN ('remote', 'hybrid', 'onsite', 'flexible')),
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'freelance', 'internship')),
  seniority TEXT CHECK (seniority IS NULL OR seniority IN ('entry', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'executive')),
  locations_json TEXT NOT NULL CHECK (json_valid(locations_json)),
  skills_json TEXT NOT NULL CHECK (json_valid(skills_json)),
  salary_minimum REAL,
  salary_maximum REAL,
  salary_currency TEXT,
  salary_period TEXT CHECK (salary_period IS NULL OR salary_period IN ('hour', 'month', 'year')),
  source_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  apply_mode TEXT NOT NULL CHECK (apply_mode IN ('internal', 'external')),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'stale')),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (salary_currency IS NULL AND salary_period IS NULL AND salary_minimum IS NULL AND salary_maximum IS NULL)
    OR (salary_currency IS NOT NULL AND salary_period IS NOT NULL)
  ),
  CHECK (salary_minimum IS NULL OR salary_minimum >= 0),
  CHECK (salary_maximum IS NULL OR salary_maximum >= 0),
  CHECK (salary_minimum IS NULL OR salary_maximum IS NULL OR salary_maximum >= salary_minimum)
) STRICT;

CREATE INDEX jobs_status_published_idx ON jobs(status, published_at DESC, id);
CREATE INDEX jobs_organization_idx ON jobs(organization_id, status, published_at DESC);
CREATE INDEX jobs_work_model_idx ON jobs(work_model, status, published_at DESC);
CREATE INDEX jobs_seniority_idx ON jobs(seniority, status, published_at DESC);
