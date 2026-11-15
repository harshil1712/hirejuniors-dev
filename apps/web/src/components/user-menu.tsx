import { Button, DropdownMenu } from "@cloudflare/kumo";
import { CaretDown, SignOut } from "@phosphor-icons/react";

/** Header account menu: the Access-admitted email + Access sign-out. */
export function UserMenu({ email }: { email: string }) {
  const initial = (email || "?")[0].toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <Button
            variant="ghost"
            aria-label="Account menu"
            className="gap-2 rounded-full pr-2 pl-1"
          >
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-full bg-kumo-brand text-xs font-semibold text-(--brand-ink)"
            >
              {initial}
            </span>
            <span className="hidden max-w-48 truncate text-sm sm:inline">{email}</span>
            <CaretDown size={12} aria-hidden />
          </Button>
        }
      />
      <DropdownMenu.Content align="end">
        <DropdownMenu.Group>
          <DropdownMenu.Label>
            <span className="block truncate font-medium text-kumo-default">{email}</span>
          </DropdownMenu.Label>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <DropdownMenu.Item icon={SignOut} onClick={() => location.assign("/cdn-cgi/access/logout")}>
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
