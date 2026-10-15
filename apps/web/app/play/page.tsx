import { DEFAULT_SETUP, isDifficulty, SETUPS } from "@buckshot/core";
import type { Metadata } from "next";
import { describeDifficulties } from "@/components/game/difficulty";
import { GameView } from "@/components/game/game-view";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Play" };

/** Built once per server process: the setups are static data. */
const DIFFICULTIES = describeDifficulties(SETUPS);

/** A missing, repeated or unknown `?difficulty=` falls back to the default (Easy) army. */
const resolveDifficulty = (value: string | string[] | undefined): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && isDifficulty(candidate)
    ? candidate
    : DEFAULT_SETUP.id;
};

/**
 * Full-screen game, outside the (site) group so no header renders. Reads the session per request;
 * `?difficulty=easy|medium|hard` picks the army the board starts with.
 */
export default async function PlayPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ difficulty?: string | string[] }>;
}) {
  const [viewer, { difficulty }] = await Promise.all([
    getViewer(),
    searchParams,
  ]);
  return (
    <GameView
      difficulties={DIFFICULTIES}
      initialDifficulty={resolveDifficulty(difficulty)}
      playerName={viewer?.user.name ?? null}
      signedIn={viewer !== null}
    />
  );
}
