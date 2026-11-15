// Discovery candidates — list + manual domain adds (spec §Dashboard).
import { desc, eq, sql } from "drizzle-orm";
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
