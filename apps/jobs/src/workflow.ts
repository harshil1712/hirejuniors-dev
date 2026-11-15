// IngestWorkflow — thin glue over ingest/classify/discover/retire (spec §Workflow).
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { finishIngestRun, ingestibleSources } from "@hirejuniors/db/queries";
import { ingestSource, recordSourceFailure, startRun } from "./ingest";
import { classifyStep } from "./classify";
import { discoverStep, listingsCandidates, trialEval } from "./discover";
import { expireJobs } from "./retire";
import { aiBinding } from "./ai";
import { browserBinding } from "./browser";

export interface IngestParams {
  trigger: "schedule" | "manual";
}

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};
const INGEST_STEP: WorkflowStepConfig = { ...RETRY, timeout: "10 minutes" };
const CLASSIFY_STEPS = 100;
const CLASSIFY_BATCH = 20;
const DISCOVER_STEPS = 10; // ≤150 candidates per run

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: Readonly<WorkflowEvent<IngestParams>>, step: WorkflowStep) {
    const db = drizzle(this.env.DB);
    const fetcher = fetch.bind(globalThis);
    const ai = aiBinding(this.env.AI);
    const browser = browserBinding(this.env.BROWSER);
    const trigger = event.payload?.trigger ?? "schedule";

    const runId = await step.do("start", () => startRun(db, trigger, event.instanceId));

    // Listings — best-effort, never fails the run.
    await step.do("discover:listings", () => listingsCandidates(db, fetcher)).catch(() => 0);

    const discovered = { n: 0 };
    // Browser ms / AI tokens are per-step deltas inside each step result —
    // a cumulative counter read later would be wrong after Workflow replay.
    let discoverBrowserMs = 0;
    for (let n = 0; n < DISCOVER_STEPS; n++) {
      const res = await step.do(`discover:${n + 1}`, async () => {
        const before = browser.msUsed;
        const out = await discoverStep(db, { fetcher, browser });
        return { ...out, browserMs: browser.msUsed - before };
      });
      discovered.n += res.found;
      discoverBrowserMs += res.browserMs;
      if (res.probed < 15) break;
    }

    const sourceIds = await step.do("load sources", async () =>
      (await ingestibleSources(db)).map((s) => s.id),
    );

    const totals = {
      fetched: 0,
      inserted: 0,
      updated: 0,
      reactivated: 0,
      retired: 0,
      classified: 0,
      rejected: 0,
      review: 0,
      discovered: discovered.n,
      aiInputTokens: 0,
      aiOutputTokens: 0,
      browserMs: discoverBrowserMs,
    };
    let anyFailed = false;
    const ingested: string[] = [];

    for (const sourceId of sourceIds) {
      try {
        const counts = await step.do(`ingest:${sourceId}`, INGEST_STEP, () =>
          ingestSource(db, runId, sourceId, { fetcher }),
        );
        totals.fetched += counts.fetched;
        totals.inserted += counts.inserted;
        totals.updated += counts.updated;
        totals.reactivated += counts.reactivated;
        totals.retired += counts.retired;
        ingested.push(sourceId);
      } catch (error) {
        anyFailed = true;
        const err = error instanceof Error ? error : new Error(String(error));
        await step.do(`record-failure:${sourceId}`, () =>
          recordSourceFailure(db, runId, sourceId, err),
        );
      }
    }

    // Classify — ≤100 steps × 20 jobs; a Clef error throws the step → retries.
    for (let n = 0; n < CLASSIFY_STEPS; n++) {
      const counts = await step.do(`classify:${n + 1}`, RETRY, () =>
        classifyStep(db, ai, CLASSIFY_BATCH),
      );
      totals.classified += counts.classified;
      totals.rejected += counts.rejected;
      totals.review += counts.review;
      totals.aiInputTokens += counts.inputTokens;
      if (counts.classified + counts.rejected + counts.review === 0 && n > 0) break;
    }

    await step.do("trial", () => trialEval(db, ingested));

    totals.retired += await step.do("expire", () => expireJobs(db));

    await step.do("finish", async () => {
      const status = anyFailed ? "partial" : "succeeded";
      await finishIngestRun(db, runId, status, totals);
    });
  }
}
