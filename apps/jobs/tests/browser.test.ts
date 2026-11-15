import { describe, expect, it } from "vite-plus/test";
import { browserBinding } from "../src/browser";

interface QuickActionBody {
  success: boolean;
  result?: unknown;
}

function jsonRes(body: QuickActionBody, status = 200, ms = 10) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "X-Browser-Ms-Used": String(ms), "content-type": "application/json" },
  });
}

function fakeBinding(queue: (Response | Error)[]) {
  const calls: { action: string; url: string }[] = [];
  const binding = {
    quickAction: (action: "links", options: { url: string }) => {
      calls.push({ action, url: options.url });
      const next = queue.shift();
      if (next instanceof Error) return Promise.reject(next);
      if (!next) return Promise.resolve(jsonRes({ success: false, result: null }, 500));
      return Promise.resolve(next);
    },
  };
  return { binding, calls };
}

describe("browserBinding", () => {
  it("429 then success", async () => {
    const { binding } = fakeBinding([
      jsonRes({ success: false }, 429, 5),
      jsonRes({ success: true, result: ["https://a.test/1"] }, 200, 20),
    ]);
    const b = browserBinding(binding, [0, 0]);
    await expect(b.links("https://a.test")).resolves.toEqual(["https://a.test/1"]);
    expect(b.msUsed).toBe(25);
  });

  it("a second 429 then success", async () => {
    const { binding } = fakeBinding([
      jsonRes({ success: false }, 429, 5),
      jsonRes({ success: false }, 429, 5),
      jsonRes({ success: true, result: "hi" }, 200, 30),
    ]);
    const b = browserBinding(binding, [0, 0]);
    await expect(b.links("https://a.test")).resolves.toBe("hi");
    expect(b.msUsed).toBe(40);
  });

  it("three 429s → throws", async () => {
    const { binding, calls } = fakeBinding([
      jsonRes({ success: false }, 429, 5),
      jsonRes({ success: false }, 429, 5),
      jsonRes({ success: false }, 429, 5),
    ]);
    const b = browserBinding(binding, [0, 0]);
    await expect(b.links("https://a.test")).rejects.toThrow(/429/);
    expect(calls.length).toBe(3);
  });

  it("header ms are summed across calls", async () => {
    const { binding } = fakeBinding([
      jsonRes({ success: true, result: ["x"] }, 200, 100),
      jsonRes({ success: true, result: "md" }, 200, 42),
    ]);
    const b = browserBinding(binding, [0, 0]);
    await b.links("https://a.test");
    await b.links("https://a.test");
    expect(b.msUsed).toBe(142);
  });

  it("non-429 failure throws immediately", async () => {
    const { binding, calls } = fakeBinding([
      jsonRes({ success: false }, 500),
      jsonRes({ success: true, result: [] }),
    ]);
    const b = browserBinding(binding, [0, 0]);
    await expect(b.links("https://a.test")).rejects.toThrow(/500/);
    expect(calls.length).toBe(1);
  });
});
