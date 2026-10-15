import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-white/5 border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          Buckshot Gambit — a love letter to Shotgun King, FPS Chess and
          SUPERHOT.
        </p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link className="hover:text-foreground" href="/play">
            Play
          </Link>
          <Link className="hover:text-foreground" href="/leaderboard">
            Leaderboard
          </Link>
          <Link className="hover:text-foreground" href="/profile">
            Profile
          </Link>
        </nav>
      </div>
    </footer>
  );
}
