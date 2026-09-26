/**
 * App frame: Astryx AppShell with TopNav brand and SideNav product nav.
 * SideNav doubles as the mobile drawer below the md breakpoint, so one nav
 * definition serves phones and desktops. Pages render into the Outlet.
 */
import { Outlet, useLocation } from "react-router";
import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { SideNav } from "@astryxdesign/core/SideNav";
import { SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { UserButton, useAuth } from "@clerk/react";
import RouterLink from "./RouterLink";

function isSelected(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppFrame() {
  const { pathname } = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  return (
    <AppShell
      height="auto"
      contentPadding={2}
      topNav={
        <TopNav
          label="Campus Mystery top navigation"
          heading={<TopNavHeading heading="Campus Mystery" headingHref="/" as={RouterLink} />}
          endContent={
            isLoaded && isSignedIn ? (
              <UserButton />
            ) : (
              <TopNavItem label="Sign in" href="/login" as={RouterLink} />
            )
          }
        />
      }
      sideNav={
        <SideNav>
          <SideNavSection title="Play">
            <SideNavItem label="Home" href="/" as={RouterLink} isSelected={isSelected(pathname, "/")} />
            <SideNavItem
              label="How it works"
              href="/onboarding"
              as={RouterLink}
              isSelected={isSelected(pathname, "/onboarding")}
            />
          </SideNavSection>
          <SideNavSection title="Organize">
            <SideNavItem label="Admin" href="/admin" as={RouterLink} isSelected={isSelected(pathname, "/admin")} />
          </SideNavSection>
        </SideNav>
      }
    >
      <Outlet />
    </AppShell>
  );
}
