import type * as THREE_NS from "three";

type Three = typeof THREE_NS;

/** A canvas-drawn texture (labels, asphalt, cardboard). */
export function canvasTexture(THREE: Three, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE_NS.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Deterministic speckle noise (seeded) so scenes look the same every load. */
export function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 7): void {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h * 0.04; i++) {
    const v = Math.floor(rand() * amount);
    g.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "0,0,0"},${v / 255})`;
    g.fillRect(rand() * w, rand() * h, 2, 2);
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const STATE_HEX: Record<string, string> = {
  pending: "#8a97a6",
  checking: "#2f6fd6",
  pass: "#1d8a5a",
  amber: "#b97f00",
  fail: "#c9302c",
  na: "#74859a",
  missing: "#0f1b2d",
  question: "#2c4f74",
};
