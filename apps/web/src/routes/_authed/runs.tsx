import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Loader, Table, Text, Empty } from "@cloudflare/kumo";
import { Play, WarningCircle } from "@phosphor-icons/react";
import type { IngestRun } from "../../../worker/api/schemas";
import { listRuns, triggerRun } from "../../lib/admin-api";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";

export const Route = createFileRoute("/_authed/runs")({ component: Runs });

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_VARIANT = {
  running: "warning",
  succeeded: "success",
  partial: "warning",
  failed: "error",
} as const;

function Runs() {
  useDocumentTitle("Runs");
  const [runs, setRuns] = useState<IngestRun[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const page = await listRuns();
      setRuns(page.data);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listRuns(nextCursor);
      setRuns((prev) => [...(prev ?? []), ...page.data]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { instanceId } = await triggerRun();
      toast.success("Ingest run started", `Workflow instance ${instanceId}`);
      void load();
    } catch (e) {
      const err = e as Error & { code?: string };
      toast.error(
        "Couldn't start the run",
        err.code === "unavailable"
          ? "Ingest isn't available in this deployment (workflow binding missing)."
          : err.message,
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runs"
        description="Ingest workflow runs, latest first."
        actions={
          <Button variant="primary" icon={Play} loading={running} onClick={() => void runNow()}>
            Run now
          </Button>
        }
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load runs"
          description={loadError}
          action={<Banner.Action onClick={() => void load()}>Try again</Banner.Action>}
        />
      ) : runs === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading runs" />
        </div>
      ) : runs.length === 0 ? (
        <Empty title="No runs yet" description="The weekly schedule and Run now land here." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-kumo-line">
            <Table layout="fixed" className="min-w-[760px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Started</Table.Head>
                  <Table.Head className="w-28">Trigger</Table.Head>
                  <Table.Head className="w-28">Status</Table.Head>
                  <Table.Head>Totals</Table.Head>
                  <Table.Head className="w-32">Finished</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {runs.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell>
                      <Link
                        to="/runs/$id"
                        params={{ id: r.id }}
                        className="font-medium text-kumo-default hover:underline"
                      >
                        {dateTimeFormat.format(new Date(r.startedAt))}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>{r.trigger}</Table.Cell>
                    <Table.Cell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text variant="secondary" size="sm">
                        fetched {r.fetched} · +{r.inserted} · ↻{r.updated} · −{r.retired} ·
                        classified {r.classified} · review {r.review} · rejected {r.rejected} ·
                        found {r.discovered} · ai in/out {r.aiInputTokens}/{r.aiOutputTokens}
                        {r.error ? ` · ${r.error}` : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {r.finishedAt ? dateTimeFormat.format(new Date(r.finishedAt)) : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
