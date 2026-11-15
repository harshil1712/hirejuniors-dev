// Browser Run seam — spec §Browser Run. Sequential calls only (rate limits).
// 30 s timeout per call; HTTP 429 retries twice (after 2 s and 6 s); any
// other failure throws. `msUsed` accumulates X-Browser-Ms-Used for the run.

export interface Browser {
  links(url: string): Promise<string[]>;
  markdown(url: string): Promise<string>;
  /** Cumulative browser ms consumed so far (feeds ingest_run.browser_ms). */
  readonly msUsed: number;
}

export type QuickAction = "links" | "markdown";

interface BrowserRunBinding {
  quickAction(action: QuickAction, options: { url: string }): Promise<Response>;
}

const RETRY_DELAYS = [2000, 6000];
const TIMEOUT_MS = 30_000;

export function browserBinding(binding: BrowserRunBinding, retryDelays = RETRY_DELAYS): Browser {
  let msUsed = 0;

  async function call<T>(action: QuickAction, url: string): Promise<T> {
    let lastError: Error = new Error("browser call failed");
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelays[attempt - 1]));
      try {
        const res = await Promise.race([
          binding.quickAction(action, { url }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`browser ${action} timeout on ${url}`)), TIMEOUT_MS),
          ),
        ]);
        const ms = Number(res.headers.get("X-Browser-Ms-Used") ?? 0);
        if (Number.isFinite(ms)) msUsed += ms;
        if (res.status === 429) {
          lastError = new Error(`browser 429 on ${action} ${url}`);
          continue;
        }
        if (!res.ok) throw new Error(`browser ${res.status} on ${action} ${url}`);
        const body = (await res.json()) as { success: boolean; result: T };
        if (!body.success) throw new Error(`browser ${action} failed for ${url}`);
        return body.result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.message.includes("429")) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  return {
    get msUsed() {
      return msUsed;
    },
    links: (url) => call<string[]>("links", url),
    markdown: (url) => call<string>("markdown", url),
  };
}
