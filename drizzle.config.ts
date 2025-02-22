import type { Config } from "drizzle-kit";
// import { config } from "dotenv";

// if (process.env.ENVIRONMENT === "production") {
//   config({ path: '.dev.vars' })
// }
export default {
  out: "./drizzle",
  schema: "./database/schema.ts",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    databaseId: "0cf03998-30a5-4a7f-a496-42ea5051a36c",
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    token: process.env.CLOUDFLARE_TOKEN!,
  },
} satisfies Config;
