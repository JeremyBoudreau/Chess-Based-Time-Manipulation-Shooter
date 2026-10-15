import { Button } from "@buckshot/ui/components/button";
import Link from "next/link";
import { getViewer } from "@/lib/session";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

/** Site chrome for every page except /play, which is full-screen. */
export async function SiteHeader() {
  const viewer = await getViewer();

  return (
    <header className="sticky top-0 z-40 border-white/5 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:px-6 sm:py-0">
        <Logo />
        <NavLinks className="order-last -mx-3 w-full sm:order-none sm:mx-0 sm:w-auto" />
        <div className="ml-auto flex items-center gap-2">
          {viewer ? (
            <>
              <Link
                className="hidden max-w-40 truncate font-medium text-sm hover:text-blood sm:inline"
                href="/profile"
              >
                {viewer.user.name}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
