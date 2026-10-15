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

/**
 * Red screen-edge pulse plus a small "MOVE!" while the king stands on a square a telegraphing piece
 * will hit. Rendered only while threatened so the pulse restarts each time danger appears.
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
            "radial-gradient(ellipse 110% 95% at 50% 50%, transparent 52%, rgba(232, 12, 12, 0.28) 78%, rgba(232, 12, 12, 0.6) 100%)",
        }}
      />
      <p
        className="absolute top-[calc(50%-4.5rem)] left-1/2 -translate-x-1/2 animate-[buckshot-slam_150ms_ease-out_both] font-black text-[#E80C0C] text-sm tracking-[0.45em]"
        role="alert"
        style={{ textShadow: "0 0 6px rgba(255, 255, 255, 0.9)" }}
      >
        MOVE!
      </p>
    </div>
  );
}
