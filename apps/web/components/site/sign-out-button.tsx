"use client";

import { signOut } from "@buckshot/auth/client";
import { Button } from "@buckshot/ui/components/button";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

const labelFor = (pending: boolean, failed: boolean): string => {
  if (pending) {
    return "Signing out…";
  }
  return failed ? "Retry sign out" : "Sign out";
};

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The auth client resolves with `error` for HTTP failures but rejects on network ones (offline,
  // DNS, reset), so both paths must re-enable the button.
  const handleClick = useCallback(async () => {
    setPending(true);
    setFailed(false);
    try {
      const { error } = await signOut();
      if (error) {
        setFailed(true);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [router]);

  return (
    <Button
      aria-live="polite"
      disabled={pending}
      onClick={handleClick}
      size="sm"
      variant="ghost"
    >
      {labelFor(pending, failed)}
    </Button>
  );
}
