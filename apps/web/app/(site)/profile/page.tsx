import { findSetup, SETUPS, type SetupDefinition } from "@buckshot/core";
import { type DifficultyStats, RunRepository } from "@buckshot/db";
import { Badge } from "@buckshot/ui/components/badge";
import { Button } from "@buckshot/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buckshot/ui/components/table";
import { cn } from "@buckshot/ui/lib/utils";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DifficultyPips } from "@/components/site/difficulty";
import { LocalTime } from "@/components/site/local-time";
import { SectionHeading } from "@/components/site/section-heading";
import { withDifficulty } from "@/lib/difficulty";
import {
  accuracyOf,
  capitalize,
  formatGameTime,
  formatPercent,
} from "@/lib/format";
import { PIECE_GLYPHS } from "@/lib/pieces";
import { withNext } from "@/lib/safe-next";
import { runServer } from "@/lib/server-runtime";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Profile" };

const RECENT_RUNS = 20;

const loadProfile = (userId: string) =>
  runServer(
    Effect.gen(function* () {
      const runs = yield* RunRepository;
      return yield* Effect.all(
        {
          recent: runs.listForUser(userId, RECENT_RUNS),
          stats: runs.statsForUser(userId),
        },
        { concurrency: "unbounded" }
      );
    })
  );

function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-card/60 p-5">
      <dt className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </dt>
      <dd
        className={cn(
          "font-black text-3xl uppercase tabular-nums tracking-tight",
          accent && "text-blood"
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-muted-foreground text-xs">{hint}</dd> : null}
    </div>
  );
}

const runsLabel = (count: number): string =>
  `${count} ${count === 1 ? "run" : "runs"}`;

/** What the player has done on a difficulty, for the line under its best time. */
const recordHint = (record: DifficultyStats | undefined): string => {
  if (!record || record.games === 0) {
    return "Not played yet";
  }
  return record.wins > 0
    ? `${record.wins} of ${runsLabel(record.games)} won`
    : `${runsLabel(record.games)}, no regicide yet`;
};

/**
 * One difficulty's fastest win. Each army gets its own card because a Hard clear is slower than
 * an Easy one by design, so a single best time across difficulties would only ever show Easy.
 */
function BestTimeCard({
  record,
  setup,
}: {
  readonly record: DifficultyStats | undefined;
  readonly setup: SetupDefinition;
}) {
  const best = record?.bestWinGameTimeMs ?? null;
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/10 bg-card/60 p-5">
      <dt className="flex items-center justify-between gap-3 font-mono text-muted-foreground text-xs uppercase tracking-widest">
        {setup.name}
        <DifficultyPips setupId={setup.id} />
      </dt>
      <dd
        className={cn(
          "font-black text-3xl tabular-nums tracking-tight",
          best !== null && "text-blood"
        )}
      >
        {best === null ? "—" : formatGameTime(best)}
      </dd>
      <dd className="text-muted-foreground text-xs">{recordHint(record)}</dd>
      <dd className="mt-3 flex gap-4 font-semibold text-xs uppercase tracking-widest">
        <Link
          className="text-blood hover:underline"
          href={withDifficulty("/play", setup.id)}
        >
          Play ▸
        </Link>
        <Link
          className="text-muted-foreground hover:text-foreground"
          href={withDifficulty("/leaderboard", setup.id)}
        >
          Leaderboard
        </Link>
      </dd>
    </div>
  );
}

/** The stored id's difficulty name; legacy ids ("skirmish") show as the setup they now mean. */
const difficultyName = (setupId: string): string =>
  findSetup(setupId)?.name ?? setupId;

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (!viewer) {
    redirect(withNext("/sign-in", "/profile"));
  }

  const { recent, stats } = await loadProfile(viewer.user.id);
  const winRate = stats.games > 0 ? stats.wins / stats.games : 0;
  const recordOn = (setup: SetupDefinition) =>
    stats.difficulties.find((record) => record.setupId === setup.id);
  // "Play again" means the difficulty of the last run, not always the default.
  const lastSetup = recent[0] ? findSetup(recent[0].setupId) : undefined;
  const hardestWin = SETUPS.findLast(
    (setup) => (recordOn(setup)?.wins ?? 0) > 0
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <SectionHeading kicker="Callsign">
            <span className="break-all">{viewer.user.name}</span>
          </SectionHeading>
          <p className="mt-3 text-muted-foreground text-sm">
            {viewer.user.email}
          </p>
        </div>
        <Button
          asChild
          className="h-12 px-8 font-black uppercase tracking-[0.2em]"
          size="lg"
        >
          <Link
            href={lastSetup ? withDifficulty("/play", lastSetup.id) : "/play"}
          >
            {stats.games > 0 ? "Play again ▸" : "Play ▸"}
          </Link>
        </Button>
      </div>

      <dl className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Games" value={String(stats.games)} />
        <StatCard
          hint={`${stats.losses} captured`}
          label="Wins"
          value={String(stats.wins)}
        />
        <StatCard label="Win rate" value={formatPercent(winRate)} />
        <StatCard
          accent
          hint="highest difficulty beaten"
          label="Hardest win"
          value={hardestWin?.name ?? "—"}
        />
        <StatCard
          hint={`${stats.kingsKilled} kings among them`}
          label="Kills"
          value={String(stats.totalKills)}
        />
        <StatCard
          hint="pellets hit / fired"
          label="Accuracy"
          value={formatPercent(stats.accuracy)}
        />
        <StatCard
          accent
          hint="captured you most"
          label="Nemesis"
          value={
            stats.nemesis
              ? `${PIECE_GLYPHS[stats.nemesis]} ${capitalize(stats.nemesis)}`
              : "—"
          }
        />
        <StatCard
          hint="killed most often"
          label="Favourite victim"
          value={
            stats.favouriteVictim
              ? `${PIECE_GLYPHS[stats.favouriteVictim]} ${capitalize(stats.favouriteVictim)}`
              : "—"
          }
        />
      </dl>

      <section
        aria-labelledby="best-times"
        className="mt-16 flex flex-col gap-4"
      >
        <div>
          <h3
            className="font-black text-2xl uppercase tracking-tight"
            id="best-times"
          >
            Best times
          </h3>
          <p className="text-muted-foreground text-sm">
            Fastest winning game-time on each difficulty. Lower is better.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {SETUPS.map((setup) => (
            <BestTimeCard
              key={setup.id}
              record={recordOn(setup)}
              setup={setup}
            />
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="recent-runs"
        className="mt-16 flex flex-col gap-4"
      >
        <h3
          className="font-black text-2xl uppercase tracking-tight"
          id="recent-runs"
        >
          Recent runs
        </h3>
        {recent.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-xl border border-white/15 border-dashed p-8">
            <p className="text-muted-foreground">
              No runs yet. Finish a game — win or lose — and it lands here.
            </p>
            <Button asChild size="sm">
              <Link href="/play">Play</Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Outcome</TableHead>
                  <TableHead>Difficulty</TableHead>
                  <TableHead>Game-time</TableHead>
                  <TableHead>Kills</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Killed by</TableHead>
                  <TableHead className="pr-4 text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="pl-4">
                      {run.outcome === "won" ? (
                        <Badge>Regicide</Badge>
                      ) : (
                        <Badge variant="secondary">Captured</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {difficultyName(run.setupId)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatGameTime(run.gameTimeMs)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {run.totalKills}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {formatPercent(
                        accuracyOf(run.pelletsHit, run.pelletsFired)
                      )}
                    </TableCell>
                    <TableCell>
                      {run.killedBy
                        ? `${PIECE_GLYPHS[run.killedBy]} ${capitalize(run.killedBy)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground">
                      <LocalTime iso={run.createdAt.toISOString()} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
