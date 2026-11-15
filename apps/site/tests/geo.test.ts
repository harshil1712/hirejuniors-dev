import { describe, it, expect } from "vite-plus/test";
import { countrySlug, countryCodeFromSlug, countryName } from "../src/lib/countries";
import { levelSlug, levelFromSlug } from "../src/lib/levels";
import { jobTitle, jobDescription } from "../src/lib/meta";

describe("country slug ↔ code", () => {
  it("US round-trips", () => {
    expect(countrySlug("US")).toBe("united-states");
    expect(countryCodeFromSlug("united-states")).toBe("US");
  });
  it("GB → united-kingdom", () => {
    expect(countrySlug("GB")).toBe("united-kingdom");
    expect(countryCodeFromSlug("united-kingdom")).toBe("GB");
  });
  it("DE round-trips", () => {
    expect(countrySlug("DE")).toBe("germany");
    expect(countryCodeFromSlug("germany")).toBe("DE");
  });
  it("CI / Côte d'Ivoire produces an ASCII slug", () => {
    const slug = countrySlug("CI");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(countryName("CI").toLowerCase()).toContain("ivoire");
    expect(countryCodeFromSlug(slug)).toBe("CI");
  });
  it("unknown slug → null", () => {
    expect(countryCodeFromSlug("nope-land")).toBeNull();
  });
});

describe("level slugs", () => {
  it("maps all four hubs", () => {
    expect(levelSlug("internship")).toBe("internships");
    expect(levelSlug("apprenticeship")).toBe("apprenticeships");
    expect(levelSlug("graduate")).toBe("graduate");
    expect(levelSlug("junior")).toBe("junior");
    expect(levelFromSlug("internships")).toBe("internship");
    expect(levelFromSlug("apprenticeships")).toBe("apprenticeship");
  });
  it("unknown → null", () => {
    expect(levelFromSlug("senior")).toBeNull();
  });
});

describe("meta rules", () => {
  it("title adds place only while <= 70 chars", () => {
    expect(jobTitle("Intern", "Acme", "Berlin")).toBe("Intern at Acme — Berlin");
    const long = "x".repeat(55);
    const t = jobTitle(long, "Acme", "A very long place name here");
    expect(t).toBe(`${long} at Acme`);
    expect(t.length).toBeLessThanOrEqual(70);
  });
  it("description truncates near 155 chars", () => {
    const d = jobDescription("word ".repeat(60));
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
  });
});
