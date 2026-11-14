import { describe, expect, it } from "vite-plus/test";
import { classifyLevel, isExcluded } from "../src/classify";

describe("classifyLevel", () => {
  const cases: [title: string, hint: string | undefined, expected: string | null][] = [
    ["Software Engineer Intern", undefined, "internship"],
    ["Engineering Internship, Summer 2027", undefined, "internship"],
    ["Software Engineer Co-op", undefined, "internship"],
    ["Working Student — Data", undefined, "internship"],
    ["Senior Software Engineer", undefined, null],
    ["Sr Backend Engineer", undefined, null],
    ["Staff Platform Engineer", undefined, null],
    ["Engineering Manager, Early Career", undefined, null],
    ["Graduate Data Analyst", undefined, "graduate"],
    ["New Grad Software Engineer", undefined, "graduate"],
    ["Junior Frontend Developer", undefined, "junior"],
    ["Jr. Frontend Developer", undefined, "junior"],
    ["Apprentice Network Engineer", undefined, "apprenticeship"],
    ["Software Engineering Apprenticeship", undefined, "apprenticeship"],
    ["Software Engineer", "INTERN", "internship"],
    ["Software Engineer", undefined, null],
    ["Software Engineer", "FULL_TIME", null],
    ["Lead Junior Designer", undefined, null],
    ["VP of Internships", undefined, null],
  ];
  for (const [title, hint, expected] of cases) {
    it(`${title}${hint ? ` (${hint})` : ""} → ${expected}`, () => {
      expect(classifyLevel(title, hint)).toBe(expected);
    });
  }

  it("exclusions win over level keywords", () => {
    expect(isExcluded("Engineering Manager, Early Career")).toBe(true);
    expect(classifyLevel("Engineering Manager, Early Career")).toBe(null);
  });
});
