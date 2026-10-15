import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/site/auth-form";
import { getViewer } from "@/lib/session";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignUpPage() {
  if (await getViewer()) {
    redirect("/profile");
  }
  return (
    <div className="flex justify-center px-4 py-16 sm:py-24">
      <AuthForm mode="sign-up" />
    </div>
  );
}
