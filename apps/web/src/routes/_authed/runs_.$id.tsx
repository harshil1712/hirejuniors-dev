import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, LayerCard, Loader, Table, Text } from "@cloudflare/kumo";
import { WarningCircle } from "@phosphor-icons/react";
import type { IngestRun, SourceRun } from "../../../worker/api/schemas";
import { getRun } from "../../lib/admin-api";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";

export const Route = createFileRoute("/_authed/runs_/$id")({ component: RunDetail });

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const fmt = (iso: string | null) => (iso ? dateTimeFormat.format(new Date(iso)) : "—");

type RunDetailData = IngestRun & { sourceRuns: SourceRun[] };

function RunDetail() {
  const { id } = Route.useParams();
  useDocumentTitle("Run");
  const [run, setRun] = useState<RunDetailData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRun(await getRun(id));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={run ? `Run ${run.status}` : "Run"}
        description={run ? `${run.trigger} · started ${fmt(run.startedAt)}` : undefined}
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load the run"
          description={loadError}
          action={
            <>
              <Banner.Action onClick={() => void load()}>Try again</Banner.Action>{" "}
              <Link to="/runs">Back to runs</Link>
            </>
          }
        />
      ) : run === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading run" />
        </div>
      ) : (
        <>
          <LayerCard>
            <LayerCard.Secondary>Totals</LayerCard.Secondary>
            <LayerCard.Primary>
              fetched {run.fetched} · inserted {run.inserted} · updated {run.updated} · reactivated{" "}
              {run.reactivated} · retired {run.retired}
            </LayerCard.Primary>
            {run.error && (
              <Banner
                variant="error"
                size="sm"
                icon={<WarningCircle weight="fill" size={16} aria-hidden />}
                description={run.error}
              />
            )}
            <Text variant="secondary" size="sm">
              finished {fmt(run.finishedAt)}
            </Text>
          </LayerCard>

          <div className="overflow-x-auto rounded-lg border border-kumo-line">
            <Table layout="fixed" className="min-w-[760px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Source</Table.Head>
                  <Table.Head>Company</Table.Head>
                  <Table.Head className="w-28">Status</Table.Head>
                  <Table.Head>Counts</Table.Head>
                  <Table.Head>Error</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {run.sourceRuns.length === 0 ? (
                  <Table.Row>
                    <Table.Cell>
                      <Text variant="secondary">No source rows recorded.</Text>
                    </Table.Cell>
                    <Table.Cell />
                    <Table.Cell />
                    <Table.Cell />
                    <Table.Cell />
                  </Table.Row>
                ) : (
                  run.sourceRuns.map((s) => (
                    <Table.Row key={s.id}>
                      <Table.Cell>
                        <span className="truncate font-medium text-kumo-default">
                          {s.sourceName}
                        </span>
                      </Table.Cell>
                      <Table.Cell>{s.companyName}</Table.Cell>
                      <Table.Cell>
                        <Badge variant={s.status === "succeeded" ? "success" : "error"}>
                          {s.status}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text variant="secondary" size="sm">
                          fetched {s.fetched} · kept {s.kept} · +{s.inserted} · ↻{s.updated} · −
                          {s.retired}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text variant="secondary" size="sm" truncate title={s.error ?? ""}>
                          {s.error ?? "—"}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
