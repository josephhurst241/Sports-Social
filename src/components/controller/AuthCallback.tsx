"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/brand/Logo";
import { supabase } from "@/lib/account/account";

// Where Google (or an emailed link) sends the phone back after signing in:
// trade the one-time code for a session, then return to the page the player
// came from (`next`, the controller with its room code). The Supabase client
// does not read codes from URLs on its own (the room code is ?code= too).

/** Only a path on this site, never somewhere else. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/play";
}

export default function AuthCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = safeNext(params.get("next"));
    const code = params.get("code");
    const sb = supabase();
    if (!sb) return setError("Accounts are not set up on this server.");
    if (params.get("error_description")) return setError(params.get("error_description"));
    if (!code) return setError("This sign-in link is incomplete.");
    sb.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setError(`${error.message}. Open the link in the same browser you started from, or sign in with a code.`);
      else router.replace(next);
    });
  }, [params, router]);

  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center bg-white px-8 text-center">
      <Logo size={72} />
      <p className="mt-6 text-[17px] text-ink-2">{error ?? "Signing you in…"}</p>
      {error && (
        <a className="mt-6 rounded-2xl bg-ink px-6 py-3.5 text-[17px] font-semibold text-white" href={safeNext(params.get("next"))}>
          Back to the game
        </a>
      )}
    </main>
  );
}
