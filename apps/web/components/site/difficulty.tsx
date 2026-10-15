import { SETUPS } from "@buckshot/core";
import { cn } from "@buckshot/ui/lib/utils";
import Link from "next/link";
import { withDifficulty } from "@/lib/difficulty";

/** 1 for the easiest setup; SETUPS is ordered easiest first. */
export const difficultyLevel = (setupId: string): number =>
  SETUPS.findIndex((setup) => setup.id === setupId) + 1;

/** One tilted square per difficulty, filled up to this one's — the logo's diamond as a meter. */
export function DifficultyPips({ setupId }: { readonly setupId: string }) {
  const level = difficultyLevel(setupId);
  return (
    <span
      aria-label={`Difficulty ${level} of ${SETUPS.length}`}
      className="flex items-center gap-1.5"
      role="img"
    >
      {SETUPS.map((setup, index) => (
        <span
          className={cn(
            "size-2 rotate-45",
            index < level ? "bg-blood" : "bg-white/15"
          )}
          key={setup.id}
        />
      ))}
    </span>
  );
}

/**
 * Links rather than client tabs, so the choice lives in the URL: the page renders it on the server
 * and the link can be shared. Scroll is kept because the switcher sits below the page heading.
 */
export function DifficultySwitcher({
  basePath,
  className,
  current,
}: {
  readonly basePath: string;
  readonly className?: string;
  readonly current: string;
}) {
  return (
    <nav
      aria-label="Difficulty"
      className={cn(
        "inline-flex w-fit rounded-lg border border-white/10 bg-card/60 p-1",
        className
      )}
    >
      {SETUPS.map((setup) => {
        const active = setup.id === current;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-4 py-2 font-black text-muted-foreground text-xs uppercase tracking-[0.2em] transition-colors hover:text-foreground sm:px-5",
              active &&
                "bg-blood text-primary-foreground hover:text-primary-foreground"
            )}
            href={withDifficulty(basePath, setup.id)}
            key={setup.id}
            scroll={false}
          >
            {setup.name}
          </Link>
        );
      })}
    </nav>
  );
}
