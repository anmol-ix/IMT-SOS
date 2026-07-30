"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import styles from "./AppShell.module.scss";

export type AppRole = "BUSINESS_OWNER" | "TRUSTED_OPERATOR" | "STORE_OPERATOR";
type IconName =
  | "activity"
  | "approvals"
  | "closing"
  | "customers"
  | "dashboard"
  | "inventory"
  | "insights"
  | "logout"
  | "menu"
  | "receive"
  | "sell"
  | "team";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  ownerOnly?: boolean;
  operatorOnly?: boolean;
  group?: "Work" | "Manage";
  matches?: string[];
  children?: NavItem[];
};

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "dashboard", ownerOnly: true, group: "Work" },
  {
    href: "/sell/retail",
    label: "Sell",
    icon: "sell",
    group: "Work",
    matches: ["/sell", "/sales"],
    children: [
      { href: "/sell/retail", label: "Retail sale", icon: "sell" },
      { href: "/sell/wholesale", label: "Wholesale sale", icon: "sell" },
      { href: "/sales", label: "Sales history", icon: "activity" },
    ],
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: "inventory",
    group: "Work",
    matches: ["/inventory", "/receive"],
    children: [
      { href: "/inventory", label: "Products", icon: "inventory" },
      { href: "/inventory/receive", label: "Receive stock", icon: "receive", operatorOnly: true },
      { href: "/inventory/counts", label: "Stock counts", icon: "approvals", operatorOnly: true },
      { href: "/inventory/labels", label: "Labels", icon: "activity" },
    ],
  },
  { href: "/customers", label: "Customers", icon: "customers", group: "Work" },
  {
    href: "/reports",
    label: "Reports",
    icon: "insights",
    ownerOnly: true,
    group: "Manage",
    children: [
      { href: "/reports", label: "Overview", icon: "insights" },
      { href: "/reports/sales", label: "Sales", icon: "sell" },
      { href: "/reports/inventory", label: "Inventory", icon: "inventory" },
      { href: "/reports/customers", label: "Customers", icon: "customers" },
    ],
  },
  {
    href: "/operations/activity",
    label: "Operations",
    icon: "activity",
    group: "Manage",
    matches: ["/operations", "/activity", "/approvals", "/closing"],
    children: [
      { href: "/operations/activity", label: "Activity", icon: "activity" },
      { href: "/operations/approvals", label: "Approvals", icon: "approvals", ownerOnly: true },
      { href: "/operations/closing", label: "Daily closing", icon: "closing", ownerOnly: true },
    ],
  },
  {
    href: "/settings/team",
    label: "Settings",
    icon: "team",
    ownerOnly: true,
    group: "Manage",
    children: [
      { href: "/settings/team", label: "Team", icon: "team" },
      { href: "/settings/invitations", label: "Invitations", icon: "customers" },
      { href: "/settings/devices", label: "Devices", icon: "inventory" },
    ],
  },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z" /></>,
    sell: <><path d="M3 6h18l-2 9H6L3 3H1" /><path d="M8 20h.01M17 20h.01" /></>,
    receive: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 18v2h16v-2" /></>,
    inventory: <><path d="m4 7 8-4 8 4-8 4z" /><path d="m4 7v10l8 4 8-4V7M12 11v10" /></>,
    customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    insights: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h22" /></>,
    activity: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
    approvals: <><path d="M9 11l2 2 4-5" /><path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z" /></>,
    closing: <><path d="M5 3h14v18H5z" /><path d="M8 7h8M8 11h8M8 15h5" /></>,
    team: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h7v18h-7" /></>,
    menu: <><path d="M5 7h14M5 12h14M5 17h14" /></>,
  };

  return (
    <svg
      className={styles.navIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function roleLabel(role: AppRole) {
  if (role === "BUSINESS_OWNER") return "Business owner";
  return role === "TRUSTED_OPERATOR" ? "Trusted operator" : "Store operator";
}

function visibleNavigation(role: AppRole) {
  return navigation.filter((item) => visibleToRole(item, role));
}

function visibleToRole(item: NavItem, role: AppRole) {
  if (item.ownerOnly) return role === "BUSINESS_OWNER";
  if (item.operatorOnly) return role !== "STORE_OPERATOR";
  return true;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function isModuleActive(pathname: string, item: NavItem) {
  return (item.matches ?? [item.href]).some((href) => isActive(pathname, href));
}

export default function AppShell({
  displayName,
  role,
  children,
}: {
  displayName: string;
  role: AppRole;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const items = visibleNavigation(role);
  const current = items.find((item) => isModuleActive(pathname, item)) ?? items[0];
  const secondary = (current?.children ?? []).filter((item) => visibleToRole(item, role));
  const activeSecondary = [...secondary]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => isActive(pathname, item.href));
  const mobilePrimary = items
    .filter((item) => ["dashboard", "sell", "inventory", "customers"].includes(item.icon))
    .slice(0, 4);
  const mobileMore = items.filter((item) => !mobilePrimary.includes(item));
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`${styles.shell} app-shell`}>
      <aside className={styles.sidebar}>
        <Link className={styles.sidebarBrand} href={role === "BUSINESS_OWNER" ? "/dashboard" : "/"}>
          <BrandMark />
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          {(["Work", "Manage"] as const).map((group) => {
            const groupedItems = items.filter((item) => item.group === group);
            if (!groupedItems.length) return null;
            return (
              <div key={group}>
                <p className={styles.navGroup}>{group}</p>
                {groupedItems.map((item) => (
                  <Link
                    className={`${styles.navLink} ${isModuleActive(pathname, item) ? styles.navLinkActive : ""}`}
                    href={item.href as Route}
                    key={item.href}
                    aria-current={isModuleActive(pathname, item) ? "page" : undefined}
                    title={item.label}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={styles.account}>
          <span className={styles.avatar}>{initials}</span>
          <span className={styles.accountCopy}>
            <strong>{displayName}</strong>
            <small>{roleLabel(role)}</small>
          </span>
          <Link className={styles.signOut} href="/sign-out" aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </Link>
        </div>
      </aside>

      <div className={`${styles.workspace} ${secondary.length > 1 ? styles.workspaceWithSubnav : ""}`}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <BrandMark compact className={styles.mobileBrand} />
            <strong>{current?.label ?? "Operations"}</strong>
          </div>
          <span className={styles.role}>{roleLabel(role)}</span>
        </header>
        {secondary.length > 1 && (
          <nav className={styles.subnav} aria-label={`${current.label} navigation`}>
            {secondary.map((item) => (
              <Link
                className={activeSecondary?.href === item.href ? styles.subnavActive : ""}
                href={item.href as Route}
                key={item.href}
                aria-current={activeSecondary?.href === item.href ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <main className={`${styles.content} app-content`} id="main-content">
          {children}
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Mobile navigation">
        {mobilePrimary.map((item) => (
          <Link
            className={`${styles.bottomLink} ${isModuleActive(pathname, item) ? styles.bottomLinkActive : ""}`}
            href={item.href as Route}
            key={item.href}
            aria-current={isModuleActive(pathname, item) ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        <details className={styles.more}>
          <summary className={styles.moreSummary}>
            <Icon name="menu" />
            <span>More</span>
          </summary>
          <div className={styles.moreMenu}>
            {mobileMore.map((item) => (
              <Link href={item.href as Route} key={item.href}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
            <Link href="/sign-out">
              <Icon name="logout" />
              <span>Sign out</span>
            </Link>
          </div>
        </details>
      </nav>
    </div>
  );
}
