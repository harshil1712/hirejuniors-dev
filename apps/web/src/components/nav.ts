import {
  Binoculars,
  Briefcase,
  Gear,
  House,
  PlayCircle,
  Stack,
  type Icon,
} from "@phosphor-icons/react";

export interface NavItem {
  label: string;
  to: "/dashboard" | "/jobs" | "/sources" | "/discovery" | "/runs" | "/settings";
  icon: Icon;
  adminOnly?: boolean;
}

/** Sidebar navigation. Labels double as page titles — keep them in sync. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: House },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Sources", to: "/sources", icon: Stack },
  { label: "Discovery", to: "/discovery", icon: Binoculars },
  { label: "Runs", to: "/runs", icon: PlayCircle },
  { label: "Settings", to: "/settings", icon: Gear },
];

export function navItemsFor(role: string | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
