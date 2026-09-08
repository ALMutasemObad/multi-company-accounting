import {
  companyQuickStarts,
  isNavigationItemVisible,
  navigationItems,
  type NavigationAccess,
  type QuickStart,
  type View,
} from "./app-navigation";

export const dashboardOverviewViews = ["suppliers", "customers", "payments"] as const;
export type DashboardOverviewView = (typeof dashboardOverviewViews)[number];

export type DashboardNavigation = {
  allowedViews: ReadonlySet<View>;
  quickStarts: QuickStart[];
  overviewViews: DashboardOverviewView[];
  canOpenReports: boolean;
};

const quickStartCandidates = companyQuickStarts.slice(0, 3);
const destinationCandidates: View[] = [
  ...quickStartCandidates.map((item) => item.view),
  ...dashboardOverviewViews,
  "reports",
];

export function deriveDashboardNavigation(access: NavigationAccess): DashboardNavigation {
  const allowedViews = new Set(destinationCandidates.filter((view) => {
    const item = navigationItems.find((candidate) => candidate.view === view);
    return item ? isNavigationItemVisible(item, access) : false;
  }));

  return {
    allowedViews,
    quickStarts: quickStartCandidates.filter((item) => allowedViews.has(item.view)),
    overviewViews: dashboardOverviewViews.filter((view) => allowedViews.has(view)),
    canOpenReports: allowedViews.has("reports"),
  };
}
