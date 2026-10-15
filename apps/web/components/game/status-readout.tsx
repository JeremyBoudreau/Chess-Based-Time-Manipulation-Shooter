const range = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

export interface StatusReadoutProps {
  readonly gameTime: number;
  readonly muted: boolean;
  readonly timeScale: number;
  readonly whiteKingHp: number | null;
  readonly whiteKingMaxHp: number | null;
}

/**
 * Tiny monospace readout, bottom-right: the flow of time (the one number SUPERHOT players watch)
 * and how much the white king has left. Dark ink because the world behind it is near-white.
 */
export function StatusReadout({
  gameTime,
  muted,
  timeScale,
  whiteKingHp,
  whiteKingMaxHp,
}: StatusReadoutProps) {
  const flowing = timeScale >= 0.5;
  return (
    <div className="pointer-events-none absolute right-6 bottom-6 flex select-none flex-col items-end gap-1.5 font-mono text-[11px] text-[rgba(10,12,14,0.72)] uppercase tracking-[0.25em]">
      {muted ? <span className="text-[rgba(10,12,14,0.5)]">Muted</span> : null}
      {whiteKingHp !== null && whiteKingMaxHp !== null ? (
        <div className="flex items-center gap-2">
          <span className="text-base leading-none tracking-normal">♔</span>
          <div
            aria-label={`White king health ${whiteKingHp} of ${whiteKingMaxHp}`}
            className="flex gap-[2px]"
            role="img"
          >
            {range(whiteKingMaxHp).map((point) => (
              <span
                className={`block h-2.5 w-1.5 border border-[rgba(10,12,14,0.55)] ${
                  point < whiteKingHp ? "bg-[rgba(10,12,14,0.8)]" : ""
                }`}
                key={`hp-${point}`}
              />
            ))}
          </div>
          <span className="tabular-nums tracking-normal">
            {whiteKingHp}/{whiteKingMaxHp}
          </span>
        </div>
      ) : null}
      <div className="flex gap-4 tabular-nums">
        <span>{gameTime.toFixed(1)}s</span>
        <span className={flowing ? "text-[#E80C0C]" : undefined}>
          Time ×{timeScale.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
