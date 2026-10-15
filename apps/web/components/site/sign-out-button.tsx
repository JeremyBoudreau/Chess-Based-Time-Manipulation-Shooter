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

  const handleClick = useCallback(async () => {
    setPending(true);
    setFailed(false);
    const { error } = await signOut();
    setPending(false);
    if (error) {
      setFailed(true);
      return;
    }
    router.push("/");
    router.refresh();
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
