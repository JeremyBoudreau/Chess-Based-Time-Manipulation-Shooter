"use client";

import { cn } from "@buckshot/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/play", label: "Play" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/profile", label: "Profile" },
] as const;

/** Primary nav; client-side only to highlight the current section. */
export function NavLinks({ className }: { readonly className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className={cn("flex items-center gap-1", className)}>
      {LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-widest transition-colors hover:text-foreground",
              active && "text-foreground",
              link.href === "/play" && "text-blood hover:text-blood"
            )}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
