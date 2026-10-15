"use client";

import type { RunResult } from "@buckshot/core";
import type { GameClient } from "@buckshot/engine";
import { type RefObject, useEffect, useRef, useState } from "react";

export interface GameClientCallbacks {
  readonly onGameOver: (result: RunResult) => void;
  readonly onLockError: () => void;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Mounts one GameClient for the lifetime of the component.
 *
 * - The engine (three.js + the simulation) is imported lazily inside the effect, so it never runs
 *   during SSR and stays out of the first JS bundle.
 * - A fresh <canvas> is created per mount instead of reusing a React-owned one: a disposed WebGL
 *   renderer may have lost its context, and React 19 strict mode mounts twice.
 * - Callbacks go through a ref so re-renders never tear down the running game.
 */
export function useGameClient(
  containerRef: RefObject<HTMLDivElement | null>,
  canvasHostRef: RefObject<HTMLDivElement | null>,
  callbacks: GameClientCallbacks
): { client: GameClient | null; error: string | null } {
  const callbacksRef = useRef(callbacks);
  const [client, setClient] = useState<GameClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    const container = containerRef.current;
    const host = canvasHostRef.current;
    if (!(container && host)) {
      return;
    }
    let cancelled = false;
    let created: GameClient | null = null;
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full outline-none";
    canvas.setAttribute("aria-label", "Buckshot Gambit — first-person view");
    host.append(canvas);

    import("@buckshot/engine")
      .then(({ GameClient: Client }) => {
        if (cancelled) {
          return;
        }
        created = new Client({
          canvas,
          container,
          onError: (cause) => setError(describeError(cause)),
          onGameOver: (result) => callbacksRef.current.onGameOver(result),
          onLockError: () => callbacksRef.current.onLockError(),
        });
        exposeForDebugging(created);
        setClient(created);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(describeError(cause));
        }
      });

    return () => {
      cancelled = true;
      created?.dispose();
      exposeForDebugging(null);
      canvas.remove();
      setClient(null);
    };
  }, [containerRef, canvasHostRef]);

  return { client, error };
}

/** Dev only: `window.__buckshot` lets you poke the live world from the console. */
const exposeForDebugging = (client: GameClient | null): void => {
  if (process.env.NODE_ENV !== "production") {
    Reflect.set(window, "__buckshot", client ?? undefined);
  }
};
