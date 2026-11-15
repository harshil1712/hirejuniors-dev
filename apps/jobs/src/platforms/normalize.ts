/** Map platform-specific labels to schema.org employmentType / workplace. */
export function normalizeEmploymentType(hint: string | null | undefined): string | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase().replace(/[\s_-]+/g, "");
  if (h.includes("intern") || h.includes("coop")) return "INTERN";
  if (h.includes("fulltime")) return "FULL_TIME";
  if (h.includes("parttime")) return "PART_TIME";
  if (h.includes("contract")) return "CONTRACTOR";
  if (h.includes("temp")) return "TEMPORARY";
  return "OTHER";
}

export function normalizeWorkplace(hint: string | null | undefined): string | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase().replace(/[\s_-]+/g, "");
  if (h.includes("remote")) return "remote";
  if (h.includes("hybrid")) return "hybrid";
  if (h.includes("onsite") || h.includes("office")) return "onsite";
  return undefined;
}
