import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | undefined;

/**
 * Drizzle over Neon's HTTP driver, using the pooled DATABASE_URL.
 * Interactive transactions are not used (see docs/PLATFORM_NOTES.md section 6).
 */
export function db(): Db {
  instance ??= drizzle({ client: neon(env().DATABASE_URL), schema });
  return instance;
}

export { schema };
