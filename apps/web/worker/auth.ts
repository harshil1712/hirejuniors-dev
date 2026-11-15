import { APIError, betterAuth } from "better-auth";
import { admin, captcha } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as authSchema from "../src/auth-schema";
import { sendAuthEmail, verifyEmailTemplate, resetPasswordTemplate } from "./email";
import { assertTurnstileConfig } from "./turnstile-guard";

/** Owner bootstrap: verified-email match only (a social provider sets
 * verified; unverified signups never promote). */
export function bootstrapAdmin<T extends { email?: string; emailVerified?: boolean }>(
  user: T,
  ownerEmail: string,
): T {
  if (
    ownerEmail &&
    user.emailVerified === true &&
    user.email?.toLowerCase() === ownerEmail.toLowerCase()
  ) {
    return { ...user, role: "admin" } as T;
  }
  return user;
}

export function createAuth(env: Env) {
  assertTurnstileConfig(env.TURNSTILE_SECRET_KEY, env.BETTER_AUTH_URL);
  const db = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Not `disableSignUp`: that flag blocks the owner too. The
      // user.create.before hook below enforces owner-only sign-up instead.
      disableSignUp: false,
      sendResetPassword: async ({ user, url }) => {
        const t = resetPasswordTemplate(url);
        await sendAuthEmail(env, { to: user.email, ...t });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const t = verifyEmailTemplate(url);
        await sendAuthEmail(env, { to: user.email, ...t });
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.email?.toLowerCase() !== env.OWNER_ADMIN_EMAIL.toLowerCase()) {
              // Not FORBIDDEN: with requireEmailVerification the sign-up
              // endpoint turns a 403 from createUser into a generic 200
              // (anti-enumeration), which would look like a successful
              // sign-up to a client even though no row was created.
              throw new APIError("BAD_REQUEST", { message: "Sign-up is restricted" });
            }
            return { data: bootstrapAdmin(user, env.OWNER_ADMIN_EMAIL) };
          },
        },
      },
      session: {
        create: {
          // Password sign-ups verify after create — by the time the first
          // session exists the user row is verified, so promote the owner here
          // (user.create covers social sign-ups, which verify at create).
          before: async (session, context) => {
            const adapter = context?.context?.adapter;
            if (adapter && env.OWNER_ADMIN_EMAIL) {
              const u = await adapter.findOne<{
                id: string;
                email: string;
                emailVerified: boolean;
                role: string | null;
              }>({ model: "user", where: [{ field: "id", value: session.userId }] });
              if (
                u?.emailVerified &&
                u.email.toLowerCase() === env.OWNER_ADMIN_EMAIL.toLowerCase() &&
                u.role !== "admin"
              ) {
                await adapter.update({
                  model: "user",
                  where: [{ field: "id", value: u.id }],
                  update: { role: "admin" },
                });
              }
            }
            return { data: session };
          },
        },
      },
    },
    plugins: [
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY ?? "",
        endpoints: [
          "/sign-up/email",
          "/sign-in/email",
          "/forget-password",
          "/request-password-reset",
        ],
      }),
      admin(),
    ],
  });
}
