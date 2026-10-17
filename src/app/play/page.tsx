import { Suspense } from "react";
import ControllerScreen from "@/components/controller/ControllerScreen";

export const metadata = { title: "Sports Social Controller" };

export default function Page() {
  // useSearchParams (room code, ?sim) needs a Suspense boundary in the App Router.
  return (
    <Suspense>
      <ControllerScreen />
    </Suspense>
  );
}
