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
  | "dashboard"
  | "inventory"
  | "logout"
  | "menu"
  | "receive"
  | "sell"
  | "team";

type NavItem = {
  href: Route;
  label: string;
  icon: IconName;
  ownerOnly?: boolean;
  operatorOnly?: boolean;
  group?: "Daily work" | "Control";
};

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "dashboard", ownerOnly: true, group: "Daily work" },
  { href: "/", label: "Sell", icon: "sell", group: "Daily work" },
  { href: "/inventory", label: "Inventory", icon: "inventory", group: "Daily work" },
  { href: "/receive", label: "Receive stock", icon: "receive", operatorOnly: true, group: "Daily work" },
  { href: "/activity", label: "History", icon: "activity", group: "Daily work" },
  { href: "/approvals", label: "Needs approval", icon: "approvals", ownerOnly: true, group: "Control" },
  { href: "/closing", label: "Daily closing", icon: "closing", ownerOnly: true, group: "Control" },
  { href: "/team", label: "Team & access", icon: "team", ownerOnly: true, group: "Control" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><path d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z" /></>,
    sell: <><path d="M3 6h18l-2 9H6L3 3H1" /><path d="M8 20h.01M17 20h.01" /></>,
    receive: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 18v2h16v-2" /></>,
    inventory: <><path d="m4 7 8-4 8 4-8 4z" /><path d="m4 7v10l8 4 8-4V7M12 11v10" /></>,
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
  return navigation.filter((item) => {
    if (item.ownerOnly) return role === "BUSINESS_OWNER";
    if (item.operatorOnly) return role !== "STORE_OPERATOR";
    return true;
  });
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
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
  const current = items.find((item) => isActive(pathname, item.href)) ?? items[0];
  const mobilePrimary = items
    .filter((item) => ["dashboard", "sell", "receive", "inventory", "activity"].includes(item.icon))
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
          {(["Daily work", "Control"] as const).map((group) => {
            const groupedItems = items.filter((item) => item.group === group);
            if (!groupedItems.length) return null;
            return (
              <div key={group}>
                <p className={styles.navGroup}>{group}</p>
                {groupedItems.map((item) => (
                  <Link
                    className={`${styles.navLink} ${isActive(pathname, item.href) ? styles.navLinkActive : ""}`}
                    href={item.href}
                    key={item.href}
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
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

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <BrandMark compact className={styles.mobileBrand} />
            <strong>{current?.label ?? "Operations"}</strong>
          </div>
          <span className={styles.role}>{roleLabel(role)}</span>
        </header>
        <main className={`${styles.content} app-content`} id="main-content">
          {children}
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Mobile navigation">
        {mobilePrimary.map((item) => (
          <Link
            className={`${styles.bottomLink} ${isActive(pathname, item.href) ? styles.bottomLinkActive : ""}`}
            href={item.href}
            key={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
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
              <Link href={item.href} key={item.href}>
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
