const SHELL_RED = "#E80C0C";
const BRASS = "#E9D9A6";
const BRASS_RIM = "#B8975A";
const INK = "#0A0C0E";

const range = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

/** A big loaded shell: red hull, brass head. Empty barrels are drawn as an outline. */
function ShellIcon({ full }: { readonly full: boolean }) {
  if (!full) {
    return (
      <svg aria-hidden="true" className="h-14 w-6" viewBox="0 0 24 56">
        <rect
          fill="rgba(255, 255, 255, 0.18)"
          height="51"
          rx="3"
          stroke={INK}
          strokeDasharray="3 2"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          width="19"
          x="2.5"
          y="2.5"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="h-14 w-6 drop-shadow-[0_2px_3px_rgba(10,12,14,0.35)]"
      viewBox="0 0 24 56"
    >
      <rect fill={SHELL_RED} height="40" rx="3" width="18" x="3" y="2" />
      <rect
        fill="white"
        fillOpacity="0.28"
        height="34"
        rx="1"
        width="3"
        x="6"
        y="5"
      />
      <rect fill={BRASS} height="15" rx="1.5" width="20" x="2" y="39" />
      <rect fill={BRASS_RIM} height="2.5" width="20" x="2" y="50" />
      <rect
        fill="white"
        fillOpacity="0.45"
        height="1.5"
        width="20"
        x="2"
        y="40"
      />
    </svg>
  );
}

/** A reserve pip: solid red when the shell is there, a hollow slot when it is not. */
function ReservePip({ full }: { readonly full: boolean }) {
  return (
    <span
      className="block h-5 w-2 rounded-[2px] border transition-colors duration-150"
      style={{
        backgroundColor: full ? SHELL_RED : "rgba(255, 255, 255, 0.25)",
        borderColor: full ? SHELL_RED : "rgba(10, 12, 14, 0.4)",
      }}
    />
  );
}

/** Loaded + reserve at or below this and the HUD starts pointing at the shells on the board. */
const LOW_AMMO = 2;

export interface AmmoDisplayProps {
  readonly capacity: number;
  readonly loaded: number;
  /** Shells lying on the board right now. */
  readonly pickupsOnBoard: number;
  readonly reloadProgress: number | null;
  readonly reserve: number;
  readonly reserveMax: number;
}

/**
 * Shotgun King-style ammo readout, bottom-left: the two barrels as big shells, the reserve as a
 * row of pips, plus a reload sweep and a hint line. Shells never come back on their own (they
 * have to be picked up off the board), so the hint's job is to send a low player out to get them.
 */
export function AmmoDisplay({
  capacity,
  loaded,
  pickupsOnBoard,
  reloadProgress,
  reserve,
  reserveMax,
}: AmmoDisplayProps) {
  const reloading = reloadProgress !== null;
  return (
    <div className="buckshot-motion pointer-events-none absolute bottom-6 left-6 flex select-none flex-col gap-2">
      <div className="flex items-end gap-1.5">
        {range(capacity).map((barrel) => (
          <ShellIcon full={barrel < loaded} key={`shell-${barrel}`} />
        ))}
      </div>
      <div className="flex gap-1">
        {range(reserveMax).map((pip) => (
          <ReservePip full={pip < reserve} key={`pip-${pip}`} />
        ))}
      </div>
      <div className="h-5 font-mono text-[11px] uppercase tracking-[0.3em]">
        {reloading ? (
          <div className="relative w-36">
            <span
              className="block animate-[buckshot-sweep_0.9s_linear_infinite] bg-clip-text font-semibold text-transparent"
              style={{
                backgroundImage: `linear-gradient(90deg, ${INK} 0%, ${INK} 40%, ${SHELL_RED} 50%, ${INK} 60%, ${INK} 100%)`,
                backgroundSize: "250% 100%",
              }}
            >
              Reloading
            </span>
            <span className="mt-1 block h-[2px] w-full bg-[rgba(10,12,14,0.15)]">
              <span
                className="block h-full bg-[#E80C0C]"
                style={{
                  transition: "width 70ms linear",
                  width: `${Math.round(reloadProgress * 100)}%`,
                }}
              />
            </span>
          </div>
        ) : (
          <AmmoHint
            loaded={loaded}
            pickupsOnBoard={pickupsOnBoard}
            reserve={reserve}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One line, most urgent first: totally dry → go get a shell; barrels empty → reload; running low →
 * the board has more. With no shell on the board yet, it says to keep moving instead (shells drop
 * on a game-time timer, and game time barely passes unless you move).
 */
function AmmoHint({
  loaded,
  pickupsOnBoard,
  reserve,
}: {
  readonly loaded: number;
  readonly pickupsOnBoard: number;
  readonly reserve: number;
}) {
  const shellsOut = pickupsOnBoard > 0;
  if (loaded + reserve === 0) {
    return (
      <span className="animate-[buckshot-blink_1s_steps(1)_infinite] whitespace-nowrap font-semibold text-[#E80C0C]">
        {shellsOut
          ? "Out of shells — grab one off the board"
          : "Out of shells — keep moving"}
      </span>
    );
  }
  if (loaded === 0) {
    return (
      <span className="animate-[buckshot-blink_1s_steps(1)_infinite] font-semibold text-[#E80C0C]">
        R — reload
      </span>
    );
  }
  if (loaded + reserve <= LOW_AMMO) {
    return (
      <span className="whitespace-nowrap font-semibold text-[rgba(10,12,14,0.78)]">
        {shellsOut
          ? "Shells on the board — walk over them"
          : "Low — shells drop as you move"}
      </span>
    );
  }
  return null;
}
