import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  target: "es2024",
  platform: "node",
  noExternal: [/^@jobbbler\//],
  external: ["better-sqlite3", "sanitize-html", "zod"],
});
