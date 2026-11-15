import { describe, it, expect } from "vite-plus/test";
import { buildJobPosting, type JobPostingInput } from "../src/lib/job-posting";

const base: JobPostingInput = {
  slug: "acme-grad-engineer-a1b2c3",
  title: "Graduate Engineer",
  level: "graduate",
  employmentType: "FULL_TIME",
  workplace: "onsite",
  locationRaw: "Berlin, Germany",
  city: "Berlin",
  region: null,
  countryCode: "DE",
  countryName: "Germany",
  descriptionHtml: "<p>Build <strong>things</strong>.</p>",
  descriptionText: "Build things.",
  postedAt: new Date("2026-11-01T00:00:00Z"),
  firstSeenAt: new Date("2026-10-28T00:00:00Z"),
  validThrough: null,
  externalId: "ext-9",
  canonicalUrl: "https://hirejuniors.dev/job/acme-grad-engineer-a1b2c3/",
  company: {
    name: "Acme",
    homepageUrl: "https://acme.example",
    logoUrl: "https://acme.example/logo.png",
  },
};

describe("buildJobPosting", () => {
  it("full active job carries every expected field", () => {
    const jp = buildJobPosting(base);
    expect(jp["@type"]).toBe("JobPosting");
    expect(jp.title).toBe("Graduate Engineer");
    expect(jp.description).toContain("<strong>things</strong>");
    expect(jp.datePosted).toBe("2026-11-01");
    expect(jp.validThrough).toBe("2027-01-30T00:00:00.000Z");
    expect(jp.employmentType).toBe("FULL_TIME");
    expect(jp.hiringOrganization).toEqual({
      "@type": "Organization",
      name: "Acme",
      sameAs: "https://acme.example",
      logo: "https://acme.example/logo.png",
    });
    expect(jp.identifier).toEqual({
      "@type": "PropertyValue",
      name: "Acme",
      value: "ext-9",
    });
    expect(jp.directApply).toBe(false);
    expect(jp.url).toBe(base.canonicalUrl);
    const loc = jp.jobLocation;
    expect(loc?.["@type"]).toBe("Place");
    expect(loc?.address["@type"]).toBe("PostalAddress");
    expect(loc?.address.addressLocality).toBe("Berlin");
    expect(loc?.address.addressCountry).toBe("DE");
    expect(jp.jobLocationType).toBeUndefined();
  });

  it("remote job with country gets TELECOMMUTE + applicantLocationRequirements", () => {
    const jp = buildJobPosting({ ...base, workplace: "remote" });
    expect(jp.jobLocationType).toBe("TELECOMMUTE");
    expect(jp.applicantLocationRequirements).toEqual({
      "@type": "Country",
      name: "Germany",
    });
    expect(jp.jobLocation).toBeUndefined();
  });

  it("missing posted_at uses first_seen_at; validThrough defaults to +90d", () => {
    const jp = buildJobPosting({ ...base, postedAt: null });
    expect(jp.datePosted).toBe("2026-10-28");
    expect(jp.validThrough).toBe("2027-01-26T00:00:00.000Z");
  });

  it("explicit valid_through wins over the 90-day default", () => {
    const jp = buildJobPosting({
      ...base,
      validThrough: new Date("2026-12-01T00:00:00Z"),
    });
    expect(jp.validThrough).toBe("2026-12-01T00:00:00.000Z");
  });

  it("null homepage/logo are omitted from hiringOrganization", () => {
    const jp = buildJobPosting({
      ...base,
      company: { name: "Acme", homepageUrl: null, logoUrl: null },
    });
    expect(jp.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme" });
  });

  it("internship without employment_type defaults to INTERN", () => {
    const jp = buildJobPosting({ ...base, level: "internship", employmentType: null });
    expect(jp.employmentType).toBe("INTERN");
  });

  it("non-internship without employment_type omits the field", () => {
    const jp = buildJobPosting({ ...base, employmentType: null });
    expect("employmentType" in jp).toBe(false);
  });

  it("falls back to description_text when html is absent", () => {
    const jp = buildJobPosting({ ...base, descriptionHtml: null });
    expect(jp.description).toBe("Build things.");
  });

  it("emits baseSalary when all four fields are present", () => {
    const jp = buildJobPosting({
      ...base,
      salaryMin: 55000,
      salaryMax: 70000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
    });
    expect(jp.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: {
        "@type": "QuantitativeValue",
        minValue: 55000,
        maxValue: 70000,
        unitText: "YEAR",
      },
    });
  });

  it("omits baseSalary when any salary field is missing", () => {
    for (const patch of [
      { salaryMin: 55000, salaryMax: 70000, salaryCurrency: "EUR" }, // no period
      { salaryMin: 55000, salaryCurrency: "EUR", salaryPeriod: "YEAR" as const }, // no max
      { salaryMax: 70000, salaryCurrency: "EUR", salaryPeriod: "YEAR" as const },
      { salaryMin: 55000, salaryMax: 70000, salaryPeriod: "YEAR" as const }, // no currency
    ]) {
      const jp = buildJobPosting({ ...base, ...patch });
      expect("baseSalary" in jp).toBe(false);
    }
  });
});
