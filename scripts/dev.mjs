#!/usr/bin/env node
// `npm run dev`: Next dev server over HTTPS on the LAN.
//
// Phones only expose motion sensors to secure pages (iOS Safari and Chrome
// both require HTTPS), so the controller page must be served over https even
// on a home network. This makes a self-signed certificate covering localhost
// and every LAN IPv4 of this machine (regenerated when the IPs change), then
// starts `next dev` with it. The phone shows a certificate warning once:
// iOS "Show Details > visit this website", Android "Advanced > Proceed".
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const certDir = join(root, ".cert");
const key = join(certDir, "key.pem");
const cert = join(certDir, "cert.pem");
const stamp = join(certDir, "ips.txt");
const port = process.env.PORT ?? "3000";

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address)
  .sort();

const want = ips.join(",");
const have = existsSync(stamp) ? readFileSync(stamp, "utf8") : null;
if (!existsSync(key) || !existsSync(cert) || have !== want) {
  mkdirSync(certDir, { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
    "-keyout", key, "-out", cert, "-subj", "/CN=Sports Social dev", "-addext", `subjectAltName=${san}`,
  ], { stdio: "ignore" });
  writeFileSync(stamp, want);
  console.log(`Made a self-signed certificate for localhost, ${ips.join(", ") || "no LAN address"}`);
}

console.log(`\n  Laptop (host):     https://localhost:${port}`);
for (const ip of ips) console.log(`  Phone (controller): https://${ip}:${port}/play`);
console.log(`  Desktop test pad:  https://localhost:${port}/play?sim=1\n`);

const next = spawn(
  "npx",
  ["next", "dev", "-H", "0.0.0.0", "-p", port,
    "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", cert],
  { cwd: root, stdio: "inherit" },
);
next.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => next.kill(sig));
