import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  ClipboardText,
  Tabs,
  Dialog,
  Input,
  Loader,
  Select,
  Text,
} from "@cloudflare/kumo";
import { Copy, Key, WarningCircle } from "@phosphor-icons/react";
import type { ApiKeyCreated, Scope } from "../../worker/api/schemas";
import { PRODUCT } from "../config";
import { authClient } from "../lib/auth-client";
import { toast } from "../lib/toast";
import { ConfirmDialog } from "./confirm-dialog";
import { SettingsSection } from "./settings-section";

/** Row shape from `/api-key/list` — `permissions` arrives already parsed. */
interface ListedKey {
  id: string;
  name: string | null;
  start: string | null;
  expiresAt: string | Date | null;
  lastRequest: string | Date | null;
  createdAt: string | Date;
  permissions: Record<string, string[]> | null;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function scopesOf(key: ListedKey): string[] {
  return Object.entries(key.permissions ?? {}).flatMap(([resource, actions]) =>
    actions.map((a) => `${resource}:${a}`),
  );
}

async function createKey(input: {
  name: string;
  scopes: Scope[];
  expiresInDays: 30 | 90 | 365 | null;
}): Promise<ApiKeyCreated> {
  const res = await fetch("/api/api-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return ((await res.json()) as { data: ApiKeyCreated }).data;
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ListedKey[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [shown, setShown] = useState<ApiKeyCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ListedKey | null>(null);

  const load = useCallback(async () => {
    const r = await authClient.apiKey.list();
    setKeys(((r.data?.apiKeys as ListedKey[] | undefined) ?? []).slice().reverse());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async () => {
    if (!revokeTarget) return;
    const r = await authClient.apiKey.delete({ keyId: revokeTarget.id });
    if (r.error) {
      toast.error("Couldn't revoke the key", r.error.message ?? undefined);
      return false;
    }
    toast.success("Key revoked", revokeTarget.name ?? revokeTarget.start ?? "");
    await load();
  };

  return (
    <SettingsSection
      title="API keys"
      description="Keys for the HTTP API and MCP server. A key is shown once — store it somewhere safe."
      footer={
        <Button variant="primary" icon={Key} onClick={() => setCreateOpen(true)}>
          Create key
        </Button>
      }
    >
      {keys === null ? (
        <div className="flex justify-center py-4">
          <Loader aria-label="Loading API keys" />
        </div>
      ) : keys.length === 0 ? (
        <Text variant="secondary" size="sm">
          No API keys yet.
        </Text>
      ) : (
        <ul className="flex flex-col divide-y divide-kumo-line">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-kumo-default">
                    {k.name || "Unnamed key"}
                  </span>
                  {k.start && <code className="shrink-0 text-kumo-subtle">{k.start}…</code>}
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {scopesOf(k).map((s) => (
                    <Badge key={s} variant="outline">
                      {s}
                    </Badge>
                  ))}
                </span>
                <Text variant="secondary" size="sm">
                  Created {dateFormat.format(new Date(k.createdAt))} · Last used{" "}
                  {k.lastRequest ? dateFormat.format(new Date(k.lastRequest)) : "never"} · Expires{" "}
                  {k.expiresAt ? dateFormat.format(new Date(k.expiresAt)) : "never"}
                </Text>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(k)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(k) => {
            setCreateOpen(false);
            setShown(k);
            void load();
          }}
        />
      )}

      {shown && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open) setShown(null);
          }}
        >
          <Dialog className="flex flex-col gap-4 p-6" size="lg">
            <Dialog.Title className="text-lg font-semibold text-kumo-default">
              Your new API key
            </Dialog.Title>
            <Banner
              variant="alert"
              icon={<WarningCircle weight="fill" size={20} aria-hidden />}
              title="Copy it now — you won't see it again."
            />
            <ClipboardText text={shown.key} size="base" />
            <McpSnippets apiKey={shown.key} />
            <div className="mt-2 flex justify-end">
              <Dialog.Close render={<Button variant="primary">Done</Button>} />
            </div>
          </Dialog>
        </Dialog.Root>
      )}

      <ConfirmDialog
        title={revokeTarget ? `Revoke ${revokeTarget.name || "this key"}?` : "Revoke this key?"}
        description="Anything using it loses access immediately. This can't be undone."
        confirmLabel="Revoke key"
        variant="destructive"
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        onConfirm={revoke}
      />
    </SettingsSection>
  );
}

type Expiry = "30" | "90" | "365" | "never";

const EXPIRY_OPTIONS: { label: string; value: Expiry }[] = [
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "1 year", value: "365" },
  { label: "Never", value: "never" },
];

function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: ApiKeyCreated) => void;
}) {
  const [name, setName] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 0 && (canRead || canWrite);

  const setWrite = (next: boolean) => {
    // Write implies read.
    setCanWrite(next);
    if (next) setCanRead(true);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      const scopes: Scope[] = ["projects:read"];
      if (canWrite) scopes.push("projects:write");
      const created = await createKey({
        name: name.trim(),
        scopes,
        expiresInDays: expiry === "never" ? null : (Number(expiry) as 30 | 90 | 365),
      });
      toast.success("Key created", name.trim());
      onCreated(created);
    } catch (err) {
      toast.error("Couldn't create the key", (err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog className="flex flex-col gap-4 p-6" size="lg">
        <Dialog.Title className="text-lg font-semibold text-kumo-default">
          Create API key
        </Dialog.Title>
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Input
            label="Name"
            description="What is this key for? (max 32 characters)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={32}
            autoFocus
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm text-kumo-default">Scopes</legend>
            <Checkbox
              label="Read projects"
              checked={canRead}
              disabled={canWrite}
              onCheckedChange={(v) => setCanRead(v === true)}
            />
            <Checkbox
              label="Write projects"
              checked={canWrite}
              onCheckedChange={(v) => setWrite(v === true)}
            />
          </fieldset>
          <Select<Expiry>
            label="Expires"
            value={expiry}
            onValueChange={(v) => {
              if (v !== null) setExpiry(v);
            }}
            items={EXPIRY_OPTIONS}
          />
        </form>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close disabled={saving} render={<Button variant="secondary">Cancel</Button>} />
          <Button
            variant="primary"
            loading={saving}
            disabled={!valid}
            onClick={() => void submit()}
          >
            Create key
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

/** MCP client setup snippets for the freshly-created key (spec §6.3). */
function McpSnippets({ apiKey }: { apiKey: string }) {
  const [tab, setTab] = useState("claude");
  const url = `${window.location.origin}/mcp`;
  const name = PRODUCT.name.toLowerCase();
  const claude = `claude mcp add --transport http ${name} ${url} --header "Authorization: Bearer ${apiKey}"`;
  const cursor = `{
  "mcpServers": {
    "${name}": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer ${apiKey}" }
    }
  }
}`;
  const envVar = `${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const codex = `[mcp_servers.${name}]
url = "${url}"
bearer_token_env_var = "${envVar}"`;
  return (
    <>
      <Tabs
        tabs={[
          { value: "claude", label: "Claude Code" },
          { value: "cursor", label: "Cursor" },
          { value: "codex", label: "Codex" },
        ]}
        selectedValue={tab}
        onValueChange={(v) => setTab(v ?? "claude")}
      />
      <div className="relative mt-2 min-w-0">
        <pre className="max-h-40 overflow-auto rounded-md border border-kumo-fill bg-kumo-base p-3 pr-12 font-mono text-xs whitespace-pre-wrap break-all text-kumo-default">
          {tab === "claude"
            ? claude
            : tab === "cursor"
              ? cursor
              : `${codex}\n# then: export ${envVar}=<your key>`}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1 right-1"
          icon={Copy}
          aria-label="Copy snippet"
          onClick={() => {
            const snippet =
              tab === "claude"
                ? claude
                : tab === "cursor"
                  ? cursor
                  : `${codex}\n# then: export ${envVar}=<your key>`;
            void navigator.clipboard.writeText(snippet).then(() => toast.success("Copied"));
          }}
        />
      </div>
    </>
  );
}
