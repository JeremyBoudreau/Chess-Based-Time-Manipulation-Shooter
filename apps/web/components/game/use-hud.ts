import type { HudSnapshot, HudStore } from "@buckshot/engine";
import { useSyncExternalStore } from "react";

const subscribeNothing = () => () => {
  // No store yet: nothing will ever change.
};
const noSnapshot = (): null => null;

/**
 * Subscribe to the game's HUD store. Returns null until the engine has loaded (it is imported
 * lazily so three.js never runs during SSR). The store only replaces its snapshot when a visible
 * value changes, so this re-renders a few times per second, not every frame.
 */
export function useHud(store: HudStore | null): HudSnapshot | null {
  return useSyncExternalStore(
    store ? store.subscribe : subscribeNothing,
    store ? store.getSnapshot : noSnapshot,
    noSnapshot
  );
}
