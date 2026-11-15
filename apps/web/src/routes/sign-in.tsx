import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Banner, Button, Input, Text } from "@cloudflare/kumo";
import { CheckCircle } from "@phosphor-icons/react";
import { authClient } from "../lib/auth-client";
import { authErrorFields } from "../lib/auth-errors";
import { useCaptchaForm } from "../lib/use-captcha-form";
import AuthCard from "../components/auth-card";
import { AuthLink } from "../components/auth-link";
import { FormError } from "../components/form-error";
import { PasswordInput } from "../components/password-input";

const NOTICES = {
  "password-reset": "Password updated. Sign in with your new password.",
} as const;

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: { notice?: string }) => ({
    notice: search.notice === "password-reset" ? search.notice : undefined,
  }),
  component: SignIn,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session?.user) throw redirect({ to: "/dashboard" });
  },
});

function SignIn() {
  const navigate = useNavigate();
  const { notice } = Route.useSearch();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const form = useCaptchaForm(
    (headers) => authClient.signIn.email({ email, password }, { headers }),
    { onSuccess: () => navigate({ to: "/dashboard" }) },
  );
  const invalid = authErrorFields(form.error);
  const unverified = form.error?.code === "EMAIL_NOT_VERIFIED";

  return (
    <AuthCard
      title="Sign in"
      footer={
        <Text variant="secondary" size="sm">
          New here? <AuthLink to="/sign-up">Create an account</AuthLink>
        </Text>
      }
    >
      {notice && (
        <Banner
          role="status"
          size="sm"
          variant="secondary"
          icon={<CheckCircle weight="fill" size={16} aria-hidden />}
          description={NOTICES[notice as keyof typeof NOTICES]}
        />
      )}
      <form onSubmit={form.onSubmit} className="flex w-full flex-col gap-4">
        <Input
          label="Email"
          type="email"
          variant={invalid.has("email") ? "error" : undefined}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-invalid={invalid.has("email") || undefined}
        />
        <div className="flex flex-col gap-1.5">
          <PasswordInput
            label="Password"
            value={password}
            onValueChange={setPassword}
            autoComplete="current-password"
            invalid={invalid.has("password")}
          />
          <Text variant="secondary" size="sm">
            <AuthLink to="/forgot-password">Forgot password?</AuthLink>
          </Text>
        </div>
        {form.captcha}
        <FormError
          message={form.message}
          attempt={form.attempt}
          action={
            unverified ? (
              <Banner.Action
                variant="secondary"
                onClick={() =>
                  void navigate({ to: "/check-email", search: { email, reason: "unverified" } })
                }
              >
                Verify email
              </Banner.Action>
            ) : undefined
          }
        />
        <Button
          variant="primary"
          type="submit"
          className="w-full justify-center"
          loading={form.loading}
        >
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
