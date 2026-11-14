import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./schema/db.ts",
  out: "../../packages/db/migrations",
  dialect: "sqlite",
});
