import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { project } from "../../schema/db";
import type { Project, ProjectCreate, ProjectListQuery, ProjectUpdate } from "../api/schemas";

export type ServiceErrorCode = "not_found" | "validation_failed";

/** Errors callers translate into HTTP status / MCP isError results. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details?: { path: string; message: string }[];

  constructor(
    code: ServiceErrorCode,
    message: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

type Db = DrizzleD1Database;

function toApi(row: typeof project.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function decodeCursor(cursor: string) {
  let decoded = "";
  try {
    decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {}
  const match = /^(\d+):(prj_[\w-]+)$/.exec(decoded);
  if (!match) throw new ServiceError("validation_failed", "Malformed pagination cursor");
  return { updatedAt: Number(match[1]), id: match[2] };
}

function encodeCursor(updatedAt: Date, id: string): string {
  return btoa(`${updatedAt.getTime()}:${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function list(
  db: Db,
  ownerId: string,
  query: ProjectListQuery,
): Promise<{ items: Project[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(project.ownerId, ownerId)];
  if (query.status !== undefined) conditions.push(eq(project.status, query.status));
  if (query.cursor !== undefined) {
    const { updatedAt, id } = decodeCursor(query.cursor);
    // Keyset pagination, newest first: strictly after (updatedAt, id) in
    // (updatedAt DESC, id DESC) order.
    conditions.push(
      or(
        lt(project.updatedAt, new Date(updatedAt)),
        and(eq(project.updatedAt, new Date(updatedAt)), lt(project.id, id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(project)
    .where(and(...conditions))
    .orderBy(desc(project.updatedAt), desc(project.id))
    .limit(query.limit + 1);

  let nextCursor: string | null = null;
  const items = rows.length > query.limit ? rows.slice(0, query.limit) : rows;
  if (rows.length > query.limit) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor(last.updatedAt, last.id);
  }
  return { items: items.map(toApi), nextCursor };
}

export async function get(db: Db, ownerId: string, id: string): Promise<Project> {
  const row = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.ownerId, ownerId)))
    .get();
  // Not found and not-yours are the same answer — no existence leaks.
  if (!row) throw new ServiceError("not_found", `No such project: ${id}`);
  return toApi(row);
}

export async function create(db: Db, ownerId: string, input: ProjectCreate): Promise<Project> {
  const now = new Date();
  const row = await db
    .insert(project)
    .values({
      ownerId,
      name: input.name,
      status: input.status ?? "active",
      notes: input.notes ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toApi(row);
}

export async function update(
  db: Db,
  ownerId: string,
  id: string,
  patch: ProjectUpdate,
): Promise<Project> {
  const row = await db
    .update(project)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(project.id, id), eq(project.ownerId, ownerId)))
    .returning()
    .get();
  if (!row) throw new ServiceError("not_found", `No such project: ${id}`);
  return toApi(row);
}

export async function remove(db: Db, ownerId: string, id: string): Promise<void> {
  const row = await db
    .delete(project)
    .where(and(eq(project.id, id), eq(project.ownerId, ownerId)))
    .returning({ id: project.id })
    .get();
  if (!row) throw new ServiceError("not_found", `No such project: ${id}`);
}
