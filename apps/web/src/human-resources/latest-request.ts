export type LatestRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export type LatestRequestLane = {
  begin: () => LatestRequest;
  cancel: () => void;
};

export function createLatestRequestLane(): LatestRequestLane {
  let generation = 0;
  let active: AbortController | null = null;

  return {
    begin() {
      active?.abort();
      const controller = new AbortController();
      const requestGeneration = ++generation;
      active = controller;
      return {
        signal: controller.signal,
        isCurrent: () => generation === requestGeneration
          && active === controller
          && !controller.signal.aborted,
      };
    },
    cancel() {
      generation += 1;
      active?.abort();
      active = null;
    },
  };
}
