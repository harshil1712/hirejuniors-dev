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
}

export interface SalaryHints {
  currency?: string;
  currencyP?: number;
  period?: string;
  periodP?: number;
}

export interface ExtractOutcome {
  set: Partial<typeof job.$inferInsert>;
  inputTokens: number;
}

function usable(a: ExtractAnswer | undefined): a is ExtractAnswer & { value: string | number } {
  return !!a && a.value !== null && a.value !== undefined && a.confidence >= 0.8;
}

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

    set.extractedAt = new Date();
    return { set, inputTokens: res.inputTokens };
  } catch {
    // Clairic error → fields stay null, step continues.
    return { set, inputTokens: 0 };
  }
}
