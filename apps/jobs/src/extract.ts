// Clairic field extraction — spec §Extraction. All fields nullable; an error
// leaves them null and never throws the step.
import { job } from "@hirejuniors/db/schema";
import { EXTRACT_FIELDS, buildState, type AiModels, type ExtractAnswer } from "./ai";
import type { Db } from "./ingest";

interface JobForExtract {
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

export interface SalaryHints {
  currency?: string;
  currencyP?: number;
  period?: string;
  periodP?: number;
}

export interface ExtractOutcome {
  set: Partial<typeof job.$inferInsert>;
  rejectedExperience: boolean;
  inputTokens: number;
}

function usable(a: ExtractAnswer | undefined): a is ExtractAnswer & { value: string | number } {
  return !!a && a.value !== null && a.value !== undefined && a.confidence >= 0.8;
}

const DAY = 24 * 60 * 60 * 1000;

export async function extractForJob(
  db: Db,
  ai: AiModels,
  row: JobForExtract,
  salaryHints: SalaryHints = {},
): Promise<ExtractOutcome> {
  const set: Partial<typeof job.$inferInsert> = {};
  try {
    const reference = row.postedAt ?? row.firstSeenAt;
    const referenceDate = reference.toISOString().slice(0, 10);
    const state = buildState({
      title: row.title,
      companyName: row.companyName,
      locationRaw: row.locationRaw,
      employmentType: row.employmentType,
      descriptionHtml: row.descriptionHtml,
    });
    const res = await ai.extract(state, EXTRACT_FIELDS, referenceDate);
    const a = res.answers;
    let rejectedExperience = false;

    if (usable(a.min_years_experience)) {
      const years = Number(a.min_years_experience.value);
      if (years >= 0 && years <= 15) {
        set.minYearsExperience = years;
        if (years >= 3) rejectedExperience = true;
      }
    }

    if (usable(a.salary_min) && usable(a.salary_max)) {
      const min = Number(a.salary_min.value);
      const max = Number(a.salary_max.value);
      const currencyOk =
        !!salaryHints.currency &&
        salaryHints.currency !== "other" &&
        salaryHints.currency !== "none" &&
        (salaryHints.currencyP ?? 0) >= 0.7;
      const periodOk =
        !!salaryHints.period && salaryHints.period !== "none" && (salaryHints.periodP ?? 0) >= 0.7;
      if (min > 0 && min <= max && max <= 20 * min && currencyOk && periodOk) {
        set.salaryMin = min;
        set.salaryMax = max;
        set.salaryCurrency = salaryHints.currency;
        set.salaryPeriod = salaryHints.period as "HOUR" | "WEEK" | "MONTH" | "YEAR";
      }
    }

    if (usable(a.application_deadline) && row.validThrough == null) {
      const d = new Date(`${a.application_deadline.value}T00:00:00Z`);
      if (
        !Number.isNaN(d.getTime()) &&
        d.getTime() > reference.getTime() &&
        d.getTime() <= reference.getTime() + 365 * DAY
      ) {
        set.validThrough = d;
      }
    }

    if (usable(a.graduation_year)) {
      const y = Number(a.graduation_year.value);
      const cy = new Date().getUTCFullYear();
      if (y >= cy - 1 && y <= cy + 4) set.graduationYear = y;
    }

    set.extractedAt = new Date();
    return { set, rejectedExperience, inputTokens: res.inputTokens };
  } catch {
    // Clairic error → fields stay null, step continues.
    return { set, rejectedExperience: false, inputTokens: 0 };
  }
}
