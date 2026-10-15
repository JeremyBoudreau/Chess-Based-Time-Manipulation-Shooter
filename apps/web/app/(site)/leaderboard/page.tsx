import { RunRepository } from "@buckshot/db";
import { Badge } from "@buckshot/ui/components/badge";
import { Button } from "@buckshot/ui/components/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buckshot/ui/components/table";
import { cn } from "@buckshot/ui/lib/utils";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArmyComposition } from "@/components/site/army-composition";
import {
  DifficultyPips,
  DifficultySwitcher,
} from "@/components/site/difficulty";
import { SectionHeading } from "@/components/site/section-heading";
import { setupFromParam, withDifficulty } from "@/lib/difficulty";
import { formatGameTime } from "@/lib/format";
import { runServer } from "@/lib/server-runtime";
import { getViewer } from "@/lib/session";

interface LeaderboardProps {
  /** `?difficulty=` picks the board; anything missing or unknown shows Easy. */
  readonly searchParams: Promise<{ difficulty?: string | string[] }>;
}

export async function generateMetadata({
  searchParams,
}: LeaderboardProps): Promise<Metadata> {
  const setup = setupFromParam((await searchParams).difficulty);
  return { title: `Leaderboard · ${setup.name}` };
}

const loadLeaderboard = (setupId: string) =>
  runServer(
    Effect.gen(function* () {
      const runs = yield* RunRepository;
      return yield* runs.leaderboard({ setupId });
    })
  );

interface BoardColumn {
  readonly className?: string;
  readonly label: string;
}

interface BoardRow {
  readonly cells: readonly ReactNode[];
  readonly name: string;
  readonly userId: string;
}

/** One ranked table; the viewer's own row is tinted so they can find themselves at a glance. */
function BoardTable({
  caption,
  columns,
  empty,
  play,
  rows,
  viewerId,
}: {
  readonly caption: string;
  readonly columns: readonly BoardColumn[];
  readonly empty: string;
  /** Where the empty state's Play button goes: the difficulty this board ranks. */
  readonly play: { readonly href: string; readonly label: string };
  readonly rows: readonly BoardRow[];
  readonly viewerId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-xl border border-white/15 border-dashed p-8">
        <p className="text-muted-foreground">{empty}</p>
        <Button asChild size="sm">
          <Link href={play.href}>{play.label}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10">
      <Table>
        <TableCaption className="px-4 pb-4 text-left">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 pl-4">#</TableHead>
            <TableHead>Player</TableHead>
            {columns.map((column) => (
              <TableHead className={column.className} key={column.label}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const isViewer = row.userId === viewerId;
            return (
              <TableRow
                aria-current={isViewer ? "true" : undefined}
                className={cn(isViewer && "bg-blood/10 hover:bg-blood/15")}
                key={row.userId}
              >
                <TableCell
                  className={cn(
                    "pl-4 font-black font-mono tabular-nums",
                    index === 0 ? "text-blood" : "text-muted-foreground"
                  )}
                >
                  {index + 1}
                </TableCell>
                <TableCell className="max-w-48 truncate font-semibold">
                  {row.name}
                  {isViewer && (
                    <Badge className="ml-2 align-middle" variant="default">
                      You
                    </Badge>
                  )}
                </TableCell>
                {row.cells.map((cell, cellIndex) => (
                  <TableCell
                    className={cn(
                      "font-mono tabular-nums",
                      columns[cellIndex]?.className
                    )}
                    key={columns[cellIndex]?.label ?? cellIndex}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: LeaderboardProps) {
  const setup = setupFromParam((await searchParams).difficulty);
  const [board, viewer] = await Promise.all([
    loadLeaderboard(setup.id),
    getViewer(),
  ]);
  const viewerId = viewer?.user.id ?? null;
  const play = {
    href: withDifficulty("/play", setup.id),
    label: `Play ${setup.name}`,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading kicker="Leaderboard">
        The black side&apos;s
        <br />
        finest kings
      </SectionHeading>

      <DifficultySwitcher
        basePath="/leaderboard"
        className="mt-10"
        current={setup.id}
      />

      {/* Names the army this page ranks: times and kills only compare within one difficulty. */}
      <div className="mt-6 flex flex-col gap-5 border-white/10 border-y py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-3 font-mono text-blood text-xs uppercase tracking-[0.3em]">
            {setup.name} army
            <DifficultyPips setupId={setup.id} />
          </p>
          <p className="max-w-xl text-muted-foreground text-sm">
            {setup.description} {setup.white.length} pieces, ranked apart from
            the other difficulties.
          </p>
        </div>
        <ArmyComposition setup={setup} />
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <section
          aria-labelledby="fastest-regicides"
          className="flex flex-col gap-4"
        >
          <div>
            <h3
              className="font-black text-2xl uppercase tracking-tight"
              id="fastest-regicides"
            >
              Fastest regicides
            </h3>
            <p className="text-muted-foreground text-sm">
              Best winning game-time per player on {setup.name}.
            </p>
          </div>
          <BoardTable
            caption={`${setup.name} wins only. Game-time only ticks while you move, turn or reload — standing still is (almost) free, sprinting burns it faster than real time. Lower is better.`}
            columns={[
              { label: "Best time" },
              { className: "hidden sm:table-cell", label: "Wins" },
            ]}
            empty={`No king has fallen on ${setup.name} yet. Be the first regicide.`}
            play={play}
            rows={board.fastestWins.map((entry) => ({
              cells: [formatGameTime(entry.bestGameTimeMs), entry.wins],
              name: entry.name,
              userId: entry.userId,
            }))}
            viewerId={viewerId}
          />
        </section>

        <section aria-labelledby="butchers" className="flex flex-col gap-4">
          <div>
            <h3
              className="font-black text-2xl uppercase tracking-tight"
              id="butchers"
            >
              Butchers
            </h3>
            <p className="text-muted-foreground text-sm">
              Most white pieces destroyed across every {setup.name} run.
            </p>
          </div>
          <BoardTable
            caption={`Every piece of the ${setup.name} army counts, promoted queens included — win or lose.`}
            columns={[
              { label: "Kills" },
              { className: "hidden sm:table-cell", label: "Runs" },
            ]}
            empty={`Nobody has shed white blood on ${setup.name} yet.`}
            play={play}
            rows={board.mostKills.map((entry) => ({
              cells: [entry.totalKills, entry.games],
              name: entry.name,
              userId: entry.userId,
            }))}
            viewerId={viewerId}
          />
        </section>
      </div>
    </div>
  );
}
