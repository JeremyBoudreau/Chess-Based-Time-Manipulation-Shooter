import {
  DEFAULT_PIECE_CATALOG,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
  maxTimeScale,
  PIECE_KINDS,
} from "@buckshot/core";
import { Button } from "@buckshot/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@buckshot/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buckshot/ui/components/table";
import Link from "next/link";
import { SectionHeading } from "@/components/site/section-heading";
import { capitalize } from "@/lib/format";
import { PIECE_BLURBS, PIECE_GLYPHS } from "@/lib/pieces";
import { getViewer } from "@/lib/session";

const PILLARS = [
  {
    body: `Two barrels, ${DEFAULT_SHOTGUN.pellets} pellets a shell, a fan of lead that shreds anything adjacent and tickles anything far. Reloading costs time. Spent shells stay spent: fresh shells drop one at a time onto empty squares, and any piece that moves over one crushes it. Every trigger pull is a decision.`,
    credit: "Shotgun King: The Final Checkmate",
    title: "Buckshot vs. bone",
  },
  {
    body: "You are on the board, eye-level with a rook. White plays real chess moves — knights hop, bishops slide, pawns march — and every square they attack is a square you cannot stand on.",
    credit: "FPS Chess",
    title: "Boots on the board",
  },
  {
    body: "Stand still and the world nearly freezes. Walk, turn or reload and the clock runs; sprint and it outruns real time. A piece shakes and blinks red before it strikes: that is your cue to be somewhere else.",
    credit: "SUPERHOT",
    title: "Time is yours",
  },
] as const;

const CONTROLS = [
  {
    action: "Move",
    keys: ["W", "A", "S", "D"],
    note: "Walking is what makes time flow.",
  },
  {
    action: "Sprint",
    keys: ["Shift"],
    note: `${DEFAULT_TIME_POLICY.sprintScale}× speed, and time runs ${DEFAULT_TIME_POLICY.sprintScale}× too — faster than real time.`,
  },
  {
    action: "Aim",
    keys: ["Mouse"],
    note: `Turning moves time too — up to ${Math.round(DEFAULT_TIME_POLICY.lookMaxScale * 100)}% speed.`,
  },
  {
    action: "Fire",
    keys: ["Click"],
    note: `${DEFAULT_SHOTGUN.capacity} barrels, ${DEFAULT_SHOTGUN.pellets} pellets each.`,
  },
  {
    action: "Reload",
    keys: ["R"],
    note: `A reload adds ${DEFAULT_TIME_POLICY.reloadBonus}× to time and stacks with moving — up to ${maxTimeScale(DEFAULT_TIME_POLICY)}× mid-sprint.`,
  },
  {
    action: "Pause",
    keys: ["Esc"],
    note: "Freezes everything, frees the mouse.",
  },
] as const;

const DAMAGE_PER_SHELL =
  DEFAULT_SHOTGUN.pellets * DEFAULT_SHOTGUN.damagePerPellet;

const ENEMIES = PIECE_KINDS.map((kind) => DEFAULT_PIECE_CATALOG[kind]).toSorted(
  (a, b) => a.maxHp - b.maxHp
);

const MAX_ENEMY_HP = Math.max(...ENEMIES.map((piece) => piece.maxHp));

/** Faint checkerboard in perspective behind the hero — the board you will be standing on. */
function BoardBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.62_0.235_25/0.22),transparent_60%)]" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 [perspective:700px]">
        <div className="absolute inset-x-[-50%] inset-y-0 origin-bottom bg-[length:88px_88px] bg-[repeating-conic-gradient(oklch(1_0_0/0.07)_0_25%,transparent_0_50%)] [mask-image:linear-gradient(to_top,black,transparent)] [transform:rotateX(62deg)]" />
      </div>
    </div>
  );
}

function Kbd({ children }: { readonly children: string }) {
  return (
    <kbd className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-white/15 border-b-[3px] bg-white/5 px-2.5 font-mono font-semibold text-sm uppercase">
      {children}
    </kbd>
  );
}

export default async function HomePage() {
  const viewer = await getViewer();

  return (
    <>
      <section className="relative isolate overflow-hidden">
        <BoardBackdrop />
        <div className="mx-auto max-w-6xl px-4 pt-16 pb-28 sm:px-6 sm:pt-28 sm:pb-40">
          <p className="mb-6 flex items-center gap-2 font-mono text-blood text-xs uppercase tracking-[0.3em]">
            <span aria-hidden="true" className="size-1.5 rotate-45 bg-blood" />
            First-person chess with a shotgun
          </p>
          <h1 className="font-black text-[clamp(2.6rem,9vw,7.5rem)] uppercase leading-[0.86] tracking-tighter">
            <span className="block">You are the</span>
            <span className="block">king.</span>
            <span className="block">
              You have a <span className="text-blood">shotgun.</span>
            </span>
            <span className="mt-5 block text-[0.5em] text-muted-foreground leading-none tracking-tight sm:text-[0.42em] sm:text-transparent sm:[-webkit-text-stroke:1.5px_oklch(0.96_0.003_286/0.75)]">
              Time only moves when you move.
            </span>
          </h1>

          <div className="mt-12 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <Button
              asChild
              className="h-14 px-10 font-black text-base uppercase tracking-[0.25em] shadow-[0_0_48px_-10px_var(--blood)]"
              size="lg"
            >
              <Link href="/play">Play ▸</Link>
            </Button>
            {viewer ? (
              <Link
                className="text-muted-foreground text-sm hover:text-foreground"
                href="/profile"
              >
                Playing as{" "}
                <span className="font-semibold text-foreground">
                  {viewer.user.name}
                </span>{" "}
                — every run is saved.
              </Link>
            ) : (
              <Link
                className="font-semibold text-sm uppercase tracking-widest underline-offset-8 hover:text-blood hover:underline"
                href="/sign-up"
              >
                Sign up to save your runs →
              </Link>
            )}
          </div>

          <dl className="mt-16 grid max-w-2xl grid-cols-2 gap-4 border-white/10 border-t pt-6 font-mono text-xs uppercase tracking-widest sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Shells</dt>
              <dd className="mt-1 text-foreground text-lg">
                {DEFAULT_SHOTGUN.capacity}+{DEFAULT_SHOTGUN.reserveMax}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Hit points</dt>
              <dd className="mt-1 text-blood text-lg">1</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Idle time</dt>
              <dd className="mt-1 text-foreground text-lg">
                ×{DEFAULT_TIME_POLICY.idleScale}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sprint time</dt>
              <dd className="mt-1 text-foreground text-lg">
                ×{DEFAULT_TIME_POLICY.sprintScale}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading kicker="How it plays">
          Three games
          <br />
          walk onto a board
        </SectionHeading>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar, index) => (
            <Card
              className="border-white/10 bg-card/60 transition-colors hover:border-blood/50"
              key={pillar.title}
            >
              <CardHeader>
                <p className="font-mono text-blood text-xs">
                  0{index + 1} / after {pillar.credit}
                </p>
                <CardTitle className="font-black text-2xl uppercase tracking-tight">
                  {pillar.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  {pillar.body}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-white/5 border-y bg-card/30">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.4fr]">
          <SectionHeading kicker="Controls">
            Six
            <br />
            inputs.
            <br />
            One life.
          </SectionHeading>
          <ul className="flex flex-col divide-y divide-white/5">
            {CONTROLS.map((control) => (
              <li
                className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4"
                key={control.action}
              >
                <span className="flex min-w-44 gap-1.5">
                  {control.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
                <span className="w-20 font-black text-lg uppercase tracking-tight">
                  {control.action}
                </span>
                <span className="text-muted-foreground text-sm">
                  {control.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading kicker="The enemy">
          Bone-white
          <br />
          and out for blood
        </SectionHeading>
        <p className="mt-6 max-w-2xl text-muted-foreground">
          The white army moves by chess rules and hits like a truck: if a piece
          acts while it attacks your square, you are captured. A point-blank
          shell deals {DAMAGE_PER_SHELL} damage — if every pellet lands.
        </p>
        <div className="mt-10 rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Piece</TableHead>
                <TableHead className="w-1/3">Hit points</TableHead>
                <TableHead>Point-blank shells</TableHead>
                <TableHead className="hidden md:table-cell">Intel</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENEMIES.map((piece) => (
                <TableRow key={piece.kind}>
                  <TableCell className="pl-4">
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="text-3xl leading-none"
                      >
                        {PIECE_GLYPHS[piece.kind]}
                      </span>
                      <span className="font-bold uppercase tracking-wide">
                        {capitalize(piece.kind)}
                      </span>
                      {piece.kind === "king" && (
                        <span className="rounded-full bg-blood px-2 py-0.5 font-bold text-[10px] text-primary-foreground uppercase tracking-widest">
                          Target
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-3">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-blood"
                          style={{
                            width: `${(piece.maxHp / MAX_ENEMY_HP) * 100}%`,
                          }}
                        />
                      </span>
                      <span className="w-6 text-right font-mono font-semibold tabular-nums">
                        {piece.maxHp}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {Math.ceil(piece.maxHp / DAMAGE_PER_SHELL)}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal text-muted-foreground md:table-cell">
                    {PIECE_BLURBS[piece.kind]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="relative isolate overflow-hidden border-white/5 border-t">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_bottom,oklch(0.62_0.235_25/0.25),transparent_65%)]"
        />
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-24 sm:px-6 sm:py-32">
          <p className="font-black text-5xl uppercase leading-[0.9] tracking-tighter sm:text-7xl">
            The board is set.
            <br />
            <span className="text-blood">Your move.</span>
          </p>
          <Button
            asChild
            className="h-14 px-10 font-black text-base uppercase tracking-[0.25em]"
            size="lg"
          >
            <Link href="/play">Play ▸</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
