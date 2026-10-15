import { createAuthClient } from "better-auth/react";

/** Browser-side auth client; talks to /api/auth on the current origin. */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
