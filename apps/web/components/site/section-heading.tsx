import type { ReactNode } from "react";

/** Kicker + huge uppercase heading, the typographic signature of the site. */
export function SectionHeading({
  kicker,
  children,
  id,
}: {
  readonly kicker: string;
  readonly children: ReactNode;
  /** For `aria-labelledby` on the surrounding section, and as a link anchor (clear of the sticky header). */
  readonly id?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-mono text-blood text-xs uppercase tracking-[0.3em]">
        <span aria-hidden="true" className="size-1.5 rotate-45 bg-blood" />
        {kicker}
      </p>
      <h2
        className="scroll-mt-32 font-black text-4xl uppercase leading-[0.9] tracking-tighter sm:text-6xl"
        id={id}
      >
        {children}
      </h2>
    </div>
  );
}
