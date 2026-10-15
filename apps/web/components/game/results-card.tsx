import type { PieceKind, RunResult } from "@buckshot/core";
import { Button } from "@buckshot/ui/components/button";
import Link from "next/link";
import { accuracyOf, formatGameTime, formatPercent } from "@/lib/format";
import { PIECE_GLYPHS } from "@/lib/pieces";
import type { SaveStatus } from "./use-run-saver";

const MS_PER_SECOND = 1000;
/** Display order, weakest first (a type-only import keeps @buckshot/core out of the first bundle). */
const PIECE_ORDER: readonly PieceKind[] = [
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
];
const SECONDS_PER_MINUTE = 60;

/** Wall-clock duration: "48.2s", or "2:05.4" past a minute. */
const formatRealTime = (ms: number): string => {
  const seconds = ms / MS_PER_SECOND;
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = (seconds - minutes * SECONDS_PER_MINUTE)
    .toFixed(1)
    .padStart(4, "0");
  return `${minutes}:${rest}`;
};

const totalKills = (result: RunResult): number =>
  PIECE_ORDER.reduce((sum, kind) => sum + result.kills[kind], 0);

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10px] text-[rgba(10,12,14,0.55)] uppercase tracking-[0.3em]">
        {label}
      </dt>
      <dd className="font-black text-3xl tabular-nums tracking-tight">
        {value}
      </dd>
    </div>
  );
}

function SaveLine({ status }: { readonly status: SaveStatus }) {
  if (status.kind === "signed-out") {
    return (
      <p className="text-[rgba(10,12,14,0.65)] text-sm">
        <Link
          className="font-semibold text-[#E80C0C] underline-offset-4 hover:underline"
          href="/sign-in"
        >
          Sign in to save your runs
        </Link>{" "}
        and climb the leaderboard.
      </p>
    );
  }
  const text: Record<SaveStatus["kind"], string> = {
    failed: "This run was not saved.",
    saved: "Run saved.",
    saving: "Saving run…",
    "signed-out": "",
  };
  return (
    <p className="font-mono text-[11px] text-[rgba(10,12,14,0.6)] uppercase tracking-[0.25em]">
      {text[status.kind]}
    </p>
  );
}

export interface ResultsCardProps {
  readonly onPlayAgain: () => void;
  readonly result: RunResult;
  readonly saveStatus: SaveStatus;
}

/** Post-run stats with the three ways out: again, leaderboard, home. Shared by win and loss. */
export function ResultsCard({
  onPlayAgain,
  result,
  saveStatus,
}: ResultsCardProps) {
  const personalBest = saveStatus.kind === "saved" && saveStatus.personalBest;
  const kills = totalKills(result);
  const killedKinds = PIECE_ORDER.filter((kind) => result.kills[kind] > 0);
  return (
    <section
      aria-label="Run results"
      className="pointer-events-auto relative w-[min(92vw,30rem)] animate-[buckshot-rise_320ms_ease-out_both] bg-white/95 p-6 text-[#0A0C0E] shadow-[0_24px_80px_rgba(10,20,32,0.35)]"
    >
      {personalBest ? (
        <span className="absolute -top-3 right-6 bg-[#E80C0C] px-3 py-1 font-black text-[11px] text-white uppercase tracking-[0.3em] shadow-md">
          Personal best
        </span>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
        <Stat label="Game time" value={formatGameTime(result.gameTimeMs)} />
        <Stat label="Real time" value={formatRealTime(result.realTimeMs)} />
        <Stat label="Kills" value={String(kills)} />
        <Stat
          label="Accuracy"
          value={formatPercent(
            accuracyOf(result.pelletsHit, result.pelletsFired)
          )}
        />
      </dl>
      {killedKinds.length > 0 ? (
        <ul
          aria-label="Kills by piece"
          className="mt-4 flex flex-wrap gap-x-3 text-[rgba(10,12,14,0.7)] text-lg tracking-widest"
        >
          {killedKinds.map((kind) => (
            <li className="whitespace-nowrap" key={kind}>
              <span aria-hidden="true">{PIECE_GLYPHS[kind]}</span>
              <span className="ml-1 font-mono text-xs">
                <span className="sr-only">{kind} </span>×{result.kills[kind]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-5 border-[rgba(10,12,14,0.12)] border-t pt-4">
        <SaveLine status={saveStatus} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          className="h-11 flex-1 rounded-none bg-[#E80C0C] font-black text-white uppercase tracking-[0.25em] hover:bg-[#C70A0A]"
          onClick={onPlayAgain}
          type="button"
        >
          Play again
        </Button>
        <Button
          asChild
          className="h-11 rounded-none border border-[rgba(10,12,14,0.25)] bg-transparent font-semibold text-[#0A0C0E] uppercase tracking-[0.2em] hover:bg-[rgba(10,12,14,0.06)]"
        >
          <Link href="/leaderboard">Leaderboard</Link>
        </Button>
        <Button
          asChild
          className="h-11 rounded-none bg-transparent font-semibold text-[#0A0C0E] uppercase tracking-[0.2em] hover:bg-[rgba(10,12,14,0.06)]"
        >
          <Link href="/">Home</Link>
        </Button>
      </div>
    </section>
  );
}
