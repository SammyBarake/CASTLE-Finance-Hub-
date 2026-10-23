import type { Metadata } from "next";
import { AuthCallback } from "@/components/account/AuthCallback";

export const metadata: Metadata = { title: "Signing in · Castle", robots: { index: false, follow: false } };

/** The sign-in providers' return address (components/account/client.ts). A static page: the work happens in the browser. */
export default function AuthCallbackPage() {
  return <AuthCallback />;
}
