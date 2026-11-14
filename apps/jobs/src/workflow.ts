// IngestWorkflow — thin glue over ingest.ts/retire.ts (spec §Workflow).
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { enabledSources, finishIngestRun, jobsForLinkCheck } from "@hirejuniors/db/queries";
import { ingestSource, recordSourceFailure, startRun, type SourceCounts } from "./ingest";
import { expireJobs, linkCheckSlice } from "./retire";

export interface IngestParams {
  trigger: "schedule" | "manual";
}

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};
const LINK_CHECK_SLICES = 10;
const LINK_CHECK_BATCH = 40;

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: Readonly<WorkflowEvent<IngestParams>>, step: WorkflowStep) {
    const db = drizzle(this.env.DB);
    const trigger = event.payload?.trigger ?? "schedule";

    const runId = await step.do("start", () => startRun(db, trigger, event.instanceId));

    const sourceIds = await step.do("load sources", async () =>
      (await enabledSources(db)).map((s) => s.id),
    );

    const totals = { fetched: 0, inserted: 0, updated: 0, reactivated: 0, retired: 0 };
    let anyFailed = false;

    for (const sourceId of sourceIds) {
      try {
        const counts = (await step.do(`ingest:${sourceId}`, RETRY, () =>
          ingestSource(db, runId, sourceId, fetch.bind(globalThis)),
        )) as SourceCounts;
        totals.fetched += counts.fetched;
        totals.inserted += counts.inserted;
        totals.updated += counts.updated;
        totals.reactivated += counts.reactivated;
        totals.retired += counts.retired;
      } catch (error) {
        anyFailed = true;
        const err = error instanceof Error ? error : new Error(String(error));
        await step.do(`record-failure:${sourceId}`, () =>
          recordSourceFailure(db, runId, sourceId, err),
        );
      }
    }

    totals.retired += await step.do("expire", () => expireJobs(db));

    // Select once so stamping last_checked_at mid-run can't shift the window
    // and skip (or re-pick) jobs — then fan out into <=10 slices of 40 ids.
    const linkCheckIds = await step.do("linkcheck:select", async () =>
      (await jobsForLinkCheck(db, LINK_CHECK_SLICES * LINK_CHECK_BATCH)).map((j) => j.id),
    );
    const slices = Math.min(LINK_CHECK_SLICES, Math.ceil(linkCheckIds.length / LINK_CHECK_BATCH));
    for (let n = 0; n < slices; n++) {
      await step.do(`linkcheck:${n + 1}`, () =>
        linkCheckSlice(
          db,
          fetch.bind(globalThis),
          linkCheckIds.slice(n * LINK_CHECK_BATCH, (n + 1) * LINK_CHECK_BATCH),
        ),
      );
    }

    await step.do("finish", async () => {
      await finishIngestRun(
        db,
        runId,
        anyFailed ? "partial" : "succeeded",
        totals,
        anyFailed ? "one or more sources failed" : undefined,
      );
    });

    return { runId, ...totals };
  }
}
