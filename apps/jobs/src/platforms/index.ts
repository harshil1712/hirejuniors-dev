import type { PlatformAdapter, SourceRow } from "./types";
import { amazonJobs } from "./amazon-jobs";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";

const adapters: Record<SourceRow["platform"], PlatformAdapter> = {
  greenhouse,
  lever,
  ashby,
  amazon_jobs: amazonJobs,
};

export function adapterFor(platform: SourceRow["platform"]): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`unknown platform ${platform}`);
  return adapter;
}

export type { Fetcher, RawListing, SourceRow } from "./types";
export { amazonJobs, ashby, greenhouse, lever };
