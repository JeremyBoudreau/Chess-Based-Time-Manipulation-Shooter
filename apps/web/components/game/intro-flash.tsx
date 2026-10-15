"use client";

import { useEffect, useState } from "react";

const WORDS = [
  { durationMs: 600, text: "TIME", weight: "font-black" },
  { durationMs: 700, text: "MOVES ONLY", weight: "font-thin" },
  { durationMs: 800, text: "WHEN YOU MOVE", weight: "font-black" },
] as const;

const GLOW =
  "0 0 12px #7FE7FF, 0 0 36px rgba(127, 231, 255, 0.55), 0 2px 18px rgba(16, 36, 56, 0.45)";

/**
 * The first-play SUPERHOT mantra, flashed word by word over the live scene (~2 s). Purely
 * decorative and click-through: the player can already move while it plays.
 */
export function IntroFlash({ onDone }: { readonly onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const word = WORDS[index];

  useEffect(() => {
    if (!word) {
      onDone();
      return;
    }
    const timer = setTimeout(
      () => setIndex((value) => value + 1),
      word.durationMs
    );
    return () => clearTimeout(timer);
  }, [word, onDone]);

  if (!word) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className="buckshot-motion pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <p
        className={`whitespace-nowrap text-center text-[13vw] text-white uppercase leading-none tracking-tight ${word.weight}`}
        key={word.text}
        style={{
          animation: `buckshot-flash ${word.durationMs}ms ease-out both`,
          textShadow: GLOW,
        }}
      >
        {word.text}
      </p>
    </div>
  );
}
