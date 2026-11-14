import { nanoid } from "nanoid";
import { desc } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "../src/auth-schema";

export const project = sqliteTable(
  "project",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => "prj_" + nanoid(16)),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "paused", "archived"] })
      .notNull()
      .default("active"),
    notes: text("notes").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_owner_updated_idx").on(table.ownerId, desc(table.updatedAt), table.id),
  ],
);
