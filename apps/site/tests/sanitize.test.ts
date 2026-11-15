import { describe, it, expect } from "vite-plus/test";
import { sanitizeDescription } from "../src/lib/sanitize";

describe("sanitizeDescription", () => {
  it("strips script/style/iframe/img and on* attributes", () => {
    const out = sanitizeDescription(
      '<p onclick="x()">Hi<script>alert(1)</script><style>a{}</style>' +
        '<iframe src="x"></iframe><img src="y.png"></p>',
    );
    expect(out).toBe("<p>Hi</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
  });

  it("removes javascript: hrefs", () => {
    const out = sanitizeDescription('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("href");
  });

  it("maps h1 to h2", () => {
    expect(sanitizeDescription("<h1>Big</h1>")).toBe("<h2>Big</h2>");
  });

  it("adds rel nofollow noopener to links", () => {
    const out = sanitizeDescription('<a href="https://a.example">go</a>');
    expect(out).toContain('rel="nofollow noopener"');
    expect(out).toContain('href="https://a.example"');
  });

  it("keeps allowed tags", () => {
    const out = sanitizeDescription("<p>a</p><ul><li><b>x</b> <em>y</em></li></ul><h3>h</h3><br>");
    for (const t of ["<p>", "<ul>", "<li>", "<b>", "<em>", "<h3>", "<br"]) {
      expect(out).toContain(t);
    }
  });

  it("strips disallowed attributes", () => {
    const out = sanitizeDescription('<a href="https://a.example" class="x" id="y">z</a>');
    expect(out).not.toContain("class=");
    expect(out).not.toContain("id=");
  });
});
