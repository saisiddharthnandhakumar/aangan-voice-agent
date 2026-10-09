import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Local runs read .env.local (the Neon dev branch); ENV_FILE=.env.main-branch.local targets main. Migrations need the direct, unpooled URL.
config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: false,
});
