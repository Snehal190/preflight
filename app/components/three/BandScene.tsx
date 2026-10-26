"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { canvasTexture, noise, prefersReducedMotion, webglAvailable } from "./textures";

export type Journey = "idle" | "running" | "ready" | "blocked";

/**
 * The bottom band: depot road, quay and sea. The lorry moves along with the checks (progress 0–1),
 * drives on to the port when the booking is ready, and waits with hazards on when it's blocked.
 */
export function BandScene({ progress, journey, label }: { progress: number; journey: Journey; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ progress, journey });
  const [fallback, setFallback] = useState(false);
  state.current = { progress, journey };

  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) {
      setFallback(true);
      return;
    }
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    void Promise.all([import("three"), import("three/examples/jsm/objects/Sky.js")])
      .then(([THREE, { Sky }]) => {
        if (disposed || !host.current) return;
        const el = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.8;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0xc9d6e2, 120, 900);
        const camera = new THREE.PerspectiveCamera(24, 4, 0.5, 3000);
        camera.position.set(0, 7, -44);
        camera.lookAt(0, 5, 60);

        const sky = new Sky();
        sky.scale.setScalar(2500);
        const su = sky.material.uniforms;
        su.turbidity.value = 5;
        su.rayleigh.value = 1.4;
        su.mieCoefficient.value = 0.005;
        su.mieDirectionalG.value = 0.8;
        const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(66), THREE.MathUtils.degToRad(200));
        su.sunPosition.value.copy(sunDir);
        scene.add(sky);
        const sun = new THREE.DirectionalLight(0xfff2e0, 3);
        sun.position.copy(sunDir).multiplyScalar(80);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 30, bottom: -30, near: 1, far: 260 });
        scene.add(sun, new THREE.HemisphereLight(0xd6e4f2, 0x55606a, 1.0));

        const asphalt = canvasTexture(THREE, 1024, 256, (g, w, h) => {
          g.fillStyle = "#3c4148";
          g.fillRect(0, 0, w, h);
          noise(g, w, h, 34, 3);
          g.fillStyle = "#eceff2";
          g.fillRect(0, 10, w, 7);
          g.fillRect(0, h - 17, w, 7);
          for (let x = 0; x < w; x += 128) g.fillRect(x, h / 2 - 3, 72, 6);
        }, [24, 1]);
        const road = new THREE.Mesh(new THREE.PlaneGeometry(480, 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85 }));
        road.position.y = 0.02;
        road.receiveShadow = true;
        scene.add(road);
        const grass = canvasTexture(THREE, 256, 256, (g, w, h) => {
          g.fillStyle = "#6c7a63";
          g.fillRect(0, 0, w, h);
          noise(g, w, h, 28, 5);
        }, [120, 6]);
        const verge = new THREE.Mesh(new THREE.PlaneGeometry(480, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
        verge.position.set(0, 0, -24.5);
        verge.receiveShadow = true;
        scene.add(verge);
        const concrete = new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.9 });
        const quay = new THREE.Mesh(new THREE.BoxGeometry(480, 3, 9), concrete);
        quay.position.set(0, -1.5, 9);
        quay.receiveShadow = true;
        scene.add(quay);
        const kerb = new THREE.Mesh(new THREE.BoxGeometry(480, 0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.6 }));
        kerb.position.set(0, 0.25, 13.3);
        scene.add(kerb);
        const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1d232b, roughness: 0.5 });
        const bollardGeo = new THREE.CylinderGeometry(0.35, 0.45, 0.8, 10);
        for (let x = -230; x < 230; x += 9) {
          const b = new THREE.Mesh(bollardGeo, bollardMat);
          b.position.set(x, 0.4, 12.4);
          b.castShadow = true;
          scene.add(b);
        }

        // Sea: a displaced plane.
        const seaGeo = new THREE.PlaneGeometry(1600, 500, 140, 50).rotateX(-Math.PI / 2);
        const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ color: 0x3a7aa6, roughness: 0.35, metalness: 0.05 }));
        sea.position.set(0, -1.4, 260);
        scene.add(sea);
        const seaPos = seaGeo.attributes.position as THREE_NS.BufferAttribute;
        const seaBase = Float32Array.from(seaPos.array as Float32Array);
        const farShore = new THREE.Mesh(new THREE.BoxGeometry(3000, 14, 40), new THREE.MeshStandardMaterial({ color: 0xaab7c4, roughness: 1 }));
        farShore.position.set(0, 2, 520);
        scene.add(farShore);

        // Lorry (cab at −x: the direction of travel, which is screen-right).
        const lorry = new THREE.Group();
        const steel = new THREE.MeshStandardMaterial({ color: 0x2c4f74, roughness: 0.45, metalness: 0.2 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.4 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.8 });
        const side = canvasTexture(THREE, 1024, 256, (g, w, h) => {
          g.fillStyle = "#f4f6f9";
          g.fillRect(0, 0, w, h);
          g.fillStyle = "#2f6fd6";
          g.fillRect(0, h - 26, w, 26);
          g.fillStyle = "#0f1b2d";
          g.font = "800 92px Inter, system-ui, sans-serif";
          g.fillText("✓ PreFlight", 40, 130);
          g.font = "700 46px JetBrains Mono, monospace";
          g.fillStyle = "#4a5a6e";
          g.fillText(label, 44, 196);
        });
        const trailerMats = [new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.6 })];
        const sideMat = new THREE.MeshStandardMaterial({ map: side, roughness: 0.6 });
        const add = (geo: THREE_NS.BufferGeometry, mat: THREE_NS.Material | THREE_NS.Material[], x: number, y: number, z: number) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          m.castShadow = true;
          lorry.add(m);
          return m;
        };
        // BoxGeometry face order: +x, −x, +y, −y, +z, −z. Show the livery on the camera-facing side (−z).
        add(new THREE.BoxGeometry(9, 3.1, 2.6), [trailerMats[0], trailerMats[0], trailerMats[0], trailerMats[0], trailerMats[0], sideMat], 1.6, 2.45, 0);
        add(new THREE.BoxGeometry(2.4, 2.7, 2.5), steel, -4.3, 2.0, 0);
        add(new THREE.BoxGeometry(0.05, 1.0, 2.2), glass, -5.52, 2.7, 0);
        add(new THREE.BoxGeometry(11.6, 0.4, 2.2), dark, -0.3, 0.75, 0);
        const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 18).rotateX(Math.PI / 2);
        for (const x of [-4.4, 2.6, 4.3, 5.4]) for (const z of [-1.15, 1.15]) add(wheelGeo, dark, x, 0.55, z);
        const hazardMat = new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff7a00, emissiveIntensity: 0 });
        add(new THREE.BoxGeometry(0.15, 0.25, 0.4), hazardMat, -5.55, 1.2, -0.95);
        add(new THREE.BoxGeometry(0.15, 0.25, 0.4), hazardMat, 6.15, 1.2, -0.95);
        lorry.position.set(20, 0, -1.6);
        scene.add(lorry);

        // Half the visible road width, so the lorry's route fits narrow screens too.
        let span = 26;
        const resize = () => {
          const w = el.clientWidth || 1, h = el.clientHeight || 1;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          camera.aspect = w / h;
          camera.fov = w / h < 2.5 ? 34 : 24;
          camera.updateProjectionMatrix();
          const halfWidth = Math.abs(camera.position.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
          span = Math.max(8, Math.min(26, halfWidth - 7));
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();

        const still = prefersReducedMotion();
        const clock = new THREE.Clock();
        let frameNo = 0;
        const frame = () => {
          const t = clock.getElapsedTime();
          const { progress: p, journey: j } = state.current;
          // Depot (screen-left, x=+26) → port (screen-right, x=−26).
          const target = j === "ready" ? -span - 8 : span - 2 * span * Math.min(1, Math.max(0, p)) * (j === "blocked" ? 0.85 : 1);
          if (still) lorry.position.x = target;
          else lorry.position.x += (target - lorry.position.x) * 0.03;
          hazardMat.emissiveIntensity = j === "blocked" && Math.floor(t * 2) % 2 === 0 ? 2.2 : 0;
          if (!still && frameNo % 2 === 0) {
            const a = seaPos.array as Float32Array;
            for (let i = 0; i < a.length; i += 3) {
              const x = seaBase[i], z = seaBase[i + 2];
              a[i + 1] = Math.sin(x * 0.05 + t * 1.2) * 0.35 + Math.cos(z * 0.08 + t * 0.9) * 0.3;
            }
            seaPos.needsUpdate = true;
            if (frameNo % 6 === 0) seaGeo.computeVertexNormals();
          }
          frameNo++;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        frame();

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          renderer.dispose();
          scene.traverse((o) => (o as THREE_NS.Mesh).geometry?.dispose?.());
          el.removeChild(renderer.domElement);
        };
      })
      .catch(() => setFallback(true));
    return () => {
      disposed = true;
      cleanup();
    };
  }, [label]);

  return (
    <div ref={host} className="absolute inset-0" aria-hidden>
      {fallback && <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#b9cde0,#dfe8f0)" }} />}
    </div>
  );
}
