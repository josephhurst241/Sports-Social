import { LatheGeometry, Vector2, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// Softened shapes for glass: liquid glass reads as poured and polished, so
// it has no knife edges. Boxes get rounded corners; discs and slabs are
// turned on a lathe with a rounded rim. Each shape is built once and shared
// (by its dimensions), like the avatar's geometry; colliders stay the plain
// boxes and cylinders they were.

const cache = new Map<string, BufferGeometry>();
const once = (key: string, make: () => BufferGeometry) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
};

/** A box with its edges and corners rounded by `radius` (at most just under half its thinnest side). */
export function roundedBox(w: number, h: number, d: number, radius: number) {
  const r = Math.min(radius, Math.min(w, h, d) / 2 - 1e-4);
  return once(`box ${w} ${h} ${d} ${r}`, () => new RoundedBoxGeometry(w, h, d, 5, r));
}

/**
 * A cylinder (top radius, bottom radius, height, centered like
 * cylinderGeometry) whose top and bottom rims are rounded by `edge`.
 */
export function roundedDisc(top: number, bottom: number, height: number, edge: number, segments = 64) {
  const e = Math.min(edge, height / 2 - 1e-4, top, bottom);
  return once(`disc ${top} ${bottom} ${height} ${e} ${segments}`, () => {
    const steps = 8;
    const y = height / 2;
    const profile = [new Vector2(0, -y)];
    // Bottom rim: a quarter circle from the underside up to the side.
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
      profile.push(new Vector2(bottom - e + Math.cos(a) * e, -y + e + Math.sin(a) * e));
    }
    // Top rim: from the side over to the top face.
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      profile.push(new Vector2(top - e + Math.cos(a) * e, y - e + Math.sin(a) * e));
    }
    profile.push(new Vector2(0, y));
    return new LatheGeometry(profile, segments);
  });
}
