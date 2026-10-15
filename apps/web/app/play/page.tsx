import type { Metadata } from "next";
import { GameView } from "@/components/game/game-view";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Play" };

/** Full-screen game, outside the (site) group so no header renders. Reads the session per request. */
export default async function PlayPage() {
  const viewer = await getViewer();
  return (
    <GameView
      playerName={viewer?.user.name ?? null}
      signedIn={viewer !== null}
    />
  );
}
