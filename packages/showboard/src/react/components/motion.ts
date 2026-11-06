import { useEffect, useState, type CSSProperties } from "react";

// Motion that needs JavaScript; the rest is CSS (styles.css, "Motion"). Both stand still
// when the system asks for reduced motion.

const REDUCE = "(prefers-reduced-motion: reduce)";

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia(REDUCE).matches;

/** A mark's place in its chart's entrance (capped, so long charts don't take forever). */
export const order = (i: number, cap = 16): CSSProperties => ({ "--sb-j": Math.min(i, cap) }) as CSSProperties;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Counts from 0 up to `target` once, when the number first appears; later changes jump straight there. */
export function useCountUp(target: number | null, duration = 900): number | null {
  const [shown, setShown] = useState<number | null>(() => (target === null || reducedMotion() ? target : 0));
  const [ran, setRan] = useState(false);
  useEffect(() => {
    if (target === null || ran || reducedMotion()) {
      setShown(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(t === 1 ? target : target * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setRan(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, ran]);
  return shown;
}
