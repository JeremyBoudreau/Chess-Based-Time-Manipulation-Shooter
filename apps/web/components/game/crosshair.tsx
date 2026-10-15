import type { CSSProperties } from "react";

const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Soft dark halo so a white reticle reads on the bright SUPERHOT void and on ivory pieces. */
const SHADOW: CSSProperties = {
  filter:
    "drop-shadow(0 0 1.5px rgba(10, 12, 14, 0.7)) drop-shadow(0 1px 3px rgba(10, 12, 14, 0.35))",
};

/** Snappy overshoot back to "+" when the gun is ready; a quick, flat turn into "x" when it is not. */
const READY_TRANSITION = "transform 280ms cubic-bezier(0.34, 1.9, 0.5, 1)";
const BLOCKED_TRANSITION = "transform 110ms ease-out";

export interface CrosshairProps {
  readonly capacity: number;
  readonly fireReady: boolean;
  readonly loaded: number;
  readonly reloadProgress: number | null;
}

/**
 * SUPERHOT-style reticle that *is* the weapon HUD: a gapped "+" when a shot would fire, rotated 45°
 * into a small "x" when it would not (empty, reloading, cooling down). A ring fills while
 * reloading and two pips under it mirror the loaded barrels.
 */
export function Crosshair({
  capacity,
  fireReady,
  loaded,
  reloadProgress,
}: CrosshairProps) {
  const transform = fireReady
    ? "rotate(0deg) scale(1)"
    : "rotate(45deg) scale(0.78)";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2"
      style={SHADOW}
    >
      <div
        className="absolute inset-2"
        style={{
          transform,
          transition: fireReady ? READY_TRANSITION : BLOCKED_TRANSITION,
        }}
      >
        <span className="absolute top-0 left-1/2 h-[11px] w-[2px] -translate-x-1/2 rounded-full bg-white" />
        <span className="absolute bottom-0 left-1/2 h-[11px] w-[2px] -translate-x-1/2 rounded-full bg-white" />
        <span className="absolute top-1/2 left-0 h-[2px] w-[11px] -translate-y-1/2 rounded-full bg-white" />
        <span className="absolute top-1/2 right-0 h-[2px] w-[11px] -translate-y-1/2 rounded-full bg-white" />
      </div>
      {reloadProgress === null ? null : (
        <svg
          aria-hidden="true"
          className="absolute inset-0 -rotate-90"
          viewBox="0 0 48 48"
        >
          <circle
            cx="24"
            cy="24"
            fill="none"
            r={RING_RADIUS}
            stroke="rgba(255, 255, 255, 0.28)"
            strokeWidth="2"
          />
          <circle
            cx="24"
            cy="24"
            fill="none"
            r={RING_RADIUS}
            stroke="white"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - reloadProgress)}
            strokeLinecap="round"
            strokeWidth="2"
            style={{ transition: "stroke-dashoffset 70ms linear" }}
          />
        </svg>
      )}
      <div className="absolute top-[calc(100%+4px)] left-1/2 flex -translate-x-1/2 gap-1.5">
        {Array.from({ length: capacity }, (_, barrel) => barrel).map(
          (barrel) => (
            <span
              className={`size-[5px] rounded-full border border-white ${
                barrel < loaded ? "bg-white" : "bg-transparent"
              }`}
              key={`barrel-${barrel}`}
            />
          )
        )}
      </div>
    </div>
  );
}
