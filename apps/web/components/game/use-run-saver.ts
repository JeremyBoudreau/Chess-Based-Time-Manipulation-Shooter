"use client";

import type { RunResult } from "@buckshot/core";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { saveRunAction } from "@/app/play/actions";

type SaveFailure = "unauthenticated" | "invalid" | "error";

export type SaveStatus =
  | { readonly kind: "signed-out" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly personalBest: boolean }
  | { readonly kind: "failed"; readonly reason: SaveFailure };

/** The save state of one finished run, tagged with the result it belongs to. */
export interface RunSave {
  readonly result: RunResult;
  readonly status: SaveStatus;
}

const FAILURE_TOASTS: Readonly<
  Record<SaveFailure, { title: string; description: string }>
> = {
  error: {
    description: "The server didn't answer. Your run was not recorded.",
    title: "Couldn't save your run",
  },
  invalid: {
    description: "That run didn't add up, so it was not recorded.",
    title: "Run rejected",
  },
  unauthenticated: {
    description: "Your session expired before the run finished.",
    title: "Sign in to save your runs",
  },
};

/**
 * Saves finished runs for signed-in players and reports the outcome as a toast plus a status the
 * results card shows. Each status is tagged with its RunResult so a slow save from a previous run
 * can never overwrite the state of the run on screen.
 */
export function useRunSaver(signedIn: boolean) {
  const [save, setSave] = useState<RunSave | null>(null);

  const saveRun = useCallback(
    async (result: RunResult): Promise<void> => {
      if (!signedIn) {
        setSave({ result, status: { kind: "signed-out" } });
        return;
      }
      setSave({ result, status: { kind: "saving" } });
      const finish = (status: SaveStatus) =>
        setSave((current) =>
          current?.result === result ? { result, status } : current
        );
      try {
        const response = await saveRunAction(result);
        if (response.ok) {
          toast.success(
            response.personalBest ? "New personal best!" : "Run saved"
          );
          finish({ kind: "saved", personalBest: response.personalBest });
          return;
        }
        const message = FAILURE_TOASTS[response.reason];
        toast.error(message.title, { description: message.description });
        finish({ kind: "failed", reason: response.reason });
      } catch {
        const message = FAILURE_TOASTS.error;
        toast.error(message.title, { description: message.description });
        finish({ kind: "failed", reason: "error" });
      }
    },
    [signedIn]
  );

  return { save, saveRun };
}

/**
 * The status to show for `result`: the tracked one if it belongs to this run, otherwise what is
 * about to happen (a signed-in save is kicked off in the same tick the run ends).
 */
export const saveStatusFor = (
  save: RunSave | null,
  result: RunResult,
  signedIn: boolean
): SaveStatus => {
  if (save?.result === result) {
    return save.status;
  }
  return signedIn ? { kind: "saving" } : { kind: "signed-out" };
};
