"use client";

import {
  CALLSIGN_RULE,
  MAX_CALLSIGN_LENGTH,
  normalizeCallsign,
} from "@buckshot/auth/callsign";
import { signIn, signUp } from "@buckshot/auth/client";
import { Button } from "@buckshot/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@buckshot/ui/components/card";
import { Input } from "@buckshot/ui/components/input";
import { Label } from "@buckshot/ui/components/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useId, useState } from "react";
import { withNext } from "@/lib/safe-next";

const MIN_PASSWORD_LENGTH = 8;

type Mode = "sign-in" | "sign-up";

const COPY: Record<
  Mode,
  {
    readonly title: string;
    readonly description: string;
    readonly submit: string;
    readonly pending: string;
  }
> = {
  "sign-in": {
    description: "Back for another regicide? Your runs are waiting.",
    pending: "Signing in…",
    submit: "Sign in",
    title: "Sign in",
  },
  "sign-up": {
    description: "Pick a callsign. Every run you finish gets saved and ranked.",
    pending: "Creating account…",
    submit: "Create account",
    title: "Join the board",
  },
};

const readField = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const FALLBACK_ERROR = "Something went wrong. Try again.";

/** Calls Better Auth and returns an error message to show, or null on success. */
const submitCredentials = async (
  mode: Mode,
  credentials: { email: string; name: string; password: string }
): Promise<string | null> => {
  try {
    const { error } =
      mode === "sign-up"
        ? await signUp.email(credentials)
        : await signIn.email({
            email: credentials.email,
            password: credentials.password,
          });
    return error ? (error.message ?? FALLBACK_ERROR) : null;
  } catch {
    return "Could not reach the server. Check your connection.";
  }
};

/**
 * Shared sign-in / sign-up card. Better Auth sets the session cookie; we just navigate on success,
 * to `next` (an already-validated same-origin path the page read from `?next=`).
 */
export function AuthForm({
  mode,
  next,
}: {
  readonly mode: Mode;
  readonly next: string;
}) {
  const router = useRouter();
  const ids = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];
  const errorId = `${ids}-error`;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const email = readField(form, "email");
      const name = readField(form, "name");
      const password = String(form.get("password") ?? "");

      // `required` accepts whitespace, which trims to an empty callsign; the server rejects it too.
      if (mode === "sign-up" && normalizeCallsign(name) === null) {
        setError(CALLSIGN_RULE);
        return;
      }

      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }

      setPending(true);
      setError(null);
      const message = await submitCredentials(mode, {
        email,
        name,
        password,
      });
      if (message) {
        setPending(false);
        setError(message);
        return;
      }
      router.push(next);
      router.refresh();
    },
    [mode, next, router]
  );

  return (
    <Card className="w-full max-w-sm border-white/10">
      <CardHeader>
        <CardTitle className="font-black text-2xl uppercase tracking-tight">
          {copy.title}
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="flex flex-col gap-4">
          {mode === "sign-up" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-name`}>Callsign</Label>
              <Input
                aria-describedby={error ? errorId : undefined}
                autoComplete="nickname"
                id={`${ids}-name`}
                maxLength={MAX_CALLSIGN_LENGTH}
                name="name"
                placeholder="Regicide Rick"
                required
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-email`}>Email</Label>
            <Input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="email"
              id={`${ids}-email`}
              name="email"
              placeholder="king@black.side"
              required
              type="email"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-password`}>Password</Label>
            <Input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              id={`${ids}-password`}
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              required
              type="password"
            />
          </div>
          {error ? (
            <p
              className="rounded-md border border-blood/40 bg-blood/10 px-3 py-2 text-blood text-sm"
              id={errorId}
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-4">
          <Button
            className="w-full font-bold uppercase tracking-widest"
            disabled={pending}
            size="lg"
            type="submit"
          >
            {pending ? copy.pending : copy.submit}
          </Button>
          <p className="text-muted-foreground text-sm">
            {mode === "sign-up" ? "Already ranked? " : "New here? "}
            <Link
              className="font-medium text-foreground underline-offset-4 hover:text-blood hover:underline"
              href={withNext(
                mode === "sign-up" ? "/sign-in" : "/sign-up",
                next
              )}
            >
              {mode === "sign-up" ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
