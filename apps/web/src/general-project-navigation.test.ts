import { describe, expect, it } from "vitest";
import { isNavigationItemVisible, navigationItems, resolveAuthorizedView } from "./app-navigation";

const item = navigationItems.find(entry => entry.view === "generalProjects")!;
const access = (modules: string[], permissions: string[]) => ({
  hasSelectedCompany: true, platformOperations: false,
  moduleSet: new Set(modules) as Parameters<typeof isNavigationItemVisible>[1]["moduleSet"],
  permissionSet: new Set(permissions),
});

describe("general project navigation boundary", () => {
  it("uses an independent project module and permission", () => {
    expect(item.label).toBe("nav.generalProjects");
    expect(item.module).toBe("GENERAL_PROJECTS");
    expect(isNavigationItemVisible(item, access(["PROFESSIONAL_PROJECTS"], ["professional_projects.view"]))).toBe(false);
    expect(isNavigationItemVisible(item, access(["GENERAL_PROJECTS"], ["professional_projects.view"]))).toBe(false);
    expect(isNavigationItemVisible(item, access(["GENERAL_PROJECTS"], ["general_projects.view"]))).toBe(true);
  });
  it("falls back from a deep link when the independent entitlement is absent", () => {
    expect(resolveAuthorizedView("generalProjects", access(["PROFESSIONAL_PROJECTS"], ["professional_projects.view"]))).toBe("home");
  });
});
