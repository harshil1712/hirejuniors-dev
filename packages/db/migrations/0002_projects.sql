-- Projects demo resource (mirrors schema/projects.ts; hand-maintained, see README).
CREATE TABLE project (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE, name text NOT NULL, status text NOT NULL DEFAULT 'active', notes text NOT NULL DEFAULT '', created_at integer NOT NULL, updated_at integer NOT NULL);
--> statement-breakpoint
CREATE INDEX project_owner_updated_idx ON project (owner_id, updated_at DESC, id);
