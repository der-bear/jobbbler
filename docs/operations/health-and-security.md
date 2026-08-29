# Health and security operations

- `GET /api/health/live` confirms that the web process can answer requests.
- `GET /api/health/ready` validates the configured database: SQLite checks its migration journal, integrity, foreign keys, and FTS synchronization; PostgreSQL checks its migration journal and aggregate catalog access. It returns the adapter name and aggregate counts only; it never returns paths, checksums, connection strings, secrets, or database records.
- Web logs use structured Pino records with request/correlation identifiers and redaction for cookies, authorization values, email/address fields, ciphertext, and tokens.
- The application sets no-sniff, frame-deny, strict referrer, and restrictive permissions headers. Production also enables HSTS and a restrictive CSP. The CSP allows only same-origin application assets, inline Next.js hydration/style payloads (never `unsafe-eval`), and the explicitly configured HTTPS/WSS Supabase origin for optional realtime wake-ups. Development omits CSP and HSTS so local tooling remains usable.
