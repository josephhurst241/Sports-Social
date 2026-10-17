"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "@/store/gameStore";
import Logo from "./Logo";

// The startup animation: the logo scales in out of a blur, its sheen sweeps
// across, the wordmark rises, then the sheet fades to reveal the page (on the
// laptop the camera then glides into the hub). At most 1.5 s on the laptop,
// 0.9 s on the phone.
//
// It is all CSS (globals.css, `.splash`), so it plays from the first paint
// and never waits for the page's JavaScript; the room, the scene and the
// connection load underneath meanwhile. INTRO_SCRIPT (intro.ts) runs in <head> before
// anything is drawn: it hides the splash for the rest of the session after
// the first time, and lets a tap, click or key skip it even before React is
// up. Reduced motion gets a plain fade. This component only tells the camera
// when the splash is gone.

export default function Splash({ variant }: { variant: "host" | "phone" }) {
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    if (html.dataset.intro === "seen") {
      useGameStore.setState({ intro: false });
      return;
    }
    useGameStore.setState({ introGlide: true });
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      useGameStore.setState({ intro: false });
    };
    // Wait for the sheet's fade-out (or the skip's quicker one, which replaces it).
    const watch = () => {
      if (over) return;
      const fade = sheet.current
        ?.getAnimations()
        .find((a) => (a as CSSAnimation).animationName?.startsWith("splash-"));
      if (!fade || fade.playState === "finished") finish();
      else fade.finished.then(finish, watch);
    };
    const skip = () => {
      html.dataset.intro = "skip";
      requestAnimationFrame(watch);
    };
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    watch();
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, []);

  return (
    <div ref={sheet} className={`splash splash-${variant}`} aria-hidden>
      <div className="splash-mark">
        <Logo size={variant === "host" ? 132 : 96} sweep />
      </div>
      <div className={`splash-word mt-5 font-semibold tracking-tight text-ink ${variant === "host" ? "text-[40px]" : "text-[30px]"}`}>
        Sports Social
      </div>
    </div>
  );
}
