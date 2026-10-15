/** Always-on cool slate-blue corners: SUPERHOT's frame around the white void. */
export function CoolVignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 120% 100% at 50% 50%, transparent 55%, rgba(64, 92, 120, 0.22) 82%, rgba(44, 66, 90, 0.42) 100%)",
      }}
    />
  );
}

/** White core + red bloom: legible over the near-white void, ivory pieces and the red edge pulse. */
const ALERT_GLOW =
  "0 0 2px #FFFFFF, 0 0 10px rgba(255, 255, 255, 0.95), 0 0 26px rgba(232, 12, 12, 0.7), 0 6px 44px rgba(232, 12, 12, 0.45)";

/**
 * Red screen-edge pulse plus a huge "MOVE!" while the king stands on a square a telegraphing piece
 * will hit. Rendered only while threatened so the slam and pulse restart each time danger appears.
 *
 * The word slams in just above the crosshair and scales from its bottom edge, so it lands where
 * the player is already looking without covering what they are aiming at. Right there it also
 * hides the enemy line's crowns and HP pips, and while the king stands still a telegraph can last
 * minutes of real time (1% creep), so after a moment it settles, smaller and slightly faded, into
 * the empty top of the view. The delay is real time: at walking speed most warnings end first.
 */
export function ThreatWarning({ active }: { readonly active: boolean }) {
  if (!active) {
    return null;
  }
  return (
    <div className="buckshot-motion pointer-events-none absolute inset-0">
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-[buckshot-pulse_0.55s_ease-in-out_infinite]"
        style={{
          background:
            "radial-gradient(ellipse 110% 95% at 50% 50%, transparent 46%, rgba(232, 12, 12, 0.36) 74%, rgba(232, 12, 12, 0.74) 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-[calc(50%+3.25rem)] flex origin-bottom justify-center"
        style={{
          animation:
            "buckshot-alert-settle 350ms cubic-bezier(0.4, 0, 0.2, 1) 900ms both",
        }}
      >
        <p
          className="origin-bottom select-none whitespace-nowrap pl-[0.16em] font-black text-[#E80C0C] text-[clamp(4rem,10vw,7.5rem)] uppercase leading-none tracking-[0.16em]"
          role="alert"
          style={{
            animation:
              "buckshot-alert-slam 200ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both, buckshot-throb 0.55s ease-in-out 200ms infinite",
            textShadow: ALERT_GLOW,
          }}
        >
          MOVE!
        </p>
      </div>
    </div>
  );
}
