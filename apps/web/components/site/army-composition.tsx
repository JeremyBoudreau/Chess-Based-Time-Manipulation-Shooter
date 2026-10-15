import type { SetupDefinition } from "@buckshot/core";
import { cn } from "@buckshot/ui/lib/utils";
import { capitalize } from "@/lib/format";
import { armyOf, countPieces, PIECE_GLYPHS } from "@/lib/pieces";

/**
 * A setup's white army as glyph ×count chips. The glyphs are decorative to screen readers, which
 * hear "5 pawns" instead of five "white chess pawn" announcements.
 */
export function ArmyComposition({
  className,
  setup,
}: {
  readonly className?: string;
  readonly setup: SetupDefinition;
}) {
  return (
    <ul
      aria-label={`${setup.name} army`}
      className={cn("flex flex-wrap items-end gap-x-4 gap-y-2", className)}
    >
      {armyOf(setup).map(({ count, kind }) => (
        <li
          className="flex items-baseline gap-1"
          key={kind}
          title={capitalize(countPieces(count, kind))}
        >
          <span aria-hidden="true" className="text-3xl leading-none">
            {PIECE_GLYPHS[kind]}
          </span>
          <span
            aria-hidden="true"
            className="font-mono font-semibold text-muted-foreground text-xs tabular-nums"
          >
            ×{count}
          </span>
          <span className="sr-only">{countPieces(count, kind)}</span>
        </li>
      ))}
    </ul>
  );
}
