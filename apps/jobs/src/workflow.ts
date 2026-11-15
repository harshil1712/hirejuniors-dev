// IngestWorkflow — thin glue over ingest/classify/discover/retire (spec §Workflow).
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { finishIngestRun, ingestibleSources, jobsForLinkCheck } from "@hirejuniors/db/queries";
import { ingestSource, recordSourceFailure, startRun, type SourceCounts } from "./ingest";
import { classifyStep } from "./classify";
import { CRAWL_HOSTS, crawlHost, discoverStep, newestCrawl, trialEval } from "./discover";
import { expireJobs, linkCheckSlice } from "./retire";
import { aiBinding } from "./ai";
import { browserBinding } from "./browser";
import type { AdapterCtx } from "./platforms";

export interface IngestParams {
  trigger: "schedule" | "manual";
}

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
};
// Careers-page ingest fetches one page per new link — needs a longer step
// timeout than the JSON feeds (spec §Careers-page ingest).
const INGEST_STEP: WorkflowStepConfig = { ...RETRY, timeout: "10 minutes" };
const LINK_CHECK_JOBS = 400;
const LINK_CHECK_BATCH = 40;
const CLASSIFY_STEPS = 25;
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

    // Crawl — best-effort, every call wrapped; never fails the run.
    const crawl = await step.do("crawl:index", () => newestCrawl(fetcher)).catch(() => null);
    if (crawl) {
      for (const { host, platform } of CRAWL_HOSTS) {
        await step
          .do(`discover:crawl:${host}`, () =>
            crawlHost(db, fetcher, crawl.crawlId, crawl.cdxApi, host, platform),
          )
          .catch(() => 0);
      }
    }

    const discovered = { n: 0 };
    // Browser ms / AI tokens are per-step deltas inside each step result —
    // a cumulative counter read later would be wrong after Workflow replay.
    let discoverBrowserMs = 0;
    let discoverAiTokens = 0;
    for (let n = 0; n < DISCOVER_STEPS; n++) {
      const res = await step.do(`discover:${n + 1}`, async () => {
        const before = browser.msUsed;
        const out = await discoverStep(db, { fetcher, browser, ai });
        return { ...out, browserMs: browser.msUsed - before };
      });
      discovered.n += res.found;
      discoverBrowserMs += res.browserMs;
      discoverAiTokens += res.aiInputTokens;
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
      aiInputTokens: discoverAiTokens,
      aiOutputTokens: 0,
      browserMs: discoverBrowserMs,
    };
    let anyFailed = false;
    const ingested: string[] = [];

    for (const sourceId of sourceIds) {
      try {
        const counts = (await step.do(`ingest:${sourceId}`, INGEST_STEP, async () => {
          const before = browser.msUsed;
          const ctx: AdapterCtx = { fetcher, browser, ai, aiTokens: { n: 0 } };
          const out = await ingestSource(db, runId, sourceId, ctx);
          return {
            ...out,
            browserMs: browser.msUsed - before,
            aiInputTokens: ctx.aiTokens?.n ?? 0,
          };
        })) as SourceCounts & { browserMs: number; aiInputTokens: number };
        totals.fetched += counts.fetched;
        totals.inserted += counts.inserted;
        totals.updated += counts.updated;
        totals.reactivated += counts.reactivated;
        totals.retired += counts.retired;
        totals.browserMs += counts.browserMs;
        totals.aiInputTokens += counts.aiInputTokens;
        ingested.push(sourceId);
      } catch (error) {
        anyFailed = true;
        const err = error instanceof Error ? error : new Error(String(error));
        await step.do(`record-failure:${sourceId}`, () =>
          recordSourceFailure(db, runId, sourceId, err),
        );
      }
    }

    // Classify — ≤25 steps × 20 jobs; a Clef error throws the step → retries.
    for (let n = 0; n < CLASSIFY_STEPS; n++) {
      const counts = await step.do(`classify:${n + 1}`, RETRY, () =>
        classifyStep(db, ai, CLASSIFY_BATCH),
      );
      totals.classified += counts.classified;
      totals.rejected += counts.rejected;
      totals.review += counts.review;
      totals.aiInputTokens += counts.inputTokens;
      if (counts.classified + counts.rejected + counts.review === 0 && n > 0) break;
      if (counts.classified + counts.rejected + counts.review < CLASSIFY_BATCH) {
        // last batch may be short — keep looping until a step returns nothing
      }
    }

    await step.do("trial", () => trialEval(db, ingested));

    totals.retired += await step.do("expire", () => expireJobs(db));

    const breakerNotes: string[] = [];
    // Select once (≤400, nulls first) then fan out into 40-id slices.
    const linkCheckIds = await step.do("linkcheck:select", async () =>
      (await jobsForLinkCheck(db, LINK_CHECK_JOBS)).map((j) => j.id),
    );
    const slices = Math.ceil(linkCheckIds.length / LINK_CHECK_BATCH);
    for (let n = 0; n < slices; n++) {
      const res = await step.do(`linkcheck:${n + 1}`, async () => {
        const before = browser.msUsed;
        const out = await linkCheckSlice(
          db,
          fetcher,
          ai,
          linkCheckIds.slice(n * LINK_CHECK_BATCH, (n + 1) * LINK_CHECK_BATCH),
          browser,
        );
        return { ...out, browserMs: browser.msUsed - before };
      });
      totals.retired += res.linkDead + res.closedPage;
      totals.browserMs += res.browserMs;
      if (res.breakerTripped) {
        breakerNotes.push(`closed_page breaker tripped on slice ${n + 1}`);
      }
    }

    await step.do("finish", async () => {
      const status = anyFailed ? "partial" : "succeeded";
      await finishIngestRun(db, runId, status, totals, breakerNotes.join("; ") || undefined);
    });
  }
}
