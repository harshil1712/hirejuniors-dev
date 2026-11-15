// Junior-level classification — spec §Classification.
// Word-boundary, case-insensitive keyword pre-filter, then a model decision
// (clef-flash → clef escalation) for everything stored as pending.
import { and, asc, eq, inArray, or, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { job, source } from "@hirejuniors/db/schema";
import { chunks } from "@hirejuniors/db/queries";
import type { Db } from "./ingest";
import {
  DECIDE_QUESTIONS,
  buildState,
  type AiModels,
  type DecideModel,
  type QuestionAnswer,
} from "./ai";
import { extractForJob } from "./extract";

export type Level = "internship" | "apprenticeship" | "graduate" | "junior";

const EXCLUDED = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|chief)\b/i;

const RULES: [level: Level, pattern: RegExp][] = [
  ["internship", /\b(intern|interns|internship|co-?op|working students?|placements?)\b/i],
  ["apprenticeship", /\bapprentice(ship)?s?\b/i],
  [
    "graduate",
    /\b(graduate|graduates|new grads?|university grads?|early career|campus|entry[- ]levels?)\b/i,
  ],
  ["junior", /\b(junior|jr\.?)\b/i],
];

// Early-career patterns that rescue a title from the exclusion filter —
// "Sales Lead Intern"-style postings stay (spec §1 exception).
const EARLY_CAREER = new RegExp(
  RULES.slice(0, 3)
    .map(([, p]) => p.source)
    .join("|"),
  "i",
);

/** Seniority keywords that disqualify a listing — dropped, never stored. */
export function isExcluded(title: string): boolean {
  return EXCLUDED.test(title) && !EARLY_CAREER.test(title);
}

const EARLY_SIGNAL = new RegExp(
  [
    ...RULES.map(([, p]) => p.source),
    String.raw`\b(trainee|students?|associates?|fellow(ship)?s?|residency|university)\b`,
    String.raw`\b(engineer|developer|analyst|scientist|designer)\s+(i|1)\b`,
  ].join("|"),
  "i",
);

/** Spec §Classification 1 — early-career title gate (non-include_all sources). */
export function hasEarlySignal(title: string): boolean {
  return EARLY_SIGNAL.test(title);
}

/** Match a title (+ optional employmentType hint) to a junior level. */
export function classifyLevel(title: string, employmentTypeHint?: string): Level | null {
  for (const [level, pattern] of RULES) {
    if (pattern.test(title)) return level;
  }
  if (employmentTypeHint === "INTERN") return "internship";
  return null;
}

export interface ClassifyCounts {
  classified: number;
  rejected: number;
  review: number;
  inputTokens: number;
}

function choice(a: QuestionAnswer | undefined): { choice: string; p: number } | null {
  if (!a || a.type !== "choice") return null;
  return { choice: a.choice, p: a.probabilities[a.choice] ?? 0 };
}
/** Spec §Classification 3 — early-career vs not; the level is only the label. */
function levelChoice(a: QuestionAnswer | undefined): { choice: string; p: number } | null {
  const c = choice(a);
  if (!c || c.choice === "not_early_career" || a?.type !== "choice") return c;
  return { choice: c.choice, p: 1 - (a.probabilities.not_early_career ?? 0) };
}
function noul(a: QuestionAnswer | undefined): number | null {
  return a && a.type === "noul" ? a.noul : null;
}

/** One classify step: take up to `limit` queue rows, oldest first. */
export async function classifyStep(db: Db, ai: AiModels, limit = 20): Promise<ClassifyCounts> {
  const rows = await db
    .select({
      id: job.id,
      title: job.title,
      status: job.status,
      level: job.level,
      workplace: job.workplace,
      locationRaw: job.locationRaw,
      employmentType: job.employmentType,
      descriptionHtml: job.descriptionHtml,
      applyUrl: job.applyUrl,
      postedAt: job.postedAt,
      firstSeenAt: job.firstSeenAt,
      validThrough: job.validThrough,
      sourceId: job.sourceId,
      includeAll: source.includeAll,
      companyName: sql<string>`c.name`,
    })
    .from(job)
    .innerJoin(source, eq(job.sourceId, source.id))
    .innerJoin(sql`company c`, sql`c.id = ${source.companyId}`)
    .where(or(eq(job.status, "pending"), and(eq(job.status, "active"), isNull(job.classifiedAt))))
    .orderBy(asc(job.firstSeenAt))
    .limit(limit);

  const counts: ClassifyCounts = { classified: 0, rejected: 0, review: 0, inputTokens: 0 };
  const statements: BatchItem<"sqlite">[] = [];
  const now = new Date();

  for (const row of rows) {
    const state = buildState({
      title: row.title,
      companyName: row.companyName,
      locationRaw: row.locationRaw,
      employmentType: row.employmentType,
      descriptionHtml: row.descriptionHtml,
    });
    const set: Partial<typeof job.$inferInsert> = { updatedAt: now };

    if (row.includeAll) {
      // §2 — rules only, never Clef. (Clairic still runs below.)
      set.status = "active";
      set.level = classifyLevel(row.title, row.employmentType ?? undefined) ?? "graduate";
      set.classifiedBy = "rules";
      set.classifiedAt = now;
      counts.classified++;
    } else {
      const decided = await decideJob(ai, row, state);
      counts.inputTokens += decided.inputTokens;
      Object.assign(set, decided.set);
      if (decided.outcome === "active") counts.classified++;
      else if (decided.outcome === "rejected") counts.rejected++;
      else counts.review++;
      // Extraction only for active/review (spec §Extraction).
      if (decided.outcome === "active" || decided.outcome === "review") {
        const ex = await extractForJob(db, ai, row, decided.salaryHints);
        counts.inputTokens += ex.inputTokens;
        Object.assign(set, ex.set);
        if (ex.rejectedExperience) {
          set.status = "rejected";
          set.rejectReason = "experience";
          set.descriptionHtml = null;
          if (decided.outcome === "active") counts.classified--;
          else counts.review--;
          counts.rejected++;
        }
      }
      if (decided.outcome === "rejected") set.descriptionHtml = null;
    }
    statements.push(db.update(job).set(set).where(eq(job.id, row.id)));
  }
  for (const chunk of chunks(statements, 25)) {
    await db.batch(chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
  return counts;
}

interface Decided {
  outcome: "active" | "rejected" | "review";
  set: Partial<typeof job.$inferInsert>;
  salaryHints: { currency?: string; currencyP?: number; period?: string; periodP?: number };
  inputTokens: number;
}

async function decideJob(
  ai: AiModels,
  row: { title: string; workplace: string | null },
  state: string,
): Promise<Decided> {
  let model: DecideModel = "clef-flash";
  let res = await ai.decide(model, state, DECIDE_QUESTIONS);
  let inputTokens = res.inputTokens;
  let pLevel = levelChoice(res.answers.level);
  let pTech = noul(res.answers.is_tech);
  // Spec §Classification step 3 — the same 4 ordered rules evaluated with
  // per-model thresholds; the first rule that fires decides.
  let rule = evalDecision(pLevel, pTech, 0.8, 0.8, 0.2);

  if (rule.outcome === "undecided") {
    model = "clef";
    res = await ai.decide(model, state, DECIDE_QUESTIONS);
    inputTokens += res.inputTokens;
    pLevel = levelChoice(res.answers.level);
    pTech = noul(res.answers.is_tech);
    rule = evalDecision(pLevel, pTech, 0.7, 0.7, 0.3);
  }

  const set: Partial<typeof job.$inferInsert> = {
    classifiedBy: model,
    classifiedAt: new Date(),
  };
  const salaryHints: Decided["salaryHints"] = {};
  const cur = choice(res.answers.salary_currency);
  if (cur) {
    salaryHints.currency = cur.choice;
    salaryHints.currencyP = cur.p;
  }
  const per = choice(res.answers.salary_period);
  if (per) {
    salaryHints.period = per.choice;
    salaryHints.periodP = per.p;
  }
  const wp = choice(res.answers.workplace);
  // workplace fills only when null, answer isn't `unclear`, p ≥ 0.70.
  if (wp && wp.choice !== "unclear" && wp.p >= 0.7 && row.workplace == null) {
    set.workplace = wp.choice as "onsite" | "hybrid" | "remote";
  }

  if (rule.outcome === "undecided") {
    const guess = pLevel?.choice && pLevel.choice !== "not_early_career" ? pLevel.choice : null;
    set.status = "review";
    set.level = (guess as Level | null) ?? null;
    set.reviewReason = `level p=${(pLevel?.p ?? 0).toFixed(2)}, tech p=${(pTech ?? 0).toFixed(2)}`;
    return { outcome: "review", set, salaryHints, inputTokens };
  }

  // classifier_confidence = the probability of the rule that fired.
  set.classifierConfidence = rule.confidence;
  if (rule.outcome === "rejected") {
    set.status = "rejected";
    set.rejectReason = rule.rejectReason;
    return { outcome: "rejected", set, salaryHints, inputTokens };
  }
  set.status = "active";
  set.level = rule.level;
  return { outcome: "active", set, salaryHints, inputTokens };
}

type Decision =
  | { outcome: "rejected"; rejectReason: "not_early_career" | "not_tech"; confidence: number }
  | { outcome: "active"; level: Level; confidence: number }
  | { outcome: "undecided" };

/** The 4 ordered spec rules. Rule 1 (confident not_early_career) fires
 * before tech; rule 2 (confident not-tech) before a level check; rule 3
 * needs confident level AND tech. */
function evalDecision(
  pLevel: { choice: string; p: number } | null,
  pTech: number | null,
  T: number,
  techHigh: number,
  techLow: number,
): Decision {
  if (pLevel && pLevel.choice === "not_early_career" && pLevel.p >= T) {
    return { outcome: "rejected", rejectReason: "not_early_career", confidence: pLevel.p };
  }
  if (pTech !== null && pTech <= techLow) {
    return { outcome: "rejected", rejectReason: "not_tech", confidence: 1 - pTech };
  }
  if (
    pLevel &&
    pLevel.choice !== "not_early_career" &&
    pLevel.p >= T &&
    pTech !== null &&
    pTech >= techHigh
  ) {
    return {
      outcome: "active",
      level: pLevel.choice as Level,
      confidence: Math.min(pLevel.p, pTech),
    };
  }
  return { outcome: "undecided" };
}
