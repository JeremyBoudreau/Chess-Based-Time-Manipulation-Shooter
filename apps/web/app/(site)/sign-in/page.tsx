import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/site/auth-form";
import { safeNext } from "@/lib/safe-next";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

/** `?next=` names the page to return to afterwards (e.g. a protected page that sent us here). */
export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  if (await getViewer()) {
    redirect(safeNext(next, "/profile"));
  }
  return (
    <div className="flex justify-center px-4 py-16 sm:py-24">
      <AuthForm mode="sign-in" next={safeNext(next)} />
    </div>
  );
}
