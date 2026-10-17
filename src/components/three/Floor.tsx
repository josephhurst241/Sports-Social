"use client";

import { useEffect, useMemo } from "react";
import { MeshStandardMaterial } from "three";

/**
 * The white ground under a game, out past the fog (30-90 m) so it fades into
 * the sky. Exempt from tone mapping so lit areas are exactly the background's
 * #FFFFFF. The lights make it several times brighter than white, though, and
 * fog blended onto that stays clipped at white until it is nearly total, which
 * drew a hard line at 90 m. So where the fog begins the color is clamped to
 * white first. Nearer than that it is left bright: the glass in front samples
 * it, and its pale look depends on it (on screen both clip to the same white).
 */
export default function Floor({ y = 0, z = 0 }: { y?: number; z?: number }) {
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: "#ffffff", roughness: 1, toneMapped: false });
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <fog_fragment>",
        "#ifdef USE_FOG\n  if (vFogDepth > fogNear) gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.0));\n#endif\n#include <fog_fragment>",
      );
    };
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, y, z]} material={material} receiveShadow>
      <planeGeometry args={[220, 220]} />
    </mesh>
  );
}
