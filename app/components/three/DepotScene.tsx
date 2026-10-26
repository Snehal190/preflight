"use client";

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { canvasTexture, noise, prefersReducedMotion, STATE_HEX, webglAvailable } from "./textures";
import { flapsClosed, isSealed } from "@/lib/stage/flaps";

export interface DepotTag {
  name: string;
  state: "pending" | "checking" | "pass" | "amber" | "fail" | "na" | "missing" | "question";
}

const PACKED = new Set(["pass", "amber", "na"]);

/**
 * One scene: a lorry parked at the depot with an open carton on its flatbed. Check tags fly in
 * and drop into the box; a flap folds down each time enough checks pass, and the box is taped
 * shut when all ten pass. The lorry doesn't move until `departing` — then it drives onto the
 * ferry at the quay and sails away.
 */
export function DepotScene({ tags, departing, label }: { tags: DepotTag[]; departing: boolean; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ tags, departing });
  const [fallback, setFallback] = useState(false);
  live.current = { tags, departing };

  useEffect(() => {
    if (!host.current) return;
    if (!webglAvailable()) {
      setFallback(true);
      return;
    }
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    void Promise.all([
      import("three"),
      import("three/examples/jsm/objects/Sky.js"),
      import("three/examples/jsm/geometries/RoundedBoxGeometry.js"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
    ])
      .then(([THREE, { Sky }, { RoundedBoxGeometry }, { RoomEnvironment }]) => {
        if (disposed || !host.current) return;
        const el = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.75;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0xcfdbe6, 90, 700);
        const camera = new THREE.PerspectiveCamera(32, 2, 0.3, 3000);

        // Sky, sun and a matching environment map for believable reflections.
        const sky = new Sky();
        sky.scale.setScalar(2500);
        const su = sky.material.uniforms;
        su.turbidity.value = 4;
        su.rayleigh.value = 1.3;
        su.mieCoefficient.value = 0.004;
        su.mieDirectionalG.value = 0.8;
        const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
        su.sunPosition.value.copy(sunDir);
        scene.add(sky);
        // Neutral studio reflections (the sky shader is far too bright to use as an environment).
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.45;
        const sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
        sun.position.copy(sunDir).multiplyScalar(60);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, near: 1, far: 200 });
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.03;
        scene.add(sun, sun.target, new THREE.HemisphereLight(0xdbe7f3, 0x5a6068, 0.6));

        // Ground: depot apron, road, quay, sea, far shore.
        const asphalt = canvasTexture(THREE, 1024, 256, (g, w, h) => {
          g.fillStyle = "#3d4249";
          g.fillRect(0, 0, w, h);
          noise(g, w, h, 30, 3);
          g.fillStyle = "#e9ecef";
          g.fillRect(0, 12, w, 6);
          g.fillRect(0, h - 18, w, 6);
          for (let x = 0; x < w; x += 128) g.fillRect(x, h / 2 - 3, 70, 6);
        }, [20, 1]);
        const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9 }));
        road.position.set(0, 0.01, -1.6);
        road.receiveShadow = true;
        scene.add(road);
        const apronTex = canvasTexture(THREE, 512, 512, (g, w, h) => {
          g.fillStyle = "#8d9196";
          g.fillRect(0, 0, w, h);
          noise(g, w, h, 22, 9);
          g.strokeStyle = "rgba(40,40,40,0.25)";
          for (let y = 0; y < h; y += 64) g.strokeRect(0, y, w, 1);
        }, [40, 6]);
        const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.95 }));
        apron.position.set(0, 0, -26.6);
        apron.scale.z = 1.5;
        apron.receiveShadow = true;
        scene.add(apron);
        const concrete = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.9 });
        const quay = new THREE.Mesh(new THREE.BoxGeometry(400, 3, 10), concrete);
        quay.position.set(0, -1.5, 8.4);
        quay.receiveShadow = true;
        scene.add(quay);
        const kerb = new THREE.Mesh(new THREE.BoxGeometry(400, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xe0a91e, roughness: 0.6 }));
        kerb.position.set(0, 0.18, 13.2);
        scene.add(kerb);
        const bollardGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.7, 12);
        const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1d232b, roughness: 0.45, metalness: 0.3 });
        for (let x = -190; x < 190; x += 10) {
          const b = new THREE.Mesh(bollardGeo, bollardMat);
          b.position.set(x, 0.35, 12.5);
          b.castShadow = true;
          scene.add(b);
        }
        const seaGeo = new THREE.PlaneGeometry(1600, 600, 140, 50).rotateX(-Math.PI / 2);
        const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ color: 0x2f6f99, roughness: 0.18, metalness: 0.15 }));
        sea.position.set(0, -1.3, 313);
        scene.add(sea);
        const seaPos = seaGeo.attributes.position as THREE_NS.BufferAttribute;
        const seaBase = Float32Array.from(seaPos.array as Float32Array);
        const shore = new THREE.Mesh(new THREE.BoxGeometry(3000, 16, 40), new THREE.MeshStandardMaterial({ color: 0xa7b5c2, roughness: 1 }));
        shore.position.set(0, 2, 620);
        scene.add(shore);
        // A depot shed behind the road.
        const shed = new THREE.Mesh(new THREE.BoxGeometry(40, 9, 14), new THREE.MeshStandardMaterial({ color: 0xc9d1d9, roughness: 0.8 }));
        // Well behind the camera's widest pull-back, so it never ends up inside the building.
        shed.position.set(14, 4.5, -48);
        shed.castShadow = shed.receiveShadow = true;
        scene.add(shed);
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x5b6672, roughness: 0.6 });
        for (const x of [2, 10, 18, 26]) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 0.2), doorMat);
          d.position.set(x, 3, -40.9);
          scene.add(d);
        }

        // ---------- the lorry (cab faces −x, which is screen-right) ----------
        const lorry = new THREE.Group();
        const paint = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, roughness: 0.32, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 });
        const steel = new THREE.MeshStandardMaterial({ color: 0x2c4f74, roughness: 0.4, metalness: 0.35 });
        const black = new THREE.MeshStandardMaterial({ color: 0x16191d, roughness: 0.8 });
        const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.15, metalness: 1 });
        const glass = new THREE.MeshPhysicalMaterial({ color: 0x1b2633, roughness: 0.05, metalness: 0.2, transmission: 0, clearcoat: 1 });
        const tyre = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.9 });
        const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.9 });
        const add = (geo: THREE_NS.BufferGeometry, mat: THREE_NS.Material | THREE_NS.Material[], x: number, y: number, z: number, parent: THREE_NS.Object3D = lorry) => {
          const m = new THREE.Mesh(geo, mat);
          m.position.set(x, y, z);
          m.castShadow = true;
          m.receiveShadow = true;
          parent.add(m);
          return m;
        };
        // Cab
        add(new RoundedBoxGeometry(2.5, 2.7, 2.5, 4, 0.18), paint, -6.35, 2.45, 0);
        add(new RoundedBoxGeometry(2.3, 0.5, 2.4, 3, 0.12), paint, -6.25, 4.0, 0); // roof fairing
        add(new THREE.BoxGeometry(0.06, 1.15, 2.2), glass, -7.62, 3.05, 0); // windscreen
        for (const z of [-1.26, 1.26]) add(new THREE.BoxGeometry(1.3, 0.9, 0.04), glass, -6.7, 3.1, z); // side windows
        add(new THREE.BoxGeometry(0.08, 0.9, 1.6), black, -7.62, 1.75, 0); // grille
        for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.1, 0.05, 1.5), chrome, -7.66, 1.4 + i * 0.18, 0);
        add(new THREE.BoxGeometry(0.3, 0.35, 2.55), black, -7.6, 1.05, 0); // bumper
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.6 });
        for (const z of [-0.95, 0.95]) add(new THREE.BoxGeometry(0.08, 0.2, 0.42), lampMat, -7.66, 1.38, z);
        for (const z of [-1.4, 1.4]) {
          add(new THREE.BoxGeometry(0.5, 0.05, 0.05), black, -7.3, 3.2, z); // mirror arm
          add(new THREE.BoxGeometry(0.1, 0.55, 0.22), black, -7.55, 3.0, z * 1.05);
        }
        add(new THREE.CylinderGeometry(0.35, 0.35, 1.2, 20).rotateZ(Math.PI / 2), chrome, -5.2, 1.0, -1.15); // fuel tank
        add(new THREE.BoxGeometry(0.45, 0.08, 0.5), chrome, -6.6, 0.75, -1.3); // step
        // Livery stripe on the cab side
        add(new THREE.BoxGeometry(2.2, 0.18, 0.02), steel, -6.3, 2.05, -1.27);
        // Chassis + flatbed trailer
        add(new THREE.BoxGeometry(13.6, 0.35, 1.0), black, 0.3, 0.95, 0);
        add(new THREE.BoxGeometry(12.2, 0.32, 2.5), steel, 1.5, 1.32, 0); // deck
        add(new THREE.BoxGeometry(12.2, 0.12, 2.52), black, 1.5, 1.1, 0);
        add(new THREE.BoxGeometry(0.12, 1.6, 2.5), steel, -4.55, 2.25, 0); // headboard
        for (const z of [-1.27, 1.27]) add(new THREE.BoxGeometry(12.2, 0.08, 0.05), chrome, 1.5, 1.5, z); // rub rails
        const tail = new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0x7a0000, emissiveIntensity: 0.4 });
        for (const z of [-1.0, 1.0]) add(new THREE.BoxGeometry(0.06, 0.18, 0.4), tail, 7.62, 1.05, z);
        // Wheels: tyre + rim + hub, two axles on the tractor and three on the trailer.
        const tyreGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.38, 28).rotateX(Math.PI / 2);
        const rimGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.4, 20).rotateX(Math.PI / 2);
        const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.42, 12).rotateX(Math.PI / 2);
        const wheels: THREE_NS.Mesh[] = [];
        for (const x of [-6.6, -3.6, 4.4, 5.6, 6.8])
          for (const z of [-1.1, 1.1]) {
            wheels.push(add(tyreGeo, tyre, x, 0.55, z));
            add(rimGeo, rimMat, x, 0.55, z);
            add(hubGeo, chrome, x, 0.55, z);
          }
        for (const x of [-3.6, 5.6]) for (const z of [-1.15, 1.15]) add(new THREE.BoxGeometry(1.4, 0.06, 0.45), black, x, 1.18, z); // mudguards

        // Cargo: two shrink-wrapped pallets and the open carton on its pallet.
        const wood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
        const pallet = (x: number, w: number, d: number) => {
          for (const dz of [-d / 2 + 0.1, 0, d / 2 - 0.1]) add(new THREE.BoxGeometry(w, 0.12, 0.16), wood, x, 1.54, dz);
          for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.16, 0.04, d), wood, x - w / 2 + 0.1 + (i * (w - 0.2)) / 5, 1.62, 0);
        };
        const wrap = new THREE.MeshPhysicalMaterial({ color: 0xe9eef4, roughness: 0.25, transmission: 0.25, thickness: 0.5, clearcoat: 1 });
        for (const x of [-2.7, 5.8]) {
          pallet(x, 1.9, 2.0);
          add(new RoundedBoxGeometry(1.85, 1.7, 1.95, 3, 0.08), wrap, x, 2.5, 0);
        }
        pallet(1.55, 2.3, 2.0);

        const card = canvasTexture(THREE, 256, 256, (g, w, h) => {
          g.fillStyle = "#c79a61";
          g.fillRect(0, 0, w, h);
          noise(g, w, h, 24, 11);
          g.strokeStyle = "rgba(90,60,30,0.12)";
          for (let y = 6; y < h; y += 12) g.strokeRect(0, y, w, 0.6);
        });
        const cardMat = new THREE.MeshStandardMaterial({ map: card, roughness: 0.92 });
        const inside = new THREE.MeshStandardMaterial({ color: 0x9f7644, roughness: 1 });
        const box = new THREE.Group();
        box.position.set(1.55, 1.64, 0);
        lorry.add(box);
        const W = 2.2, H = 1.55, D = 1.9, T = 0.05;
        add(new THREE.BoxGeometry(W, T, D), inside, 0, T / 2, 0, box);
        add(new THREE.BoxGeometry(W, H, T), cardMat, 0, H / 2, D / 2, box);
        add(new THREE.BoxGeometry(W, H, T), cardMat, 0, H / 2, -D / 2, box);
        add(new THREE.BoxGeometry(T, H, D), cardMat, W / 2, H / 2, 0, box);
        add(new THREE.BoxGeometry(T, H, D), cardMat, -W / 2, H / 2, 0, box);
        const labelTex = canvasTexture(THREE, 512, 256, (g, w) => {
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, w, 256);
          g.fillStyle = "#0f1b2d";
          g.font = "700 30px JetBrains Mono, monospace";
          g.fillText("PREFLIGHT", 28, 56);
          g.font = "800 86px Inter, system-ui, sans-serif";
          g.fillText(label, 28, 160);
          g.fillStyle = "#2f6fd6";
          g.fillRect(28, 196, w - 56, 14);
        });
        const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.48), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 }));
        lbl.position.set(-0.45, 0.75, -D / 2 - T / 2 - 0.006);
        lbl.rotation.y = Math.PI;
        box.add(lbl);
        // Four flaps, hinged on the top edges. Open angle → closed (0) as checks pass.
        type Flap = { g: THREE_NS.Group; axis: "x" | "z"; open: number; layer: number };
        const flaps: Flap[] = [];
        const flap = (w: number, d: number, pivot: [number, number, number], axis: "x" | "z", open: number, off: [number, number, number], layer: number) => {
          const g = new THREE.Group();
          g.position.set(...pivot);
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, T, d), cardMat);
          m.position.set(off[0], off[1] + layer * 0.012, off[2]);
          m.castShadow = true;
          g.add(m);
          g.rotation[axis] = open;
          box.add(g);
          flaps.push({ g, axis, open, layer });
        };
        // Close order: front (camera side), back, left, right — side flaps sit on top.
        flap(W, D / 2, [0, H, -D / 2], "x", 2.3, [0, 0, D / 4], 0);
        flap(W, D / 2, [0, H, D / 2], "x", -2.3, [0, 0, -D / 4], 0);
        flap(D / 2 + 0.2, D, [W / 2, H, 0], "z", 2.1, [-(D / 2 + 0.2) / 2, 0, 0], 1);
        flap(D / 2 + 0.2, D, [-W / 2, H, 0], "z", -2.1, [(D / 2 + 0.2) / 2, 0, 0], 1);
        const tape = add(new THREE.BoxGeometry(W + 0.12, 0.012, 0.32), new THREE.MeshStandardMaterial({ color: 0xd9b26a, roughness: 0.4 }), 0, H + 0.045, 0, box);
        tape.scale.x = 0.001;
        tape.visible = false;

        // Check tags.
        const tagGeo = new THREE.BoxGeometry(1.5, 0.32, 0.03);
        const HOVER = new THREE.Vector3(1.55, 1.64 + H + 1.25, 0);
        const ENTER = new THREE.Vector3(-14, 7, -4);
        const tagItems: { mesh: THREE_NS.Mesh; tex: THREE_NS.CanvasTexture; drawn: string }[] = [];
        const drawTag = (tex: THREE_NS.CanvasTexture, name: string, color: string) => {
          const c = tex.image as HTMLCanvasElement;
          const g = c.getContext("2d")!;
          g.clearRect(0, 0, c.width, c.height);
          g.fillStyle = color;
          g.beginPath();
          g.roundRect(4, 4, c.width - 8, c.height - 8, 30);
          g.fill();
          g.fillStyle = "#ffffff";
          g.font = "700 50px Inter, system-ui, sans-serif";
          g.textBaseline = "middle";
          g.fillText(name, 32, c.height / 2 + 2);
          tex.needsUpdate = true;
        };
        for (let i = 0; i < 10; i++) {
          const tex = canvasTexture(THREE, 640, 136, () => {});
          const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45 });
          const mesh = new THREE.Mesh(tagGeo, mat);
          mesh.castShadow = true;
          mesh.visible = false;
          mesh.position.copy(ENTER);
          scene.add(mesh);
          tagItems.push({ mesh, tex, drawn: "" });
        }

        // The ferry, docked beyond the quay to screen-right.
        const ferry = new THREE.Group();
        const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5c, roughness: 0.5, metalness: 0.2 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 });
        const addF = (geo: THREE_NS.BufferGeometry, mat: THREE_NS.Material, x: number, y: number, z: number) => add(geo, mat, x, y, z, ferry);
        addF(new THREE.BoxGeometry(46, 4.2, 15), hullMat, 0, -1.9, 0);
        addF(new THREE.BoxGeometry(46, 0.25, 15), new THREE.MeshStandardMaterial({ color: 0x59626c, roughness: 0.9 }), 0, 0.12, 0);
        addF(new THREE.BoxGeometry(14, 6, 13), whiteMat, 14, 3.2, 0);
        addF(new THREE.BoxGeometry(10, 2.5, 11), whiteMat, 15, 7.4, 0);
        addF(new THREE.CylinderGeometry(1.1, 1.3, 4, 16), new THREE.MeshStandardMaterial({ color: 0xc9302c, roughness: 0.5 }), 17, 10.2, 0);
        const winMat = new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.1, metalness: 0.4 });
        for (let i = 0; i < 6; i++) addF(new THREE.BoxGeometry(1.2, 0.8, 0.05), winMat, 9 + i * 2, 4.4, -6.53);
        ferry.position.set(-46, -0.1, 21);
        scene.add(ferry);

        // Lorry starts parked in the depot, cab facing the port.
        lorry.position.set(0, 0, -1.6);
        scene.add(lorry);

        // Camera shots: close on the parked lorry; wide for the departure.
        const CLOSE = { pos: new THREE.Vector3(2.5, 7.2, -15.5), look: new THREE.Vector3(0.3, 2.6, 0) };
        const WIDE = { pos: new THREE.Vector3(-18, 22, -62), look: new THREE.Vector3(-40, 1, 30) };
        const camPos = CLOSE.pos.clone();
        const camLook = CLOSE.look.clone();
        let narrow = false;
        const resize = () => {
          const w = el.clientWidth || 1, h = el.clientHeight || 1;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          camera.aspect = w / h;
          narrow = w / h < 1.25;
          camera.fov = narrow ? 46 : 32;
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();

        const still = prefersReducedMotion();
        const clock = new THREE.Clock();
        let departT0 = -1;
        let frameNo = 0;
        const tmp = new THREE.Vector3();
        const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const clamp = (x: number) => Math.min(1, Math.max(0, x));

        const frame = () => {
          const now = clock.getElapsedTime();
          const { tags: tg, departing } = live.current;

          // Tags.
          let packed = 0;
          let floorSlot = 0;
          tg.forEach((t, i) => {
            const item = tagItems[i];
            if (!item) return;
            const color = STATE_HEX[t.state] ?? STATE_HEX.pending;
            if (item.drawn !== `${t.name}|${color}`) {
              drawTag(item.tex, t.name, color);
              item.drawn = `${t.name}|${color}`;
            }
            const m = item.mesh;
            if (t.state === "pending") {
              m.visible = false;
              m.position.copy(ENTER);
              return;
            }
            m.visible = true;
            if (t.state === "checking") {
              tmp.copy(HOVER);
              tmp.y += Math.sin(now * 3) * 0.06;
              m.rotation.set(-0.2, Math.PI + Math.sin(now * 1.4) * 0.12, 0);
            } else if (PACKED.has(t.state)) {
              // Into the box (in lorry space → world).
              tmp.set(1.55 - 0.55 + (packed % 3) * 0.55, 1.64 + 0.12 + Math.floor(packed / 3) * 0.05, -0.35 + (packed % 2) * 0.6).add(lorry.position);
              m.rotation.set(-Math.PI / 2, 0, 0.25 * ((packed % 3) - 1));
              packed++;
              // Hide once inside a closed box.
              m.visible = !(departing || flapsClosed(packed) >= 4);
            } else {
              // Not packed: on the ground beside the lorry, in front of the camera.
              tmp.set(3.2 - (floorSlot % 3) * 1.7, 0.03 + floorSlot * 0.02, -4.2 - Math.floor(floorSlot / 3) * 0.6).add(new THREE.Vector3(lorry.position.x, 0, 0));
              m.rotation.set(-Math.PI / 2, 0, Math.PI + 0.1 * ((floorSlot % 3) - 1));
              floorSlot++;
            }
            if (still) m.position.copy(tmp);
            else m.position.lerp(tmp, 0.1);
          });

          // Flaps close as checks are packed; tape when all ten are in.
          const closed = flapsClosed(packed);
          flaps.forEach((f, i) => {
            const target = i < closed ? 0 : f.open;
            f.g.rotation[f.axis] = still ? target : f.g.rotation[f.axis] + (target - f.g.rotation[f.axis]) * 0.08;
          });
          const sealed = isSealed(packed);
          tape.visible = sealed;
          tape.scale.x = still ? (sealed ? 1 : 0.001) : sealed ? Math.min(1, tape.scale.x + 0.03) : 0.001;

          // Departure: road → ferry ramp → onto the deck → the ferry sails.
          if (departing && departT0 < 0) departT0 = now;
          if (!departing) departT0 = -1;
          const t = departT0 < 0 ? 0 : still ? 99 : now - departT0;
          if (departT0 >= 0) {
            const a = ease(clamp(t / 5)); // drive along the road
            const b = ease(clamp((t - 5) / 3)); // turn onto the ferry
            const c = ease(clamp((t - 8.2) / 10)); // sail
            const roadX = 0 + (-40 - 0) * a;
            if (t < 5) {
              lorry.position.set(roadX, 0, -1.6);
              lorry.rotation.y = 0;
            } else if (t < 8.2) {
              lorry.position.set(-40 - 2 * b, 0, -1.6 + (21 - -1.6) * b);
              lorry.rotation.y = (Math.PI / 2) * b;
            } else {
              if (lorry.parent !== ferry) ferry.attach(lorry);
              ferry.position.set(-46 - 30 * c, -0.1 + Math.sin(now * 0.8) * 0.12, 21 + 260 * c);
              ferry.rotation.y = -0.15 * c;
            }
            for (const w of wheels) w.rotation.z -= t < 8.2 ? 0.25 : 0;
            camPos.lerp(WIDE.pos, still ? 1 : 0.02);
            camLook.lerp(WIDE.look, still ? 1 : 0.02);
          } else {
            if (lorry.parent === ferry) {
              scene.attach(lorry);
            }
            lorry.position.set(0, 0, -1.6);
            lorry.rotation.y = 0;
            ferry.position.set(-46, -0.1, 21);
            ferry.rotation.y = 0;
            camPos.lerp(CLOSE.pos, still ? 1 : 0.05);
            camLook.lerp(CLOSE.look, still ? 1 : 0.05);
          }
          camera.position.copy(camPos);
          if (narrow && departT0 < 0) camera.position.add(new THREE.Vector3(0, 2, -6));
          camera.lookAt(camLook);

          if (!still && frameNo % 2 === 0) {
            const arr = seaPos.array as Float32Array;
            for (let i = 0; i < arr.length; i += 3) {
              const x = seaBase[i], z = seaBase[i + 2];
              arr[i + 1] = Math.sin(x * 0.05 + now * 1.1) * 0.3 + Math.cos(z * 0.07 + now * 0.8) * 0.25;
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
          pmrem.dispose();
          renderer.dispose();
          scene.traverse((o) => (o as THREE_NS.Mesh).geometry?.dispose?.());
          el.removeChild(renderer.domElement);
        };
      })
      .catch((e) => {
        console.error("3D scene failed to start:", e);
        setFallback(true);
      });
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
