const range = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

export interface StatusReadoutProps {
  /** "Easy" / "Medium" / "Hard": which army this run is against. */
  readonly difficultyName: string;
  readonly gameTime: number;
  /** Shift held while moving (time is outrunning real time). */
  readonly sprinting: boolean;
  readonly timeScale: number;
  readonly whiteKingHp: number | null;
  readonly whiteKingMaxHp: number | null;
}

/** Above real speed (sprinting) the readout turns loud: it is the cost of the shortcut. */
const timeClassName = (timeScale: number): string | undefined => {
  if (timeScale > 1) {
    return "font-black text-[#E80C0C] text-[13px]";
  }
  return timeScale >= 0.5 ? "text-[#E80C0C]" : undefined;
};

/**
 * Tiny monospace readout, bottom-right: the flow of time (the one number SUPERHOT players watch),
 * how much the white king has left and the difficulty. Dark ink because the world behind it is
 * near-white.
 */
export function StatusReadout({
  difficultyName,
  gameTime,
  sprinting,
  timeScale,
  whiteKingHp,
  whiteKingMaxHp,
}: StatusReadoutProps) {
  return (
    <div className="pointer-events-none absolute right-6 bottom-6 flex select-none flex-col items-end gap-1.5 font-mono text-[11px] text-[rgba(10,12,14,0.72)] uppercase tracking-[0.25em]">
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
      <div className="flex items-center gap-4 tabular-nums">
        <span className="border border-[rgba(10,12,14,0.35)] px-1.5 py-0.5 font-semibold text-[10px] leading-none tracking-[0.3em]">
          {difficultyName}
        </span>
        <span>{gameTime.toFixed(1)}s</span>
        {sprinting ? (
          <span className="bg-[#E80C0C] py-0.5 pr-[3px] pl-1.5 font-black text-[10px] text-white leading-none tracking-[0.3em]">
            Sprint
          </span>
        ) : null}
        <span className={timeClassName(timeScale)}>
          Time ×{timeScale.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
