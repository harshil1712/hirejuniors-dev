import { describe, expect, it } from "vite-plus/test";
import { parseLocation } from "../src/location";

describe("parseLocation", () => {
  it("city, region, country name", () => {
    expect(parseLocation("Austin, TX, United States")).toEqual({
      city: "Austin",
      region: "TX",
      countryCode: "US",
      workplace: null,
    });
  });

  it("city + country name", () => {
    expect(parseLocation("London, United Kingdom")).toEqual({
      city: "London",
      region: null,
      countryCode: "GB",
      workplace: null,
    });
  });

  it("remote keyword + country in one segment", () => {
    expect(parseLocation("Remote - Portugal")).toEqual({
      city: null,
      region: null,
      countryCode: "PT",
      workplace: "remote",
    });
  });

  it("hybrid keyword + city, country", () => {
    expect(parseLocation("Hybrid; Lisbon, Portugal")).toEqual({
      city: "Lisbon",
      region: null,
      countryCode: "PT",
      workplace: "hybrid",
    });
  });

  it("alpha-2 and alpha-3 pass through", () => {
    expect(parseLocation("Berlin, DE").countryCode).toBe("DE");
    expect(parseLocation("Berlin, DEU").countryCode).toBe("DE");
    expect(parseLocation("Herndon, USA").countryCode).toBe("US");
  });

  it("falls back to countryHint", () => {
    // "Virginia" isn't a country, so the hint wins.
    expect(parseLocation("Herndon, Virginia", "USA")).toMatchObject({
      city: "Herndon",
      region: "Virginia",
      countryCode: "US",
    });
  });

  it("workplaceHint respected", () => {
    expect(parseLocation("Toronto", "CAN", "remote")).toMatchObject({
      countryCode: "CA",
      workplace: "remote",
    });
  });
});
