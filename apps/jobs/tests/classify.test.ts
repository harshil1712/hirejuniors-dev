import { describe, expect, it, beforeAll } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { job } from "@hirejuniors/db/schema";
import { classifyLevel, classifyStep, isExcluded } from "../src/classify";
import type { AiModels, DecideModel, DecideResult, QuestionAnswer } from "../src/ai";
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
        ? decideResult(accepted("junior", 0.7, 0.9))
        : decideResult(accepted("graduate", 0.85, 0.9)),
    );
    const counts = await classifyStep(db(), models);
    expect(calls).toEqual(["clef-flash", "clef"]);
    expect(counts.classified).toBe(1);
    const j = await getJob(id);
    expect(j.status).toBe("active");
    expect(j.level).toBe("graduate");
    expect(j.classifiedBy).toBe("clef");
  });

  it("sends to review when neither model accepts", async () => {
    const id = await insertJob();
    const { models } = ai(() => decideResult(accepted("junior", 0.62, 0.55)));
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
