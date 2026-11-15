import { describe, expect, it, beforeAll } from "vite-plus/test";
import { extractForJob } from "../src/extract";
import type { AiModels, ExtractAnswer, ExtractResult } from "../src/ai";
import { db, migrate } from "./helpers";

beforeAll(migrate);

type RowOverrides = {
  [K in keyof BaseRow]?: BaseRow[K];
};
interface BaseRow {
  id: string;
  title: string;
  companyName: string;
  locationRaw: string;
  employmentType: string | null;
  descriptionHtml: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  validThrough: Date | null;
}
function row(over: RowOverrides = {}) {
  return {
    id: "job_extract_test",
    title: "Graduate Engineer",
    companyName: "Test Co",
    locationRaw: "Austin, TX",
    employmentType: null,
    descriptionHtml: "<p>desc</p>",
    postedAt: new Date("2026-03-01T00:00:00Z"),
    firstSeenAt: new Date("2026-03-01T00:00:00Z"),
    validThrough: null,
    ...over,
  } as Parameters<typeof extractForJob>[2];
}

function field(value: string | number | null, confidence = 0.9): ExtractAnswer {
  return { value, confidence };
}
function ai(answers: Record<string, ExtractAnswer>, inputTokens = 20): AiModels {
  return {
    async decide() {
      throw new Error("not used");
    },
    async extract(): Promise<ExtractResult> {
      return { answers, inputTokens };
    },
  };
}
const HINTS = { currency: "USD", currencyP: 0.9, period: "YEAR", periodP: 0.9 };

describe("extractForJob", () => {
  it("confidence gate: below 0.8 is ignored", async () => {
    const out = await extractForJob(
      db(),
      ai({ min_years_experience: field(2, 0.79) }),
      row(),
      HINTS,
    );
    expect(out.set.minYearsExperience).toBeUndefined();
  });

  it("years ≥ 3 → rejectedExperience", async () => {
    const out = await extractForJob(db(), ai({ min_years_experience: field(3) }), row(), HINTS);
    expect(out.set.minYearsExperience).toBe(3);
    expect(out.rejectedExperience).toBe(true);
    const low = await extractForJob(db(), ai({ min_years_experience: field(2) }), row(), HINTS);
    expect(low.rejectedExperience).toBe(false);
  });

  it("salary min > max dropped", async () => {
    const out = await extractForJob(
      db(),
      ai({ salary_min: field(90000), salary_max: field(50000) }),
      row(),
      HINTS,
    );
    expect(out.set.salaryMin).toBeUndefined();
  });

  it("salary max > 20×min dropped", async () => {
    const out = await extractForJob(
      db(),
      ai({ salary_min: field(1000), salary_max: field(21000) }),
      row(),
      HINTS,
    );
    expect(out.set.salaryMin).toBeUndefined();
  });

  it("unsupported/none currency drops salary", async () => {
    for (const currency of ["other", "none"]) {
      const out = await extractForJob(
        db(),
        ai({ salary_min: field(50000), salary_max: field(70000) }),
        row(),
        { ...HINTS, currency },
      );
      expect(out.set.salaryMin).toBeUndefined();
    }
  });

  it("low-probability period drops salary", async () => {
    const out = await extractForJob(
      db(),
      ai({ salary_min: field(50000), salary_max: field(70000) }),
      row(),
      { ...HINTS, periodP: 0.6 },
    );
    expect(out.set.salaryMin).toBeUndefined();
  });

  it("sane salary is stored", async () => {
    const out = await extractForJob(
      db(),
      ai({ salary_min: field(50000), salary_max: field(70000) }),
      row(),
      HINTS,
    );
    expect(out.set.salaryMin).toBe(50000);
    expect(out.set.salaryCurrency).toBe("USD");
    expect(out.set.salaryPeriod).toBe("YEAR");
  });

  it("deadline outside window ignored", async () => {
    const out = await extractForJob(
      db(),
      ai({ application_deadline: field("2028-06-01") }),
      row(),
      HINTS,
    );
    expect(out.set.validThrough).toBeUndefined();
    const past = await extractForJob(
      db(),
      ai({ application_deadline: field("2020-01-01") }),
      row(),
      HINTS,
    );
    expect(past.set.validThrough).toBeUndefined();
  });

  it("deadline inside window set; existing validThrough untouched", async () => {
    const out = await extractForJob(
      db(),
      ai({ application_deadline: field("2026-06-01") }),
      row(),
      HINTS,
    );
    expect(out.set.validThrough).toEqual(new Date("2026-06-01T00:00:00Z"));
    const keep = await extractForJob(
      db(),
      ai({ application_deadline: field("2026-06-01") }),
      row({ validThrough: new Date("2026-05-01T00:00:00Z") }),
      HINTS,
    );
    expect(keep.set.validThrough).toBeUndefined();
  });

  it("grad year out of range dropped, in range kept", async () => {
    const cy = new Date().getUTCFullYear();
    const out = await extractForJob(db(), ai({ graduation_year: field(cy - 3) }), row(), HINTS);
    expect(out.set.graduationYear).toBeUndefined();
    const ok = await extractForJob(db(), ai({ graduation_year: field(cy + 1) }), row(), HINTS);
    expect(ok.set.graduationYear).toBe(cy + 1);
  });

  it("Clairic throw leaves fields null and doesn't throw", async () => {
    const failing: AiModels = {
      async decide() {
        throw new Error("x");
      },
      async extract() {
        throw new Error("clairic down");
      },
    };
    const out = await extractForJob(db(), failing, row(), HINTS);
    expect(out.set.minYearsExperience).toBeUndefined();
    expect(out.inputTokens).toBe(0);
    expect(out.rejectedExperience).toBe(false);
  });
});
