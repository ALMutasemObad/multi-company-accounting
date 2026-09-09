import { describe, expect, it } from "vitest";
import { createLatestRequestLane } from "./latest-request";

describe("HR latest request lane", () => {
  it("aborts and invalidates an older generation even when its transport ignores abort", () => {
    const lane = createLatestRequestLane();
    const older = lane.begin();
    const current = lane.begin();

    expect(older.signal.aborted).toBe(true);
    expect(older.isCurrent()).toBe(false);
    expect(current.signal.aborted).toBe(false);
    expect(current.isCurrent()).toBe(true);
  });

  it("invalidates the active generation on cleanup", () => {
    const lane = createLatestRequestLane();
    const request = lane.begin();

    lane.cancel();

    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
  });
});
