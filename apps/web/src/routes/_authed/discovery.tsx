// /discovery — candidate queue + manual domain adds.
import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Badge,
  Banner,
  Button,
  Empty,
  Input,
  LayerCard,
  Loader,
  Select,
  Table,
} from "@cloudflare/kumo";
import { PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import { addDiscovery, listDiscovery, type DiscoveryCandidate } from "../../lib/admin-api";
import { toast } from "../../lib/toast";
import { PageHeader } from "../../components/page-header";

export const Route = createFileRoute("/_authed/discovery")({
  component: Discovery,
});

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Found", value: "found" },
  { label: "Not found", value: "not_found" },
  { label: "Duplicate", value: "duplicate" },
  { label: "Failed", value: "failed" },
];

function statusVariant(status: string) {
  switch (status) {
    case "found":
      return "success" as const;
    case "not_found":
    case "duplicate":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function Discovery() {
  const [rows, setRows] = useState<DiscoveryCandidate[] | null>(null);
  const [status, setStatus] = useState("");
  const [domains, setDomains] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listDiscovery(status || undefined);
      setRows(res.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const list = domains
      .split(/[\s,]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    try {
      const { added } = await addDiscovery(list);
      toast.success(`${added} domain(s) queued`);
      setDomains("");
      void load();
    } catch (e) {
      toast.error("Couldn't add domains", (e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discovery"
        description="Careers-page candidates being probed for known ATS boards."
      />

      <LayerCard>
        <LayerCard.Secondary>Add domains or board URLs</LayerCard.Secondary>
        <LayerCard.Primary>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input
              label="Domains"
              placeholder="stripe.com figma.com (up to 500)"
              className="min-w-72 grow"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
            <Button type="submit" variant="primary" icon={PaperPlaneTilt}>
              Queue domains
            </Button>
          </form>
        </LayerCard.Primary>
      </LayerCard>

      {error ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load candidates"
          description={error}
          action={<Banner.Action onClick={() => void load()}>Try again</Banner.Action>}
        />
      ) : rows === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading candidates" />
        </div>
      ) : (
        <>
          <Select
            label="Status"
            value={status}
            onValueChange={(v) => setStatus(v ?? "")}
            items={STATUS_OPTIONS}
            className="w-56"
          />
          {rows.length === 0 ? (
            <Empty
              title="No candidates"
              description="Queue domains or board URLs above, or wait for the weekly run."
            />
          ) : (
            <Table layout="fixed" className="min-w-[960px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head className="w-56">Input</Table.Head>
                  <Table.Head className="w-24">Origin</Table.Head>
                  <Table.Head className="w-28">Status</Table.Head>
                  <Table.Head className="w-32">Platform</Table.Head>
                  <Table.Head className="w-40">Board</Table.Head>
                  <Table.Head className="w-28">Source</Table.Head>
                  <Table.Head>Error</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell className="truncate font-mono text-xs">{r.input}</Table.Cell>
                    <Table.Cell>{r.origin}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </Table.Cell>
                    <Table.Cell>{r.platform ?? "—"}</Table.Cell>
                    <Table.Cell className="truncate font-mono text-xs">{r.board ?? "—"}</Table.Cell>
                    <Table.Cell className="truncate font-mono text-xs">
                      {r.sourceId ?? "—"}
                    </Table.Cell>
                    <Table.Cell className="truncate text-xs text-kumo-base">
                      {r.error ?? ""}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
