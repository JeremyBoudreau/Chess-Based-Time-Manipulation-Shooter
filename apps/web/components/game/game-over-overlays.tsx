"use client";

import type { PieceKind, RunResult } from "@buckshot/core";
import { useEffect, useState } from "react";
import { ResultsCard } from "./results-card";
import type { SaveStatus } from "./use-run-saver";

/** Seconds of CHECK/MATE alternation before the results card: 6 beats × 0.85 s ≈ 5 s. */
const CHANT_BEATS = 6;
const BEAT_MS = 850;
/** Let the renderer's death camera play before covering it. */
const LOSS_REVEAL_DELAY_MS = 1500;
const SKIP_KEYS = new Set(["Enter", "Space", "Escape"]);

const GLOW = "0 0 12px #7FE7FF, 0 0 36px rgba(127, 231, 255, 0.55)";

interface GameOverOverlayProps {
  readonly onPlayAgain: () => void;
  /** Called once when the results card appears (the client then frees the cursor). */
  readonly onReveal: () => void;
  readonly result: RunResult;
  readonly saveStatus: SaveStatus;
}

function RestartHint() {
  return (
    <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-white/80 uppercase tracking-[0.35em]">
      press R to restart instantly
    </p>
  );
}

/**
 * Victory: the SUPERHOT chant, "CHECK" (hairline) / "MATE" (black, near full width) slamming in
 * alternation over a dimmed, blue-tinted, blurred scene, then the results card. Any click or
 * Enter/Space skips the chant.
 */
export function WinOverlay({
  onPlayAgain,
  onReveal,
  result,
  saveStatus,
}: GameOverOverlayProps) {
  const [beat, setBeat] = useState(0);
  const revealed = beat >= CHANT_BEATS;

  // One timer per beat (re-armed on every beat change) so a skip cancels the pending one cleanly.
  useEffect(() => {
    if (beat >= CHANT_BEATS) {
      return;
    }
    const timer = setTimeout(() => setBeat(beat + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [beat]);

  useEffect(() => {
    if (revealed) {
      onReveal();
      return;
    }
    const skip = () => setBeat(CHANT_BEATS);
    const onKey = (event: KeyboardEvent) => {
      if (SKIP_KEYS.has(event.code)) {
        skip();
      }
    };
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", onKey);
    };
  }, [revealed, onReveal]);

  const mate = beat % 2 === 1;
  return (
    <div className="buckshot-motion absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 overflow-hidden bg-[rgba(22,48,72,0.42)] backdrop-blur-[6px]">
      {revealed ? (
        <>
          <h2
            className="animate-[buckshot-slam_150ms_ease-out_both] text-center font-black text-[clamp(3rem,11vw,9rem)] text-white uppercase leading-none tracking-tight"
            style={{ textShadow: GLOW }}
          >
            Check<span className="font-thin">mate</span>
          </h2>
          <ResultsCard
            onPlayAgain={onPlayAgain}
            result={result}
            saveStatus={saveStatus}
          />
          <RestartHint />
        </>
      ) : (
        <p
          aria-live="assertive"
          className={`animate-[buckshot-slam_150ms_ease-out_both] select-none whitespace-nowrap text-center text-white uppercase leading-none ${
            mate
              ? "font-black text-[30vw] tracking-[-0.04em]"
              : "font-thin text-[24vw] tracking-tight"
          }`}
          key={`beat-${beat}`}
          style={{ textShadow: GLOW }}
        >
          {mate ? "MATE" : "CHECK"}
        </p>
      )}
    </div>
  );
}

/**
 * Defeat: after the death camera has had its moment, "CHECKMATED by the <piece>", the results
 * card, and the instant-restart hint.
 */
export function LossOverlay({
  killedBy,
  onPlayAgain,
  onReveal,
  result,
  saveStatus,
}: GameOverOverlayProps & { readonly killedBy: PieceKind | null }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), LOSS_REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (revealed) {
      onReveal();
    }
  }, [revealed, onReveal]);

  if (!revealed) {
    return null;
  }
  return (
    <div className="buckshot-motion absolute inset-0 z-30 flex animate-[buckshot-fade-in_400ms_ease-out_both] flex-col items-center justify-center gap-6 overflow-hidden bg-[rgba(48,8,10,0.38)] backdrop-blur-[3px]">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2
          className="animate-[buckshot-slam_150ms_ease-out_both] font-black text-[#E80C0C] text-[clamp(3rem,12vw,10rem)] uppercase leading-none tracking-tight"
          style={{ textShadow: "0 0 18px rgba(255, 255, 255, 0.55)" }}
        >
          Checkmated
        </h2>
        {killedBy ? (
          <p className="font-thin text-2xl text-white uppercase tracking-[0.4em] sm:text-3xl">
            by the {killedBy}
          </p>
        ) : null}
      </div>
      <ResultsCard
        onPlayAgain={onPlayAgain}
        result={result}
        saveStatus={saveStatus}
      />
      <RestartHint />
    </div>
  );
}

/** Picks the win or loss overlay; mounted fresh for every finished run. */
export function GameOverLayer({
  killedBy,
  won,
  ...props
}: GameOverOverlayProps & {
  readonly killedBy: PieceKind | null;
  readonly won: boolean;
}) {
  return won ? (
    <WinOverlay {...props} />
  ) : (
    <LossOverlay killedBy={killedBy} {...props} />
  );
}
