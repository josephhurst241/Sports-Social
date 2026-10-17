import { networkInterfaces } from "node:os";
import { Suspense } from "react";
import { connection } from "next/server";
import HostScreen from "@/components/host/HostScreen";

function lanIp(): string | null {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n!.address);
  // Prefer typical home/office ranges over VPN or container bridges.
  return (
    candidates.find((a) => a.startsWith("192.168.")) ??
    candidates.find((a) => a.startsWith("10.")) ??
    candidates[0] ??
    null
  );
}

async function Host() {
  // Rendered per request so the join QR code carries this machine's current LAN IP.
  await connection();
  return <HostScreen lanIp={lanIp()} />;
}

export default function Page() {
  return (
    <Suspense>
      <Host />
    </Suspense>
  );
}
