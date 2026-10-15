import { Button } from "@buckshot/ui/components/button";
import Link from "next/link";

const CONTROLS = [
  { action: "move", keys: "WASD" },
  { action: "sprint", keys: "Shift" },
  { action: "aim", keys: "Mouse" },
  { action: "fire", keys: "Click" },
  { action: "reload", keys: "R" },
  { action: "mute", keys: "M" },
  { action: "pause", keys: "Esc" },
] as const;

export interface StartOverlayProps {
  /** The engine is still downloading / initialising. */
  readonly loading: boolean;
  /** The browser refused pointer lock (clicked too soon after Escape). */
  readonly lockRefused: boolean;
  readonly onPlay: () => void;
  readonly playerName: string | null;
  /** True once the run has started, so the overlay reads as a pause screen. */
  readonly resumed: boolean;
  readonly signedIn: boolean;
}

/**
 * Title / pause screen. Its button is the user gesture that grants pointer lock and unlocks
 * WebAudio, which is why play only ever starts from a click here (or on the canvas).
 */
export function StartOverlay({
  loading,
  lockRefused,
  onPlay,
  playerName,
  resumed,
  signedIn,
}: StartOverlayProps) {
  let buttonLabel = "Click to play";
  if (loading) {
    buttonLabel = "Loading…";
  } else if (resumed) {
    buttonLabel = "Click to resume";
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(233,242,246,0.72)] px-6 py-10 backdrop-blur-md">
      <div className="flex max-w-2xl animate-[buckshot-rise_300ms_ease-out_both] flex-col items-center gap-7 text-center text-[#0A0C0E]">
        <p className="font-mono text-[11px] text-[rgba(10,12,14,0.55)] uppercase tracking-[0.45em]">
          {resumed ? "Paused" : "You are the black king"}
        </p>
        <h1 className="font-black text-[clamp(3.25rem,11vw,8.5rem)] uppercase leading-[0.82] tracking-[-0.04em]">
          Buckshot
          <br />
          <span className="text-[#E80C0C]">Gambit</span>
        </h1>
        <p className="font-thin text-[clamp(1rem,2.6vw,1.6rem)] uppercase tracking-[0.32em]">
          Time moves only when you move
        </p>
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-[11px] text-[rgba(10,12,14,0.7)] uppercase tracking-[0.2em]">
          {CONTROLS.map((control) => (
            <li className="flex items-center gap-2" key={control.action}>
              <kbd className="border border-[rgba(10,12,14,0.3)] bg-white/70 px-1.5 py-0.5 font-mono font-semibold text-[#0A0C0E] tracking-normal">
                {control.keys}
              </kbd>
              {control.action}
            </li>
          ))}
        </ul>
        <p className="-mt-3 max-w-md text-[13px] text-[rgba(10,12,14,0.62)] leading-relaxed">
          Shells don't regenerate: single shells drop on empty squares —{" "}
          <span className="font-semibold text-[#0A0C0E]">walk over them</span>{" "}
          before a piece crushes them.
        </p>
        <Button
          className="h-14 rounded-none bg-[#E80C0C] px-12 font-black text-base text-white uppercase tracking-[0.35em] shadow-[0_10px_30px_rgba(232,12,12,0.35)] hover:bg-[#C70A0A]"
          disabled={loading}
          onClick={onPlay}
          type="button"
        >
          {buttonLabel}
        </Button>
        {lockRefused ? (
          <p className="-mt-3 font-mono text-[#E80C0C] text-[11px] uppercase tracking-[0.25em]">
            The browser needs a second — click again
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <Link
            className="text-[rgba(10,12,14,0.65)] underline-offset-4 hover:text-[#0A0C0E] hover:underline"
            href="/"
          >
            ← Back home
          </Link>
          {signedIn ? (
            <span className="text-[rgba(10,12,14,0.55)]">
              Playing as{" "}
              <span className="font-semibold text-[#0A0C0E]">
                {playerName ?? "you"}
              </span>
            </span>
          ) : (
            <Link
              className="font-semibold text-[#E80C0C] underline-offset-4 hover:underline"
              href="/sign-in"
            >
              Sign in to save your runs
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
