import { useEffect, useState } from "react";

export interface PublicConfig {
  turnstileSiteKey: string;
}

const DEFAULTS: PublicConfig = { turnstileSiteKey: "" };

let resolved: PublicConfig | null = null;
let pending: Promise<PublicConfig> | null = null;

function load(): Promise<PublicConfig> {
  pending ??= fetch("/api/public-config")
    .then((r) => (r.ok ? (r.json() as Promise<{ turnstileSiteKey?: string }>) : null))
    .then((data) => {
      resolved = { turnstileSiteKey: data?.turnstileSiteKey ?? "" };
      return resolved;
    })
    .catch(() => {
      // Offline or blocked: let the next mount retry.
      pending = null;
      return DEFAULTS;
    });
  return pending;
}

/** Awaitable copy for route guards (beforeLoad) that can't use the hook. */

/**
 * Unauthenticated feature flags from GET /api/public-config. Fetched once per
 * page load and shared by every caller.
 */
export function usePublicConfig(): PublicConfig {
  const [config, setConfig] = useState<PublicConfig>(resolved ?? DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    void load().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
