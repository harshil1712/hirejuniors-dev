// Tolerant feed parsing — spec §Adapters: the envelope must parse, each job
// is safeParsed individually, invalid jobs are skipped, and a non-empty feed
// with more than 20% invalid jobs fails with the first zod issue path.
import type { z } from "zod";

const MAX_INVALID_RATIO = 0.2;

export function parseJobList<T>(raw: unknown[], schema: z.ZodType<T>): T[] {
  const valid: T[] = [];
  let firstIssue = "";
  let invalid = 0;
  for (const item of raw) {
    const r = schema.safeParse(item);
    if (r.success) {
      valid.push(r.data);
    } else {
      invalid++;
      if (!firstIssue) {
        firstIssue = r.error.issues
          .map((i) => [...i.path, i.message].join(": ") || i.message)
          .join("; ");
      }
    }
  }
  if (raw.length > 0 && invalid / raw.length > MAX_INVALID_RATIO) {
    throw new Error(`feed: ${invalid}/${raw.length} jobs invalid — ${firstIssue}`);
  }
  return valid;
}
