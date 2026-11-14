import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Dialog,
  DropdownMenu,
  Input,
  InputArea,
  Select,
  Table,
  Text,
} from "@cloudflare/kumo";
import {
  DotsThree,
  PencilSimple,
  Plus,
  Trash,
  TrayArrowDown,
  TrayArrowUp,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  Project,
  ProjectCreate,
  ProjectStatus,
  ProjectUpdate,
} from "../../../worker/api/schemas";
import { createProject, deleteProject, listProjects, updateProject } from "../../lib/projects-api";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { CrewEmpty } from "../../components/crew-empty";

interface LoaderData {
  data: Project[];
  nextCursor: string | null;
  loadError?: string;
}

export const Route = createFileRoute("/_authed/projects")({
  component: Projects,
  loader: async (): Promise<LoaderData> => {
    try {
      return await listProjects();
    } catch (e) {
      return { data: [], nextCursor: null, loadError: (e as Error).message };
    }
  },
});

const STATUS_BADGE = {
  active: "success",
  paused: "warning",
  archived: "neutral",
} as const satisfies Record<ProjectStatus, "success" | "warning" | "neutral">;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const STATUS_OPTIONS: { label: string; value: ProjectStatus }[] = [
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
  { label: "Archived", value: "archived" },
];

function Projects() {
  useDocumentTitle("Projects");
  const router = useRouter();
  const loaderData = Route.useLoaderData();

  const [more, setMore] = useState<Project[]>([]);
  const [nextCursor, setNextCursor] = useState(loaderData.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dialogProject, setDialogProject] = useState<Project | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [mutating, setMutating] = useState(false);

  // Fresh loader data (after invalidate) resets the paged tail.
  useEffect(() => {
    setMore([]);
    setNextCursor(loaderData.nextCursor);
  }, [loaderData]);

  const projects = [...loaderData.data, ...more];

  const refresh = async () => {
    setMutating(true);
    try {
      await router.invalidate();
    } finally {
      setMutating(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listProjects(nextCursor);
      setMore((prev) => [...prev, ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      toast.error("Couldn't load more projects", (e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const setStatus = async (p: Project, status: ProjectStatus) => {
    try {
      await updateProject(p.id, { status });
      toast.success(status === "archived" ? "Project archived" : "Project restored", p.name);
      await refresh();
    } catch (e) {
      toast.error("Couldn't update project", (e as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteProject(deleteTarget.id);
      toast.success("Project deleted", deleteTarget.name);
      await refresh();
    } catch (e) {
      toast.error("Couldn't delete project", (e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Your projects, newest first."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setDialogProject("new")}>
            New project
          </Button>
        }
      />

      {loaderData.loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load projects"
          description={loaderData.loadError}
          action={<Banner.Action onClick={() => void refresh()}>Try again</Banner.Action>}
        />
      ) : projects.length === 0 ? (
        <CrewEmpty
          title="No projects yet"
          description="Projects you create show up here."
          contents={
            <Button variant="primary" icon={Plus} onClick={() => setDialogProject("new")}>
              New project
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-kumo-line" aria-busy={mutating}>
          <Table layout="fixed" className="min-w-[640px]">
            <colgroup>
              <col />
              <col className="w-28" />
              <col />
              <col className="w-32" />
              <col className="w-16" />
            </colgroup>
            <Table.Header>
              <Table.Row>
                <Table.Head>Name</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Notes</Table.Head>
                <Table.Head>Updated</Table.Head>
                <Table.Head>
                  <span className="sr-only">Actions</span>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {projects.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell>
                    <span className="truncate font-medium text-kumo-default">{p.name}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={STATUS_BADGE[p.status]}>
                      {STATUS_OPTIONS.find((o) => o.value === p.status)?.label}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text variant="secondary" size="sm" truncate>
                      {p.notes}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>{dateFormat.format(new Date(p.updatedAt))}</Table.Cell>
                  <Table.Cell className="text-right">
                    <DropdownMenu>
                      <DropdownMenu.Trigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={DotsThree}
                            aria-label={`Actions for ${p.name}`}
                          />
                        }
                      />
                      <DropdownMenu.Content align="end">
                        <DropdownMenu.Item icon={PencilSimple} onClick={() => setDialogProject(p)}>
                          Edit
                        </DropdownMenu.Item>
                        {p.status === "archived" ? (
                          <DropdownMenu.Item
                            icon={TrayArrowUp}
                            onClick={() => void setStatus(p, "active")}
                          >
                            Unarchive
                          </DropdownMenu.Item>
                        ) : (
                          <DropdownMenu.Item
                            icon={TrayArrowDown}
                            onClick={() => void setStatus(p, "archived")}
                          >
                            Archive
                          </DropdownMenu.Item>
                        )}
                        <DropdownMenu.Item icon={Trash} onClick={() => setDeleteTarget(p)}>
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}

      {dialogProject !== null && (
        <ProjectDialog
          project={dialogProject === "new" ? null : dialogProject}
          onClose={() => setDialogProject(null)}
          onDone={() => {
            setDialogProject(null);
            void refresh();
          }}
        />
      )}

      <ConfirmDialog
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete project?"}
        description="This can't be undone."
        confirmLabel="Delete project"
        variant="destructive"
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ProjectDialog({
  project,
  onClose,
  onDone,
}: {
  project: Project | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = project !== null;
  const [name, setName] = useState(project?.name ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [notes, setNotes] = useState(project?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 0 && name.trim().length <= 80;

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        const patch: ProjectUpdate = {};
        if (name.trim() !== project.name) patch.name = name.trim();
        if (status !== project.status) patch.status = status;
        if (notes !== project.notes) patch.notes = notes;
        if (Object.keys(patch).length === 0) {
          onDone();
          return;
        }
        await updateProject(project.id, patch);
        toast.success("Project saved", name.trim());
      } else {
        const input: ProjectCreate = { name: name.trim() };
        if (status !== "active") input.status = status;
        if (notes) input.notes = notes;
        await createProject(input);
        toast.success("Project created", name.trim());
      }
      onDone();
    } catch (e) {
      toast.error(
        editing ? "Couldn't save project" : "Couldn't create project",
        (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog className="flex flex-col gap-4 p-6">
        <Dialog.Title className="text-lg font-semibold text-kumo-default">
          {editing ? "Edit project" : "New project"}
        </Dialog.Title>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !saving) void submit();
          }}
        >
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            autoFocus
          />
          <Select<ProjectStatus>
            label="Status"
            value={status}
            onValueChange={(v) => {
              if (v !== null) setStatus(v);
            }}
            items={STATUS_OPTIONS}
          />
          <InputArea
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            minRows={2}
          />
        </form>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close disabled={saving} render={<Button variant="secondary">Cancel</Button>} />
          <Button
            variant="primary"
            loading={saving}
            disabled={!valid}
            onClick={() => void submit()}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
