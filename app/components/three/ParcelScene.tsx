"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { canvasTexture, noise, prefersReducedMotion, STATE_HEX, webglAvailable } from "./textures";

export interface ParcelTag {
  name: string;
  /** pending → checking → a final state. */
  state: "pending" | "checking" | "pass" | "amber" | "fail" | "na" | "missing" | "question";
}

const PACKED = new Set(["pass", "amber", "na"]);

/**
 * The open parcel. Each check is a tag: it flies in from the right, hovers over the box while it's
 * being checked, then drops into the box (fine) or onto the floor beside it (needs fixing).
 */
export function ParcelScene({ tags, label }: { tags: ParcelTag[]; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const tagsRef = useRef(tags);
  const [fallback, setFallback] = useState(false);
  tagsRef.current = tags;

  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) {
      setFallback(true);
      return;
    }
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    void import("three").then((THREE) => {
      if (disposed || !host.current) return;
      const el = host.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
      camera.position.set(3.4, 4.2, 6.6);
      camera.lookAt(0.6, 0.9, 0);

      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-3, 7, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
      scene.add(key, new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
      floor.receiveShadow = true;
      scene.add(floor);

      // Cardboard carton: bottom, four walls, four open flaps, tape, label.
      const card = canvasTexture(THREE, 256, 256, (g, w, h) => {
        g.fillStyle = "#c79a61";
        g.fillRect(0, 0, w, h);
        noise(g, w, h, 26, 11);
        g.strokeStyle = "rgba(90,60,30,0.12)";
        for (let y = 6; y < h; y += 12) g.strokeRect(0, y, w, 0.6);
      });
      const cardMat = new THREE.MeshStandardMaterial({ map: card, roughness: 0.92 });
      const inside = new THREE.MeshStandardMaterial({ color: 0xa47a48, roughness: 1 });
      const box = new THREE.Group();
      const W = 2.0, H = 1.4, D = 1.4, T = 0.05;
      const part = (w: number, h: number, d: number, x: number, y: number, z: number, mats: THREE_NS.Material | THREE_NS.Material[] = cardMat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
        m.position.set(x, y, z);
        m.castShadow = m.receiveShadow = true;
        box.add(m);
        return m;
      };
      part(W, T, D, 0, T / 2, 0, inside);
      part(W, H, T, 0, H / 2, D / 2);
      part(W, H, T, 0, H / 2, -D / 2);
      part(T, H, D, W / 2, H / 2, 0);
      part(T, H, D, -W / 2, H / 2, 0);
      const flap = (w: number, d: number, pivot: [number, number, number], axis: "x" | "z", angle: number, off: [number, number, number]) => {
        const g = new THREE.Group();
        g.position.set(...pivot);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, T, d), cardMat);
        m.position.set(...off);
        m.castShadow = true;
        g.add(m);
        g.rotation[axis] = angle;
        box.add(g);
      };
      flap(W, D / 2, [0, H, D / 2], "x", 2.2, [0, 0, D / 4]);
      flap(W, D / 2, [0, H, -D / 2], "x", -2.2, [0, 0, -D / 4]);
      flap(D / 2, D, [W / 2, H, 0], "z", -2.0, [D / 4, 0, 0]);
      flap(D / 2, D, [-W / 2, H, 0], "z", 2.0, [-D / 4, 0, 0]);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.34, H * 0.6, T * 1.4), new THREE.MeshStandardMaterial({ color: 0xd9b26a, roughness: 0.5, metalness: 0.05 }));
      tape.position.set(0, H * 0.7, D / 2 + 0.01);
      box.add(tape);
      const labelTex = canvasTexture(THREE, 512, 256, (g, w, h) => {
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#0f1b2d";
        g.font = "700 30px JetBrains Mono, monospace";
        g.fillText("PREFLIGHT", 28, 56);
        g.font = "800 84px Inter, system-ui, sans-serif";
        g.fillText(label, 28, 160);
        g.fillStyle = "#2f6fd6";
        g.fillRect(28, 196, w - 56, 14);
      });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 }));
      lbl.position.set(-0.45, 0.55, D / 2 + T / 2 + 0.005);
      box.add(lbl);
      box.rotation.y = -0.35;
      scene.add(box);

      // Tags.
      const RIM = H + 0.02;
      const ENTER = new THREE.Vector3(4.8, RIM + 1.6, 0.6);
      const HOVER = new THREE.Vector3(0, RIM + 1.0, 0.2);
      const tagMeshes: { mesh: THREE_NS.Mesh; tex: THREE_NS.CanvasTexture; drawn: string; t0: number; state: string }[] = [];
      const drawTag = (tex: THREE_NS.CanvasTexture, name: string, color: string) => {
        const c = tex.image as HTMLCanvasElement;
        const g = c.getContext("2d")!;
        g.clearRect(0, 0, c.width, c.height);
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(4, 4, c.width - 8, c.height - 8, 28);
        g.fill();
        g.fillStyle = "#ffffff";
        g.font = "700 46px Inter, system-ui, sans-serif";
        g.textBaseline = "middle";
        g.fillText(name.length > 22 ? `${name.slice(0, 21)}…` : name, 30, c.height / 2 + 2);
        tex.needsUpdate = true;
      };
      for (let i = 0; i < 10; i++) {
        const tex = canvasTexture(THREE, 640, 128, () => {});
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.03), [mat, mat, mat, mat, mat, mat]);
        mesh.castShadow = true;
        mesh.position.copy(ENTER);
        mesh.visible = false;
        scene.add(mesh);
        tagMeshes.push({ mesh, tex, drawn: "", t0: 0, state: "pending" });
      }

      const resize = () => {
        const w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        camera.aspect = w / h;
        // Keep the box framed in narrow panels.
        camera.position.set(3.4, 4.2, w / h < 1.2 ? 9 : 6.6);
        camera.lookAt(0.6, 0.9, 0);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();

      const still = prefersReducedMotion();
      const clock = new THREE.Clock();
      const tmp = new THREE.Vector3();
      const frame = () => {
        const now = clock.getElapsedTime();
        let floorSlot = 0;
        let packedSlot = 0;
        tagsRef.current.forEach((tg, i) => {
          const t = tagMeshes[i];
          if (!t) return;
          const color = STATE_HEX[tg.state] ?? STATE_HEX.pending;
          if (t.drawn !== `${tg.name}|${color}`) {
            drawTag(t.tex, tg.name, color);
            t.drawn = `${tg.name}|${color}`;
          }
          if (t.state !== tg.state) {
            t.state = tg.state;
            t.t0 = now;
          }
          const m = t.mesh;
          if (tg.state === "pending") {
            m.visible = false;
            m.position.copy(ENTER);
            return;
          }
          m.visible = true;
          if (tg.state === "checking") {
            tmp.copy(HOVER);
            tmp.y += Math.sin(now * 3) * 0.05;
            m.rotation.set(-0.25, Math.sin(now * 1.5) * 0.15, 0);
          } else if (PACKED.has(tg.state)) {
            // Into the box, stacked.
            tmp.set(-0.4 + (packedSlot % 3) * 0.4, 0.15 + Math.floor(packedSlot / 3) * 0.06, -0.2 + (packedSlot % 2) * 0.3);
            m.rotation.set(-Math.PI / 2, 0, 0.3 * (packedSlot % 3) - 0.3);
            packedSlot++;
          } else {
            // Not packed: lands on the floor in front of the box.
            tmp.set(-0.9 + (floorSlot % 3) * 0.75, 0.02 + floorSlot * 0.035, 1.7 + Math.floor(floorSlot / 3) * 0.4);
            m.rotation.set(-Math.PI / 2, 0, -0.15 + (floorSlot % 3) * 0.12);
            floorSlot++;
          }
          if (still) m.position.copy(tmp);
          else m.position.lerp(tmp, 0.12);
        });
        if (!still) box.rotation.y = -0.35 + Math.sin(now * 0.25) * 0.05;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(frame);
      };
      frame();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.dispose();
        scene.traverse((o) => {
          const mesh = o as THREE_NS.Mesh;
          mesh.geometry?.dispose?.();
        });
        el.removeChild(renderer.domElement);
      };
    }).catch(() => setFallback(true));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [label]);

  return (
    <div ref={host} className="absolute inset-0" aria-hidden>
      {fallback && (
        <div className="absolute inset-0 grid place-items-center text-6xl opacity-40" aria-hidden>
          📦
        </div>
      )}
    </div>
  );
}
