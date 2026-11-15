import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { classifyLevel, classifyStep, hasEarlySignal, isExcluded } from "../src/classify";
import type { DecideModel, DecideResult, QuestionAnswer } from "../src/ai";
import { db, migrate, seedCompany, seedSource } from "./helpers";

beforeAll(migrate);

function choice(choice: string, p: number): QuestionAnswer {
  return { type: "choice", choice, probabilities: { [choice]: p } };
}
function noul(p: number): QuestionAnswer {
  return { type: "noul", noul: p };
}
function decideResult(answers: Record<string, QuestionAnswer>, inputTokens = 10): DecideResult {
  return { answers, inputTokens };
}
/** Standard acceptance answers; override per test. */
function accepted(level: string, pLevel = 0.9, pTech = 0.9) {
  return {
    level: choice(level, pLevel),
    is_tech: noul(pTech),
    workplace: choice("remote", 0.9),
    salary_currency: choice("USD", 0.9),
    salary_period: choice("YEAR", 0.9),
  };
}
/** Level answer with an explicit full probability distribution. */
function levelAns(choiceName: string, probabilities: Record<string, number>): QuestionAnswer {
  return { type: "choice", choice: choiceName, probabilities };
}

function ai(decideImpl: (model: DecideModel) => DecideResult, extractImpl?: () => never) {
  const calls: DecideModel[] = [];
  return {
    calls,
    models: {
      async decide(model: DecideModel) {
        calls.push(model);
        return decideImpl(model);
      },
      async extract() {
        if (extractImpl) return extractImpl();
        return { answers: {}, inputTokens: 5 };
      },
    },
  };
}

async function insertJob(over: Partial<typeof job.$inferInsert> = {}) {
  const now = new Date();
  const id = `job_${Math.random().toString(36).slice(2, 14)}`;
  await db()
    .insert(job)
    .values({
      id,
      slug: id,
      externalId: `ext-${id}`,
      sourceId: "src_test00000001",
      companyId: "cmp_test00000001",
      title: "Graduate Engineer",
      locationRaw: "Austin, TX",
      descriptionText: "text",
      applyUrl: `https://example.com/${id}`,
      contentHash: `h-${id}`,
      status: "pending",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  return id;
}
async function getJob(id: string) {
  return (await db().select().from(job).where(eq(job.id, id)))[0];
}

describe("hasEarlySignal (spec §Classification title gate)", () => {
  const yes = [
    "Software Engineer Intern",
    "New Grad SWE",
    "Software Engineer I",
    "Data Analyst 1",
    "Associate Software Engineer",
    "Working Student",
    "Graduate Developer",
  ];
  const no = [
    "Software Engineer",
    "Software Engineer II",
    "Internal Tools Engineer",
    "International Sales",
    "Product Designer",
  ];
  for (const t of yes) it(`yes: ${t}`, () => expect(hasEarlySignal(t)).toBe(true));
  for (const t of no) it(`no: ${t}`, () => expect(hasEarlySignal(t)).toBe(false));
});

describe("rules", () => {
  const cases: [string, string | undefined, string | null][] = [
    ["Software Engineer Intern", undefined, "internship"],
    ["Software Engineer Co-op", undefined, "internship"],
    ["Working Student — Data", undefined, "internship"],
    ["Senior Software Engineer", undefined, null],
    ["Graduate Data Analyst", undefined, "graduate"],
    ["Junior Frontend Developer", undefined, "junior"],
    ["Apprentice Network Engineer", undefined, "apprenticeship"],
    ["Software Engineer", "INTERN", "internship"],
    ["Software Engineer", "FULL_TIME", null],
  ];
  for (const [title, hint, expected] of cases) {
    it(`${title}${hint ? ` (${hint})` : ""} → ${expected}`, () => {
      expect(classifyLevel(title, hint)).toBe(expected);
    });
  }

  it("exclusions fire on seniority keywords", () => {
    expect(isExcluded("Senior Backend Engineer")).toBe(true);
    expect(isExcluded("Staff Platform Engineer")).toBe(true);
    expect(isExcluded("VP of Engineering")).toBe(true);
    expect(isExcluded("Head of Design")).toBe(true);
  });

  it("early-career exception rescues seniority titles", () => {
    expect(isExcluded("Sales Lead Intern")).toBe(false);
    expect(isExcluded("Engineering Manager, Early Career")).toBe(false);
    // junior isn't in the exception list — still excluded
    expect(isExcluded("Lead Junior Designer")).toBe(true);
  });
});

describe("classifyStep", () => {
  it("accepts on flash", async () => {
    await seedCompany();
    await seedSource();
    const id = await insertJob();
    const { models, calls } = ai(() => decideResult(accepted("junior")));
    const counts = await classifyStep(db(), models);
    expect(counts.classified).toBe(1);
    expect(calls).toEqual(["clef-flash"]);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.level).toBe("junior");
    expect(j.classifiedBy).toBe("clef-flash");
  });

  it("escalates to clef and accepts", async () => {
    const id = await insertJob();
    const { models, calls } = ai((m) =>
      m === "clef-flash"
        ? decideResult({
            ...accepted("junior", 0.55, 0.9),
            level: levelAns("junior", { junior: 0.55, graduate: 0.1, not_early_career: 0.3 }),
          })
        : decideResult({
            ...accepted("graduate", 0.75, 0.9),
            level: levelAns("graduate", { graduate: 0.75, not_early_career: 0.2 }),
          }),
    );
    const counts = await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    expect(counts.classified).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.level).toBe("graduate");
    expect(j.classifiedBy).toBe("clef");
  });

  it("split junior/graduate with low not_early_career → accepts on flash (pLevel = 1 − nec)", async () => {
    const id = await insertJob();
    const { models, calls } = ai(() =>
      decideResult({
        ...accepted("junior", 0.5, 0.95),
        level: levelAns("junior", { junior: 0.5, graduate: 0.44, not_early_career: 0.04 }),
      }),
    );
    const counts = await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash"]); // no clef escalation
    expect(counts.classified).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.level).toBe("junior");
    expect(j.classifiedBy).toBe("clef-flash");
  });

  it("sends to review when neither model accepts", async () => {
    const id = await insertJob();
    const { models } = ai(() =>
      decideResult({
        ...accepted("junior", 0.62, 0.55),
        level: levelAns("junior", { junior: 0.6, not_early_career: 0.38 }),
      }),
    );
    const counts = await classifyStep(db(), models);
    expect(counts.review).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("review");
    expect(j.level).toBe("junior"); // best guess
    expect(j.classifiedBy).toBe("clef");
    expect(j.reviewReason).toBe("level p=0.62, tech p=0.55");
  });

  it("review leaves level null when best guess is not_early_career", async () => {
    const id = await insertJob();
    const { models } = ai(() => decideResult(accepted("not_early_career", 0.62, 0.55)));
    await classifyStep(db(), models);
    const j = await getJob(id);
    expect(j.status).toBe("review");
    expect(j.level).toBeNull();
  });

  it("rejects accepted not_early_career", async () => {
    const id = await insertJob();
    const { models } = ai(() => decideResult(accepted("not_early_career", 0.9, 0.9)));
    const counts = await classifyStep(db(), models);
    expect(counts.rejected).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("rejected");
    expect(j.rejectReason).toBe("not_early_career");
    expect(j.descriptionHtml).toBeNull();
  });

  it("rejects low-tech", async () => {
    const id = await insertJob();
    const { models } = ai(() => decideResult(accepted("junior", 0.9, 0.1)));
    const counts = await classifyStep(db(), models);
    expect(counts.rejected).toBe(1);
    expect((await getJob(id)).rejectReason).toBe("not_tech");
  });

  it("include_all uses rules with no AI call", async () => {
    await seedSource({ id: "src_includeall01", includeAll: true });
    const id = await insertJob({ sourceId: "src_includeall01", title: "Unlabeled Role" });
    const { models, calls } = ai(() => decideResult(accepted("junior")));
    const counts = await classifyStep(db(), models);
    expect(calls).toEqual([]);
    expect(counts.classified).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.level).toBe("graduate"); // fallback
    expect(j.classifiedBy).toBe("rules");
  });

  it("workplace fills only when null and p ≥ 0.70", async () => {
    const id = await insertJob({ workplace: null });
    const { models } = ai(() =>
      decideResult({ ...accepted("junior"), workplace: choice("hybrid", 0.65) }),
    );
    await classifyStep(db(), models);
    expect((await getJob(id)).workplace).toBeNull();

    const id2 = await insertJob({ workplace: null });
    const { models: m2 } = ai(() =>
      decideResult({ ...accepted("junior"), workplace: choice("hybrid", 0.8) }),
    );
    await classifyStep(db(), m2);
    expect((await getJob(id2)).workplace).toBe("hybrid");

    const id3 = await insertJob({ workplace: "remote" });
    const { models: m3 } = ai(() =>
      decideResult({ ...accepted("junior"), workplace: choice("onsite", 0.95) }),
    );
    await classifyStep(db(), m3);
    expect((await getJob(id3)).workplace).toBe("remote");
  });
});

describe("decision rules (spec §Classification step 3)", () => {
  it("flash not_early_career p=0.85 with tech 0.5 → rejected, no clef call", async () => {
    await insertJob({ id: "job_r1" });
    const { models, calls } = ai(() => decideResult(accepted("not_early_career", 0.85, 0.5)));
    const counts = await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash"]);
    expect(counts.rejected).toBe(1);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r1"));
    expect(j.status).toBe("rejected");
    expect(j.rejectReason).toBe("not_early_career");
    expect(j.classifiedBy).toBe("clef-flash");
    expect(j.classifierConfidence).toBeCloseTo(0.85);
  });

  it("flash tech 0.1 with level p=0.4 → rejected not_tech, no clef call", async () => {
    await insertJob({ id: "job_r2" });
    const { models, calls } = ai(() => decideResult(accepted("junior", 0.4, 0.1)));
    await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash"]);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r2"));
    expect(j.status).toBe("rejected");
    expect(j.rejectReason).toBe("not_tech");
    expect(j.classifierConfidence).toBeCloseTo(0.9);
  });

  it("flash undecided → clef rule 3 decides", async () => {
    await insertJob({ id: "job_r3" });
    const { models, calls } = ai((m) =>
      decideResult(
        m === "clef-flash" ? accepted("junior", 0.75, 0.5) : accepted("graduate", 0.8, 0.75),
      ),
    );
    await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r3"));
    expect(j.status).toBe("active");
    expect(j.level).toBe("graduate");
    expect(j.classifiedBy).toBe("clef");
    expect(j.classifierConfidence).toBeCloseTo(0.75);
  });

  it("flash undecided → clef rule 1 rejects", async () => {
    await insertJob({ id: "job_r4" });
    const { models, calls } = ai((m) =>
      decideResult(
        m === "clef-flash" ? accepted("junior", 0.5, 0.5) : accepted("not_early_career", 0.72, 0.4),
      ),
    );
    await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r4"));
    expect(j.status).toBe("rejected");
    expect(j.rejectReason).toBe("not_early_career");
    expect(j.classifiedBy).toBe("clef");
  });

  it("flash undecided → clef rule 2 rejects", async () => {
    await insertJob({ id: "job_r5" });
    const { models, calls } = ai((m) =>
      decideResult(
        m === "clef-flash" ? accepted("junior", 0.6, 0.5) : accepted("junior", 0.5, 0.2),
      ),
    );
    await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r5"));
    expect(j.status).toBe("rejected");
    expect(j.rejectReason).toBe("not_tech");
    expect(j.classifierConfidence).toBeCloseTo(0.8);
  });

  it("clef undecided → review, null confidence, classified_by clef", async () => {
    await insertJob({ id: "job_r6" });
    const { models, calls } = ai(() => decideResult(accepted("junior", 0.5, 0.5)));
    await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    const [j] = await db().select().from(job).where(eq(job.id, "job_r6"));
    expect(j.status).toBe("review");
    expect(j.classifiedBy).toBe("clef");
    expect(j.classifierConfidence).toBeNull();
  });
});

describe("buildState — 6000-char body (spec §Classification state)", () => {
  it("includes description text beyond char 500", async () => {
    const { buildState } = await import("../src/ai");
    const deep = "<p>intro</p><p>" + "y".repeat(900) + "DEEP-MARKER</p>";
    const state = buildState({
      title: "T",
      companyName: "C",
      locationRaw: "L",
      employmentType: null,
      descriptionHtml: deep,
    });
    expect(state).toContain("DEEP-MARKER");
  });
});
