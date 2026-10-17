import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Phones load the dev server from the laptop's LAN address, which Next treats
// as a cross-origin dev request. Allow every local IPv4 this machine has.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: lanAddresses,
  // Strict Mode double-mounts effects in dev, so the host would register a room
  // code with the PeerJS broker, tear it down and register a second one.
  reactStrictMode: false,
  // The dev badge sits on top of the player chips in the corner.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
