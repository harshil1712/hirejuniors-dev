/** Product identity — keep in sync with ../../project.config.ts (the worker
 * bundle can't import from the repo root). */
export const PRODUCT = {
  name: "Hire Juniors",
  domain: "hirejuniors.dev",
  appDomain: "app.hirejuniors.dev",
  emailFrom: "noreply@hirejuniors.dev",
} as const;
