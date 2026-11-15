import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useState, type FormEvent, useRef } from "react";
import { Button, Input, Loader } from "@cloudflare/kumo";
import { authClient, useSession } from "../../lib/auth-client";
import { authErrorMessage, type AuthErrorLike } from "../../lib/auth-errors";
import { toast } from "../../lib/toast";
import { useDocumentTitle } from "../../lib/use-document-title";
import { PageHeader } from "../../components/page-header";
import { SettingsSection } from "../../components/settings-section";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { FormError } from "../../components/form-error";
import { PasswordInput } from "../../components/password-input";

export const Route = createFileRoute("/_authed/settings")({ component: Settings });

/** Whether this user signs in with a password. null = loading. */
function useHasPassword(): boolean | null {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void authClient.listAccounts().then((r) => {
      // On failure assume a password exists — the server still verifies it.
      if (!cancelled)
        setHasPassword(r.data ? r.data.some((a) => a.providerId === "credential") : true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return hasPassword;
}

function Settings() {
  useDocumentTitle("Settings");
  const { data } = useSession();
  const hasPassword = useHasPassword();
  const user = data?.user;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Settings" description="Your profile, password and sessions." />
      {!user || hasPassword === null ? (
        <div className="flex justify-center py-12">
          <Loader size="base" aria-label="Loading settings" />
        </div>
      ) : (
        <>
          {/* key: re-seed the form if the signed-in user changes */}
          <ProfileSection key={user.id} name={user.name} email={user.email} />
          <PasswordSection hasPassword={hasPassword} />
          <SessionsSection />
        </>
      )}
    </div>
  );
}

function ProfileSection({ name: savedName, email }: { name: string; email: string }) {
  const formId = useId();
  const [name, setName] = useState(savedName);
  const [saving, setSaving] = useState(false);
  const unchanged = name.trim() === savedName.trim();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const r = await authClient.updateUser({ name: name.trim() });
    setSaving(false);
    if (r.error) toast.error("Couldn't save your name", authErrorMessage(r.error));
    else toast.success("Name saved");
  };

  return (
    <SettingsSection
      title="Profile"
      footer={
        <Button variant="primary" type="submit" form={formId} loading={saving} disabled={unchanged}>
          Save
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
        <Input
          label="Email"
          description="Used to sign in. It can't be changed here."
          value={email}
          readOnly
          type="email"
        />
      </form>
    </SettingsSection>
  );
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const formId = useId();
  const [current, setCurrent] = useState("");
  const currentRef = useRef<HTMLDivElement>(null);
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AuthErrorLike | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (!hasPassword) {
    return (
      <SettingsSection
        title="Password"
        description="There's no password on this account to change."
      />
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await authClient
      .changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
      .catch(() => ({ error: { message: "Network error. Check your connection and try again." } }));
    setSaving(false);
    if (r.error) {
      setError(r.error);
      setAttempt((n) => n + 1);
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed", "Your other sessions have been signed out.");
  };

  const wrongCurrent = error?.code === "INVALID_PASSWORD";
  useEffect(() => {
    if (wrongCurrent) currentRef.current?.querySelector("input")?.focus();
  }, [wrongCurrent, attempt]);
  const badNew = error?.code === "PASSWORD_TOO_SHORT" || error?.code === "PASSWORD_TOO_LONG";

  return (
    <SettingsSection
      title="Password"
      description="Changing your password signs you out on every other device."
      footer={
        <Button variant="primary" type="submit" form={formId} loading={saving}>
          Change password
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div ref={currentRef}>
          <PasswordInput
            label="Current password"
            value={current}
            onValueChange={setCurrent}
            autoComplete="current-password"
            error={wrongCurrent ? "That password isn't right." : undefined}
          />
        </div>
        <PasswordInput
          label="New password"
          description="At least 8 characters"
          value={next}
          onValueChange={setNext}
          autoComplete="new-password"
          minLength={8}
          error={badNew ? authErrorMessage(error) : undefined}
        />
        {!wrongCurrent && !badNew && (
          <FormError
            message={error ? authErrorMessage(error, "Couldn't change your password.") : null}
            attempt={attempt}
          />
        )}
      </form>
    </SettingsSection>
  );
}

function SessionsSection() {
  const revoke = async () => {
    const r = await authClient.revokeOtherSessions();
    if (r.error) {
      toast.error("Couldn't sign out other sessions", authErrorMessage(r.error));
      return false;
    }
    toast.success("Other sessions signed out");
  };

  return (
    <SettingsSection
      title="Sessions"
      description="Signed in somewhere you don't recognise? Sign out everywhere except this device."
      footer={
        <ConfirmDialog
          title="Sign out other sessions?"
          description="Every other browser and device signed in to your account is signed out now. You stay signed in here."
          confirmLabel="Sign out others"
          onConfirm={revoke}
          trigger={<Button variant="secondary">Sign out other sessions</Button>}
        />
      }
    />
  );
}
