"use client";

import { Button } from "@buckshot/ui/components/button";
import { cn } from "@buckshot/ui/lib/utils";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DifficultyOption,
  difficultyFromParams,
  replaceDifficultyInUrl,
} from "./difficulty";
import { GameKeyframes } from "./game-keyframes";
import { GameOverLayer } from "./game-over-overlays";
import { IntroFlash } from "./intro-flash";
import { PlayingHud } from "./playing-hud";
import { StartOverlay } from "./start-overlay";
import { useGameClient } from "./use-game-client";
import { useHud } from "./use-hud";
import { saveStatusFor, useRunSaver } from "./use-run-saver";
import { CoolVignette } from "./vignettes";

export interface GameViewProps {
  /** The playable setups, easiest first, summarised on the server from core's SETUPS. */
  readonly difficulties: readonly DifficultyOption[];
  /**
   * The server's reading of `?difficulty=` (already validated): only a fallback, since a
   * back/forward restore can replay a render older than the address bar.
   */
  readonly initialDifficulty: string;
  readonly playerName: string | null;
  readonly signedIn: boolean;
}

type IntroPhase = "pending" | "playing" | "done";

const reloadPage = () => window.location.reload();

/**
 * The full-screen game: a three.js canvas driven by the engine's GameClient, with a SUPERHOT-style
 * HUD on top. React only mounts the client and renders from its HUD store; the game loop itself
 * never goes through React.
 *
 * Difficulty: `requested` is what the player asked for (seeds a newly created client and mirrors
 * the URL); what is actually on the board comes from the HUD snapshot, which follows every
 * restart and switch the client makes. It is seeded from the live URL, not `initialDifficulty`:
 * picks rewrite the URL with `replaceState`, and a back/forward restore then replays the page's
 * original render, so only `useSearchParams` matches what the address bar (and a refresh) says.
 */
export function GameView({
  difficulties,
  initialDifficulty,
  playerName,
  signedIn,
}: GameViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [lockRefused, setLockRefused] = useState(false);
  const [intro, setIntro] = useState<IntroPhase>("pending");
  const searchParams = useSearchParams();
  const [requested, setRequested] = useState(() =>
    difficultyFromParams(difficulties, searchParams, initialDifficulty)
  );
  const { save, saveRun } = useRunSaver(signedIn);

  const { client, error } = useGameClient(containerRef, canvasHostRef, {
    onGameOver: (finished) => {
      saveRun(finished).catch(() => {
        // saveRun reports its own failures; nothing may escape into the game loop.
      });
    },
    onLockError: () => setLockRefused(true),
    setupId: requested,
  });
  const hud = useHud(client?.hud ?? null);
  const difficultyId = hud?.difficultyId ?? requested;

  const playing = hud?.status === "playing";
  const active = playing && !hud.paused;

  useEffect(() => {
    if (!active) {
      return;
    }
    setLockRefused(false);
    setIntro((phase) => (phase === "pending" ? "playing" : phase));
  }, [active]);

  const endIntro = useCallback(() => setIntro("done"), []);
  const play = useCallback(() => {
    setLockRefused(false);
    client?.start();
  }, [client]);
  const playAgain = useCallback(() => {
    client?.restart();
    client?.start();
  }, [client]);
  /** Rebuild the board behind the title screen; play still starts from "Click to play". */
  const selectDifficulty = useCallback(
    (id: string) => {
      if (!client) {
        return;
      }
      if (client.setupId !== id) {
        client.restart({ setupId: id });
      }
      setRequested(id);
      replaceDifficultyInUrl(id);
    },
    [client]
  );
  /** From the results card: a fresh run on another army, started by this very click. */
  const switchDifficulty = useCallback(
    (id: string) => {
      if (!client) {
        return;
      }
      client.restart({ setupId: id });
      client.start();
      setRequested(id);
      replaceDifficultyInUrl(id);
    },
    [client]
  );
  const releasePointer = useCallback(() => client?.releasePointer(), [client]);

  const showStart = error === null && (hud === null || (playing && hud.paused));

  return (
    <div
      className={cn(
        "relative h-dvh w-full select-none overflow-hidden bg-[#E9F2F6] font-sans text-[#0A0C0E]",
        active && "cursor-none"
      )}
      ref={containerRef}
    >
      <GameKeyframes />
      <div className="absolute inset-0" ref={canvasHostRef} />
      <CoolVignette />
      {hud && playing ? <PlayingHud active={active} hud={hud} /> : null}
      {intro === "playing" ? <IntroFlash onDone={endIntro} /> : null}
      {showStart ? (
        <StartOverlay
          difficulties={difficulties}
          difficultyId={difficultyId}
          loading={hud === null}
          lockRefused={lockRefused}
          onPlay={play}
          onSelectDifficulty={selectDifficulty}
          playerName={playerName}
          resumed={intro !== "pending"}
          signedIn={signedIn}
        />
      ) : null}
      {hud && !playing && hud.lastResult ? (
        <GameOverLayer
          difficulties={difficulties}
          killedBy={hud.killedBy}
          onPlayAgain={playAgain}
          onReveal={releasePointer}
          onSwitchDifficulty={switchDifficulty}
          result={hud.lastResult}
          saveStatus={saveStatusFor(save, hud.lastResult, signedIn)}
          won={hud.status === "won"}
        />
      ) : null}
      {error === null ? null : <ErrorPanel message={error} />}
    </div>
  );
}

function ErrorPanel({ message }: { readonly message: string }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(233,242,246,0.9)] px-6">
      <div
        className="flex max-w-md flex-col items-center gap-4 text-center"
        role="alert"
      >
        <h2 className="font-black text-4xl uppercase tracking-tight">
          Stalemate
        </h2>
        <p className="text-[rgba(10,12,14,0.7)]">
          The game hit an error and stopped.
        </p>
        <pre className="max-w-full overflow-x-auto bg-white/80 px-3 py-2 font-mono text-[#E80C0C] text-xs">
          {message}
        </pre>
        <div className="flex gap-2">
          <Button
            className="rounded-none bg-[#E80C0C] font-black text-white uppercase tracking-[0.25em] hover:bg-[#C70A0A]"
            onClick={reloadPage}
            type="button"
          >
            Reload
          </Button>
          <Button
            asChild
            className="rounded-none bg-transparent font-semibold text-[#0A0C0E] uppercase tracking-[0.2em] hover:bg-[rgba(10,12,14,0.06)]"
          >
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
