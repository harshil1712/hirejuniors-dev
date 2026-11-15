import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Link, Text } from "@cloudflare/kumo";
import { me } from "../lib/admin-api";
import AppShell from "../components/app-shell";
import { useDocumentTitle } from "../lib/use-document-title";

/** Shown when Access admitted someone who isn't the owner, or the API can't
 * confirm the identity — there's no in-app login to fall back to. */
function NotAuthorised() {
  useDocumentTitle("Not authorised");
  return (
    <div className="grid min-h-svh place-items-center bg-kumo-canvas p-6 text-center text-kumo-default">
      <main className="flex max-w-sm flex-col items-center gap-4">
        <Text variant="heading" size="lg" as="h1">
          Not authorised
        </Text>
        <Text variant="secondary">
          This dashboard is owner-only. If you signed in with the wrong account, sign out of
          Cloudflare Access and try again.
        </Text>
        <Link href="/cdn-cgi/access/logout">Sign out of Access</Link>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    try {
      const { email } = await me();
      return { email };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return { email: null };
      throw e;
    }
  },
  component: function AuthedLayout() {
    const { email } = Route.useRouteContext();
    if (!email) return <NotAuthorised />;
    return (
      <AppShell email={email}>
        <Outlet />
      </AppShell>
    );
  },
});
