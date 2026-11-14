// schema.org JobPosting builder — pure function, fully unit-tested.
import { sanitizeDescription } from "./sanitize";

export interface JobPostingInput {
  slug: string;
  title: string;
  level: string;
  employmentType: string | null;
  workplace: string | null;
  locationRaw: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  countryName?: string | null;
  descriptionHtml: string | null;
  descriptionText: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  validThrough: Date | null;
  externalId: string;
  canonicalUrl: string;
  company: { name: string; homepageUrl: string | null; logoUrl: string | null };
}

export interface JobPosting {
  "@type": "JobPosting";
  title: string;
  description: string;
  datePosted: string;
  validThrough: string;
  hiringOrganization: {
    "@type": "Organization";
    name: string;
    sameAs?: string;
    logo?: string;
  };
  identifier: { "@type": "PropertyValue"; name: string; value: string };
  directApply: false;
  url: string;
  employmentType?: string;
  jobLocationType?: "TELECOMMUTE";
  applicantLocationRequirements?: { "@type": "Country"; name: string };
  jobLocation?: {
    "@type": "Place";
    address: {
      "@type": "PostalAddress";
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
}

const DAY = 24 * 60 * 60 * 1000;

export function buildJobPosting(j: JobPostingInput): JobPosting {
  const seen = j.postedAt ?? j.firstSeenAt;
  const validThrough = j.validThrough ?? new Date(seen.getTime() + 90 * DAY);

  const hiringOrganization: JobPosting["hiringOrganization"] = {
    "@type": "Organization",
    name: j.company.name,
  };
  if (j.company.homepageUrl) hiringOrganization.sameAs = j.company.homepageUrl;
  if (j.company.logoUrl) hiringOrganization.logo = j.company.logoUrl;

  const out: JobPosting = {
    "@type": "JobPosting",
    title: j.title,
    description: j.descriptionHtml ? sanitizeDescription(j.descriptionHtml) : j.descriptionText,
    datePosted: seen.toISOString().slice(0, 10),
    validThrough: validThrough.toISOString(),
    hiringOrganization,
    identifier: {
      "@type": "PropertyValue",
      name: j.company.name,
      value: j.externalId,
    },
    directApply: false,
    url: j.canonicalUrl,
  };

  if (j.level === "internship") out.employmentType = j.employmentType ?? "INTERN";
  else if (j.employmentType) out.employmentType = j.employmentType;

  if (j.workplace === "remote") {
    out.jobLocationType = "TELECOMMUTE";
    if (j.countryCode) {
      out.applicantLocationRequirements = {
        "@type": "Country",
        name: j.countryName ?? j.countryCode,
      };
    }
  } else {
    const address: NonNullable<JobPosting["jobLocation"]>["address"] = {
      "@type": "PostalAddress",
    };
    if (j.city) address.addressLocality = j.city;
    if (j.region) address.addressRegion = j.region;
    if (j.countryCode) address.addressCountry = j.countryCode;
    out.jobLocation = { "@type": "Place", address };
  }
  return out;
}
