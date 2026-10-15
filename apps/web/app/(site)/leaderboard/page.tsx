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
import { SectionHeading } from "@/components/site/section-heading";
import { formatGameTime } from "@/lib/format";
import { runServer } from "@/lib/server-runtime";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Leaderboard" };

const loadLeaderboard = () =>
  runServer(
    Effect.gen(function* () {
      const runs = yield* RunRepository;
      return yield* runs.leaderboard();
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
  rows,
  viewerId,
}: {
  readonly caption: string;
  readonly columns: readonly BoardColumn[];
  readonly empty: string;
  readonly rows: readonly BoardRow[];
  readonly viewerId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-xl border border-white/15 border-dashed p-8">
        <p className="text-muted-foreground">{empty}</p>
        <Button asChild size="sm">
          <Link href="/play">Play</Link>
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

export default async function LeaderboardPage() {
  const [board, viewer] = await Promise.all([loadLeaderboard(), getViewer()]);
  const viewerId = viewer?.user.id ?? null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <SectionHeading kicker="Leaderboard">
        The black side&apos;s
        <br />
        finest kings
      </SectionHeading>

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
              Best winning game-time per player.
            </p>
          </div>
          <BoardTable
            caption="Game-time only ticks while you move, turn or reload — standing still is (almost) free. Lower is better."
            columns={[
              { label: "Best time" },
              { className: "hidden sm:table-cell", label: "Wins" },
            ]}
            empty="No king has fallen yet. Be the first regicide."
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
              Most white pieces destroyed across every run.
            </p>
          </div>
          <BoardTable
            caption="Every pawn, knight, bishop, rook, queen and king counts — win or lose."
            columns={[
              { label: "Kills" },
              { className: "hidden sm:table-cell", label: "Runs" },
            ]}
            empty="Nobody has shed white blood yet."
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
