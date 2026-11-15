import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  Input,
  InputArea,
  Loader,
  Select,
  Switch,
  Table,
  Text,
  Empty,
} from "@cloudflare/kumo";
import { Plus, WarningCircle } from "@phosphor-icons/react";
import type { Company, Source, SourcePlatform, SourcePreviewResult } from "../../lib/admin-api";
import {
  createCompany,
  createSource,
  listCompanies,
  listSources,
  previewSource,
  updateSource,
} from "../../lib/admin-api";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";

import { FormError } from "../../components/form-error";

export const Route = createFileRoute("/_authed/sources")({ component: Sources });

const PLATFORM_OPTIONS: { label: string; value: SourcePlatform }[] = [
  { label: "Greenhouse", value: "greenhouse" },
  { label: "Lever", value: "lever" },
  { label: "Ashby", value: "ashby" },
  { label: "Amazon Jobs", value: "amazon_jobs" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Sources() {
  useDocumentTitle("Sources");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSources(await listSources());
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (src: Source, enabled: boolean) => {
    setToggling(src.id);
    try {
      await updateSource(src.id, { enabled });
      toast.success(enabled ? "Source enabled" : "Source disabled", src.board);
      await load();
    } catch (e) {
      toast.error("Couldn't update the source", (e as Error).message);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sources"
        description="Job boards the pipeline ingests from."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>
            Add source
          </Button>
        }
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load sources"
          description={loadError}
          action={<Banner.Action onClick={() => void load()}>Try again</Banner.Action>}
        />
      ) : sources === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading sources" />
        </div>
      ) : sources.length === 0 ? (
        <Empty
          title="No sources yet"
          description="Add a job board source and the next ingest run picks it up."
          contents={
            <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>
              Add source
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-kumo-line">
          <Table layout="fixed" className="min-w-[960px]">
            <Table.Header>
              <Table.Row>
                <Table.Head className="w-40">Company</Table.Head>
                <Table.Head className="w-28">Platform</Table.Head>
                <Table.Head className="w-32">Board</Table.Head>
                <Table.Head className="w-28">Origin</Table.Head>
                <Table.Head className="w-24">Trial</Table.Head>
                <Table.Head className="w-24">Enabled</Table.Head>
                <Table.Head className="w-24">All jobs</Table.Head>
                <Table.Head className="w-32">Last run</Table.Head>
                <Table.Head className="w-36">Status</Table.Head>
                <Table.Head className="w-24 text-right">Active</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sources.map((s) => (
                <Table.Row key={s.id}>
                  <Table.Cell>
                    <span className="truncate font-medium text-kumo-default">{s.company.name}</span>
                  </Table.Cell>
                  <Table.Cell>{s.platform}</Table.Cell>
                  <Table.Cell>
                    <Text variant="secondary" size="sm" truncate>
                      {s.board}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {s.origin}
                    {s.disabledReason ? (
                      <Text variant="secondary" size="sm">
                        {s.disabledReason}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>{s.trial ? "Yes" : "No"}</Table.Cell>
                  <Table.Cell>
                    <Switch
                      aria-label={`${s.enabled ? "Disable" : "Enable"} ${s.board}`}
                      checked={s.enabled}
                      disabled={toggling === s.id}
                      onCheckedChange={(v) => void toggle(s, v === true)}
                    />
                  </Table.Cell>
                  <Table.Cell>{s.includeAll ? "Yes" : "No"}</Table.Cell>
                  <Table.Cell>
                    {s.lastRunAt ? dateFormat.format(new Date(s.lastRunAt)) : "—"}
                  </Table.Cell>
                  <Table.Cell>
                    {s.lastStatus === "failed" ? (
                      <span className="flex items-center gap-2">
                        <Badge variant="error">failed</Badge>
                        <Text variant="secondary" size="sm" truncate title={s.lastError ?? ""}>
                          {s.lastError}
                        </Text>
                      </span>
                    ) : s.lastStatus === "succeeded" ? (
                      <Badge variant="success">ok</Badge>
                    ) : (
                      <Text variant="secondary" size="sm">
                        never ran
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">{s.activeJobs}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      {addOpen && <AddSourceDialog onClose={() => setAddOpen(false)} onSaved={load} />}
    </div>
  );
}

type PreviewData = SourcePreviewResult["data"];

function AddSourceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState("");
  const [newCompany, setNewCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [platform, setPlatform] = useState<SourcePlatform>("greenhouse");
  const [board, setBoard] = useState("");
  const [config, setConfig] = useState("{}");
  const [includeAll, setIncludeAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    void listCompanies()
      .then((rows) => {
        setCompanies(rows);
        if (rows.length > 0) setCompanyId((v) => v || rows[0].id);
      })
      .catch((e) => setCompaniesError((e as Error).message));
  }, []);

  const previewInput = () => ({
    platform,
    board: board.trim(),
    config: config.trim() || "{}",
    includeAll,
  });

  const companyValid = newCompany ? companyName.trim().length > 0 : companyId.length > 0;
  const valid = companyValid && board.trim().length > 0;

  const test = async () => {
    setTesting(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewSource(previewInput()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      let cid = companyId;
      if (newCompany) {
        cid = (await createCompany({ name: companyName.trim() })).id;
      }
      await createSource({ ...previewInput(), companyId: cid, enabled: true });
      toast.success("Source added", `${platform}/${board.trim()}`);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6" size="lg">
        <Dialog.Title className="text-lg font-semibold text-kumo-default">Add source</Dialog.Title>
        <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
          {companiesError && <FormError message={companiesError} />}
          <Select
            label="Company"
            value={newCompany ? "__new__" : companyId}
            onValueChange={(v) => {
              if (v === null) return;
              setNewCompany(v === "__new__");
              if (v !== "__new__") setCompanyId(v);
            }}
            items={[
              ...companies.map((cmp) => ({ label: cmp.name, value: cmp.id })),
              { label: "＋ New company…", value: "__new__" },
            ]}
          />
          {newCompany && (
            <Input
              label="New company name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              autoFocus
            />
          )}
          <Select
            label="Platform"
            value={platform}
            onValueChange={(v) => {
              if (v !== null) setPlatform(v);
            }}
            items={PLATFORM_OPTIONS}
          />
          <Input
            label="Board"
            description="Board token / site / board name ('amazon' for Amazon Jobs)"
            value={board}
            onChange={(e) => setBoard(e.target.value)}
            required
          />
          <InputArea
            label="Config (JSON)"
            description="Validated against the platform adapter on save."
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            rows={4}
            className="font-mono text-sm"
          />
          <Checkbox
            label="Include all jobs (board is already early-career only)"
            checked={includeAll}
            onCheckedChange={(v) => setIncludeAll(v === true)}
          />
        </form>

        {error && <FormError message={error} />}

        {preview && (
          <div className="flex flex-col gap-2 rounded-md border border-kumo-line p-3">
            <Text variant="secondary" size="sm">
              Fetched {preview.fetched} · kept {preview.kept}
            </Text>
            {preview.sample.length > 0 && (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {preview.sample.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-kumo-default">{s.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-kumo-subtle">
                      {s.level && <Badge variant="outline">{s.level}</Badge>}
                      {s.locationRaw}
                      {s.countryCode ? ` (${s.countryCode})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="secondary"
            loading={testing}
            disabled={!valid || saving}
            onClick={() => void test()}
          >
            Test
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Dialog.Close disabled={saving} render={<Button variant="secondary">Cancel</Button>} />
            <Button
              variant="primary"
              loading={saving}
              disabled={!valid}
              onClick={() => void save()}
            >
              Save source
            </Button>
          </div>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
