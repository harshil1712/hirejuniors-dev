// Discovery candidates — list + manual domain adds (spec §Dashboard).
import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { discoveryCandidate } from "@hirejuniors/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

type Db = DrizzleD1Database;

const PAGE = 100;

export async function list(db: Db, opts: { status?: string; cursor?: string }) {
  const conds = [];
  if (opts.status) conds.push(eq(discoveryCandidate.status, opts.status as never));
  if (opts.cursor) {
    const [created, id] = Buffer.from(opts.cursor, "base64url").toString().split("|");
    conds.push(
      sql`(${discoveryCandidate.createdAt} < ${Number(created)}) OR (${discoveryCandidate.createdAt} = ${Number(created)} AND ${discoveryCandidate.id} < ${id})`,
    );
  }
  const rows = await db
    .select()
    .from(discoveryCandidate)
    .where(conds.length ? sql.join(conds, sql` AND `) : undefined)
    .orderBy(desc(discoveryCandidate.createdAt), desc(discoveryCandidate.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > PAGE && last
      ? Buffer.from(`${last.createdAt.getTime()}|${last.id}`).toString("base64url")
      : null;
  return { data: page.map(toApi), nextCursor };
}

function toApi(r: typeof discoveryCandidate.$inferSelect) {
  return {
    id: r.id,
    origin: r.origin,
    input: r.input,
    status: r.status,
    platform: r.platform,
    board: r.board,
    sourceId: r.sourceId,
    error: r.error,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const HOSTNAME = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split("?")[0];
  return HOSTNAME.test(d) ? d : null;
}

/** Add manual candidates (deduped, INSERT OR IGNORE on unique input). */
export async function addDomains(db: Db, domains: string[]): Promise<number> {
  const unique = [
    ...new Set(
      domains.flatMap((d) => {
        const n = normalizeDomain(d);
        return n ? [n] : [];
      }),
    ),
  ];
  for (const input of unique) {
    await db
      .insert(discoveryCandidate)
      .values({ id: `dsc_${nanoid(16)}`, origin: "manual", input })
      .onConflictDoNothing();
  }
  return unique.length;
}
