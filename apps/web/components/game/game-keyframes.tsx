/**
 * Keyframes for the game screen. Kept next to the components (instead of the app's global CSS) so
 * the game folder is self-contained; Tailwind utilities reference them via `animate-[…]`.
 * Deliberately free of `<`, `>`, `&` and quotes so the text survives SSR untouched.
 */
const KEYFRAMES = `
@keyframes buckshot-slam {
  0% { opacity: 0; transform: scale(1.28); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes buckshot-flash {
  0% { opacity: 0; transform: scale(1.22); }
  14% { opacity: 1; transform: scale(1); }
  78% { opacity: 1; transform: scale(0.98); }
  100% { opacity: 0; transform: scale(0.96); }
}
@keyframes buckshot-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
@keyframes buckshot-blink {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0.2; }
}
@keyframes buckshot-sweep {
  0% { background-position: 160% 0; }
  100% { background-position: -60% 0; }
}
@keyframes buckshot-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes buckshot-rise {
  0% { opacity: 0; transform: translateY(14px); }
  100% { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .buckshot-motion, .buckshot-motion * {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

export function GameKeyframes() {
  return <style>{KEYFRAMES}</style>;
}
