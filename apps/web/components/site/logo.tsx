import { cn } from "@buckshot/ui/lib/utils";
import Link from "next/link";

/** Wordmark: a blood-red diamond (a tilted board square) beside the name. */
export function Logo({ className }: { readonly className?: string }) {
  return (
    <Link
      aria-label="Buckshot Gambit home"
      className={cn(
        "group inline-flex items-center gap-2.5 font-black text-sm uppercase tracking-[0.18em]",
        className
      )}
      href="/"
    >
      <span
        aria-hidden="true"
        className="size-2.5 rotate-45 bg-blood transition-transform group-hover:rotate-[135deg]"
      />
      <span>
        Buckshot<span className="text-blood">.</span>Gambit
      </span>
    </Link>
  );
}
