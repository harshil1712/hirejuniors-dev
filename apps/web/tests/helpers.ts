import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { expect } from "vite-plus/test";

// The hand-maintained migrations (drizzle-kit generate is/was broken — see
// migrations/README.md) are applied exactly as alchemy applies them, proving
// they work unmodified.
let migrated = false;
export async function migrate() {
  if (migrated) return;
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS sent_email (to_addr text, subject text, text text, html text)",
  );
  migrated = true;
}

export const PASSWORD = "test-password-123";

export async function signUp(email: string, captchaToken = "test-token") {
  return SELF.fetch("https://x/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-captcha-response": captchaToken },
    body: JSON.stringify({ name: "T", email, password: PASSWORD }),
  });
}

export async function verifyLatest(email: string) {
  // Pull the verification URL out of the email the sink captured.
  const row = await env.DB.prepare(
    "SELECT text FROM sent_email WHERE to_addr = ? ORDER BY rowid DESC LIMIT 1",
  )
    .bind(email)
    .first<{ text: string }>();
  const url = row?.text.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeTruthy();
  // redirect:manual — the session cookie lives on the 302, not the target.
  return SELF.fetch(url!, { redirect: "manual" });
}

/** Sign up, verify, and return the session cookie header value. */
export async function verifiedSessionCookie(email: string) {
  await signUp(email);
  const v = await verifyLatest(email);
  return v.headers.get("set-cookie") ?? "";
}
