// Expiry — spec §Feed diff: a job whose valid_through passed retires as
// `expired`. No age-based expiry.
import { inArray } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { chunks, expirableJobs } from "@hirejuniors/db/queries";
import type { Db } from "./ingest";

/** Retire `expired`: valid_through passed. No age-based expiry (spec §Expiry). */
export async function expireJobs(db: Db, now = new Date()): Promise<number> {
  const rows = await expirableJobs(db, now);
  if (rows.length === 0) return 0;
  for (const chunk of chunks(
    rows.map((r) => r.id),
    80,
  )) {
    await db
      .update(job)
      .set({ status: "retired", retiredAt: now, retireReason: "expired", updatedAt: now })
      .where(inArray(job.id, chunk));
  }
  return rows.length;
}
