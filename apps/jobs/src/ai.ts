// Typed wrappers over the Workers AI binding — the test seam (spec §Layout).
// Tests pass a hand-written fake; no module mocking.
import { htmlToText } from "./html";

export type DecideModel = "clef-flash" | "clef";

export type QuestionAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "noul"; noul: number };

export interface DecideResult {
  answers: Record<string, QuestionAnswer>;
  inputTokens: number;
}

export interface ExtractAnswer {
  value: string | number | null;
  confidence: number;
  p_null?: number;
}

export interface ExtractResult {
  answers: Record<string, ExtractAnswer>;
  inputTokens: number;
}

export interface DecideQuestion {
  type: "choice" | "noul";
  instructions: string;
  criteria?: Record<string, string>;
}
export type DecideQuestions = Record<string, DecideQuestion>;
export interface ExtractField {
  type: string;
  instructions: string;
  decimals?: number;
}
export type ExtractFields = Record<string, ExtractField>;

export interface AiModels {
  decide(model: DecideModel, state: string, questions: DecideQuestions): Promise<DecideResult>;
  extract(state: string, fields: ExtractFields, referenceDate: string): Promise<ExtractResult>;
}

// Narrow response shapes — workers-types may not know these models yet.
interface RawDecide {
  answers?: Record<string, QuestionAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const MODEL_IDS: Record<DecideModel, string> = {
  "clef-flash": "@cf/cloudflare/clef-flash",
  clef: "@cf/cloudflare/clef",
};

export interface AiRunInput {
  model: string;
  state: string;
  questions?: DecideQuestions;
  fields?: ExtractFields;
  reference_date?: string;
}

export interface AiRunBinding {
  run(model: string, input: AiRunInput): Promise<RawDecide>;
}
export function aiBinding(ai: AiRunBinding): AiModels {
  return {
    async decide(model, state, questions) {
      const res = (await ai.run(MODEL_IDS[model], { model, state, questions })) as RawDecide;
      return {
        answers: res.answers ?? {},
        inputTokens: res.usage?.input_tokens ?? 0,
      };
    },
    async extract(state, fields, referenceDate) {
      const res = (await ai.run("@cf/cloudflare/clairic", {
        model: "clairic",
        state,
        fields,
        reference_date: referenceDate,
      })) as RawDecide & { answers?: Record<string, ExtractAnswer> };
      return {
        answers: (res.answers ?? {}) as Record<string, ExtractAnswer>,
        inputTokens: res.usage?.input_tokens ?? 0,
      };
    },
  };
}

/** The `state` text every classify/extract call shares (spec §Classification). */
export function buildState(input: {
  title: string;
  companyName: string;
  locationRaw: string;
  employmentType: string | null;
  descriptionHtml: string | null;
}): string {
  const body = htmlToText(input.descriptionHtml ?? "", 6000);
  return [
    `Title: ${input.title}`,
    `Company: ${input.companyName}`,
    `Location: ${input.locationRaw}`,
    `Employment type: ${input.employmentType ?? "unknown"}`,
    "",
    body,
  ].join("\n");
}

// --- Verbatim spec JSON (docs/specs/ingest.md) — do not reword. ---

export const DECIDE_QUESTIONS = {
  level: {
    type: "choice",
    instructions: "What seniority is this job aimed at?",
    criteria: {
      internship: "Internship, co-op, working student or placement for students",
      apprenticeship: "Apprenticeship with on-the-job training",
      graduate: "Graduate scheme, new-grad or entry-level role for recent graduates",
      junior: "Junior role open to people with roughly 0-2 years of experience",
      not_early_career:
        "Requires more than about 2 years of experience, or is mid-level, senior or leadership",
    },
  },
  is_tech: {
    type: "noul",
    instructions:
      "Is this a technology role, such as software, data, machine learning, infrastructure, security, IT, QA, hardware, technical product or technical design?",
  },
  workplace: {
    type: "choice",
    instructions: "Where is the work done?",
    criteria: {
      onsite: "At the employer's office or site",
      hybrid: "Split between office and home",
      remote: "Fully remote",
      unclear: "The posting does not say",
    },
  },
  salary_currency: {
    type: "choice",
    instructions: "In which currency is pay stated?",
    criteria: {
      USD: "US dollars",
      EUR: "Euros",
      GBP: "British pounds",
      CAD: "Canadian dollars",
      AUD: "Australian dollars",
      INR: "Indian rupees",
      SGD: "Singapore dollars",
      other: "Another currency",
      none: "Pay is not stated",
    },
  },
  salary_period: {
    type: "choice",
    instructions: "What period does the stated pay cover?",
    criteria: {
      YEAR: "Per year",
      MONTH: "Per month",
      WEEK: "Per week",
      HOUR: "Per hour",
      none: "Pay is not stated",
    },
  },
} as const;

export const EXTRACT_FIELDS = {
  salary_min: {
    type: "number",
    decimals: 0,
    instructions:
      "Lowest stated pay amount for this role, as a plain number. Null if pay is not stated.",
  },
  salary_max: {
    type: "number",
    decimals: 0,
    instructions:
      "Highest stated pay amount for this role, as a plain number. Same as the lowest if only one amount is given. Null if pay is not stated.",
  },
} as const;
