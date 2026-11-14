import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, Banner, Button, LayerCard, Loader, Text, Tooltip } from "@cloudflare/kumo";
import { Play, WarningCircle } from "@phosphor-icons/react";
import type { DashboardSummary } from "../../../worker/api/schemas";
import { getDashboardSummary, triggerRun } from "../../lib/admin-api";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";

export const Route = createFileRoute("/_authed/dashboard")({ component: Dashboard });

type Summary = DashboardSummary["data"];

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function Dashboard() {
  useDocumentTitle("Dashboard");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = async () => {
    setLoadError(null);
    try {
      setSummary(await getDashboardSummary());
    } catch (e) {
      setLoadError((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const runNow = async () => {
    setRunning(true);
    try {
      const { instanceId } = await triggerRun();
      toast.success("Ingest run started", `Workflow instance ${instanceId}`);
      void load();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "unavailable") {
        setUnavailable(true);
      } else {
        toast.error("Couldn't start the run", err.message);
      }
    } finally {
      setRunning(false);
    }
  };

  const runButton = (
    <Button
      variant="primary"
      icon={Play}
      loading={running}
      disabled={unavailable}
      onClick={() => void runNow()}
    >
      Run now
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="The ingest pipeline at a glance."
        actions={
          unavailable ? (
            <Tooltip content="Ingest isn't available in this deployment (workflow binding missing).">
              {runButton}
            </Tooltip>
          ) : (
            runButton
          )
        }
      />

      {loadError ? (
        <Banner
          role="alert"
          variant="error"
          icon={<WarningCircle weight="fill" size={20} aria-hidden />}
          title="Couldn't load the dashboard"
          description={loadError}
          action={<Banner.Action onClick={() => void load()}>Try again</Banner.Action>}
        />
      ) : summary === null ? (
        <div className="flex justify-center py-16">
          <Loader size="base" aria-label="Loading dashboard" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <LayerCard>
              <LayerCard.Secondary>Active jobs</LayerCard.Secondary>
              <LayerCard.Primary>{summary.activeJobs.toLocaleString()}</LayerCard.Primary>
            </LayerCard>
            <LayerCard>
              <LayerCard.Secondary>Retired in last 7 days</LayerCard.Secondary>
              <LayerCard.Primary>{summary.retiredLast7Days.toLocaleString()}</LayerCard.Primary>
            </LayerCard>
            <LayerCard>
              <LayerCard.Secondary>Sources failing</LayerCard.Secondary>
              <LayerCard.Primary>{summary.failingSources.toLocaleString()}</LayerCard.Primary>
            </LayerCard>
          </div>

          <LayerCard>
            <LayerCard.Secondary>Last ingest run</LayerCard.Secondary>
            <LayerCard.Primary>
              {summary.lastRun ? (
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-3">
                    <Badge
                      variant={
                        summary.lastRun.status === "succeeded"
                          ? "success"
                          : summary.lastRun.status === "failed"
                            ? "error"
                            : "warning"
                      }
                    >
                      {summary.lastRun.status}
                    </Badge>
                    <span>
                      {dateTimeFormat.format(new Date(summary.lastRun.startedAt))} ·{" "}
                      {summary.lastRun.trigger}
                    </span>
                  </span>
                  <Text variant="secondary" size="sm">
                    <Link to="/runs/$id" params={{ id: summary.lastRun.id }}>
                      View run
                    </Link>{" "}
                    · fetched {summary.lastRun.fetched} · inserted {summary.lastRun.inserted} ·
                    retired {summary.lastRun.retired}
                    {summary.lastRun.error ? ` · ${summary.lastRun.error}` : ""}
                  </Text>
                </div>
              ) : (
                <Text variant="secondary">No runs yet</Text>
              )}
            </LayerCard.Primary>
          </LayerCard>
        </>
      )}
    </div>
  );
}
