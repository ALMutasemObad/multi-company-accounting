import { describe, expect, it, vi } from "vitest";
import { createProjectRequestSender } from "./GeneralProjectsPage";
import { api, ApiError } from "./api";
import { isNavigationItemVisible, navigationItems, resolveAuthorizedView } from "./app-navigation";
import { arGeneralProjects } from "./i18n/locales/general-projects";

const item = navigationItems.find(entry => entry.view === "generalProjects")!;
const access = (modules: string[], permissions: string[]) => ({
  hasSelectedCompany: true, platformOperations: false,
  moduleSet: new Set(modules) as Parameters<typeof isNavigationItemVisible>[1]["moduleSet"],
  permissionSet: new Set(permissions),
});

describe("project command recovery", () => {
  it("replays the key after a lost response and retires it only after success", async () => {
    const request = vi.fn().mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValue({ project: { id: "created-once" } });
    const send = createProjectRequestSender(request as typeof api);
    const command = { method: "POST", body: JSON.stringify({ nameAr: "Project" }), idempotencyKey: "first-key" };
    await expect(send("/general-projects", command)).rejects.toThrow("lost response");
    await send("/general-projects", { ...command, idempotencyKey: "retry-key" });
    expect(request.mock.calls[1][1].idempotencyKey).toBe("first-key");
    await send("/general-projects", { ...command, idempotencyKey: "next-intent-key" });
    expect(request.mock.calls[2][1].idempotencyKey).toBe("next-intent-key");
  });

  it("keeps uncertain attempts separate by endpoint and body, including server failures", async () => {
    const request = vi.fn().mockRejectedValue(new ApiError("unavailable", 503));
    const send = createProjectRequestSender(request as typeof api);
    for (const [path, body, key] of [
      ["/general-projects", "A", "a"], ["/general-projects", "B", "b"],
      ["/general-projects/p/comments", "A", "c"], ["/general-projects", "A", "retry"],
    ]) await expect(send(path, { method: "POST", body, idempotencyKey: key })).rejects.toThrow("unavailable");
    expect(request.mock.calls.map(call => call[1].idempotencyKey)).toEqual(["a", "b", "c", "a"]);
  });
});

describe("general project navigation boundary", () => {
  it("uses an independent project module and permission", () => {
    expect(item.label).toBe("nav.generalProjects");
    expect(item.module).toBe("GENERAL_PROJECTS");
    expect(Object.values(arGeneralProjects).join(" ")).not.toMatch(/مهن/);
    expect(isNavigationItemVisible(item, access(["PROFESSIONAL_PROJECTS"], ["professional_projects.view"]))).toBe(false);
    expect(isNavigationItemVisible(item, access(["GENERAL_PROJECTS"], ["professional_projects.view"]))).toBe(false);
    expect(isNavigationItemVisible(item, access(["GENERAL_PROJECTS"], ["general_projects.view"]))).toBe(true);
  });
  it("falls back from a deep link when the independent entitlement is absent", () => {
    expect(resolveAuthorizedView("generalProjects", access(["PROFESSIONAL_PROJECTS"], ["professional_projects.view"]))).toBe("home");
  });
});
