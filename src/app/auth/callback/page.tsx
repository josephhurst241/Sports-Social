import { Suspense } from "react";
import AuthCallback from "@/components/controller/AuthCallback";

export const metadata = { title: "Signing in · Sports Social" };

export default function Page() {
  // useSearchParams (the sign-in code) needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <AuthCallback />
    </Suspense>
  );
}
