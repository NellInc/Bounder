import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { BUILDING_SPECS, ROUTE_WAYPOINTS, WORLD_BOUNDS } from "./simulator-world.js";

const root = document.querySelector(".simulator-workbench");
const stage = root.querySelector(".simulator-stage");
const canvas = stage.querySelector("canvas");
const phaseElement = root.querySelector(".status-phase");
const statusCode = root.querySelector(".status-code");
const outcomeElement = root.querySelector(".decision-outcome");
const decisionCode = root.querySelector(".decision-code");
const reasonElement = root.querySelector(".decision-reason");
const adapterOutput = root.querySelector(".adapter-output");
const receiptSource = root.querySelector(".receipt-source");
const receiptFields = Object.fromEntries([...root.querySelectorAll("[data-receipt]")].map((element) => [element.dataset.receipt, element]));
const fleetFields = Object.fromEntries([...root.querySelectorAll("[data-fleet]")].map((element) => [element.dataset.fleet, element]));
const fleetNodes = root.querySelector("[data-fleet-nodes]");
const playButton = root.querySelector("[data-action='play']");
const fleetButton = root.querySelector("[data-action='fleet']");
const resilienceLab = root.querySelector(".resilience-lab");
const resilienceScenarios = root.querySelector("[data-resilience-scenarios]");
const resilienceEvents = root.querySelector("[data-resilience-events]");
const resilienceFields = Object.fromEntries([...root.querySelectorAll("[data-resilience]")].map((element) => [element.dataset.resilience, element]));
const resilienceScrubber = root.querySelector("[data-resilience-scrubber]");
const resilienceActions = Object.fromEntries([...root.querySelectorAll("[data-resilience-action]")].map((element) => [element.dataset.resilienceAction, element]));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const css = getComputedStyle(document.documentElement);
const cssColour = (name) => css.getPropertyValue(name).trim();
const colours = {
  ink: cssColour("--ink"),
  paper: cssColour("--paper"),
  signal: cssColour("--signal"),
  safety: cssColour("--safety"),
  route: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--route").trim(),
  friendly: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--friendly").trim(),
  civilian: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--civilian").trim(),
  protected: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--protected").trim(),
  humanitarian: getComputedStyle(document.querySelector(".simulator-page")).getPropertyValue("--humanitarian").trim()
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  stage.classList.add("is-ready");
} catch (error) {
  console.warn("Bounder simulator could not initialize WebGL", error);
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.setClearColor(new THREE.Color("#b9d7df"), 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#b9d7df");
scene.fog = new THREE.Fog(new THREE.Color("#b9d7df"), 28, 62);
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(17, 16, 21);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.4, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 11;
controls.maxDistance = 34;
controls.maxPolarAngle = Math.PI * 0.48;

const navigationCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const pressedNavigationKeys = new Set();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraMovement = new THREE.Vector3();

canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
canvas.addEventListener("keydown", (event) => {
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.add(event.code);
  stage.dataset.lastNavigationKey = event.code;
});
canvas.addEventListener("keyup", (event) => {
  if (!navigationCodes.has(event.code)) return;
  event.preventDefault();
  pressedNavigationKeys.delete(event.code);
});
canvas.addEventListener("blur", () => pressedNavigationKeys.clear());

const updateCameraNavigation = (delta) => {
  if (pressedNavigationKeys.size === 0) return;

  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  if (cameraForward.lengthSq() < 0.0001) cameraForward.set(0, 0, -1);
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, camera.up).normalize();
  cameraMovement.set(0, 0, 0);

  if (pressedNavigationKeys.has("KeyW")) cameraMovement.add(cameraForward);
  if (pressedNavigationKeys.has("KeyS")) cameraMovement.sub(cameraForward);
  if (pressedNavigationKeys.has("KeyD")) cameraMovement.add(cameraRight);
  if (pressedNavigationKeys.has("KeyA")) cameraMovement.sub(cameraRight);
  if (pressedNavigationKeys.has("KeyE")) cameraMovement.y += 1;
  if (pressedNavigationKeys.has("KeyQ")) cameraMovement.y -= 1;
  if (cameraMovement.lengthSq() === 0) return;

  cameraMovement.normalize().multiplyScalar(delta * 6.5);
  const previousTarget = controls.target.clone();
  controls.target.add(cameraMovement);
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -WORLD_BOUNDS.width / 2, WORLD_BOUNDS.width / 2);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.6, 10);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -WORLD_BOUNDS.depth / 2, WORLD_BOUNDS.depth / 2);
  camera.position.add(controls.target.clone().sub(previousTarget));
  stage.dataset.cameraPosition = camera.position.toArray().map((value) => value.toFixed(2)).join(",");
};

scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x5b6749, 2.15));
const sun = new THREE.DirectionalLight(0xfff1cf, 3.1);
sun.position.set(-10, 18, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
sun.shadow.bias = -0.00035;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(52, 42),
  new THREE.MeshStandardMaterial({ color: new THREE.Color("#789267"), roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.11;
ground.receiveShadow = true;
scene.add(ground);

const plane = (width, depth, x, z, material, y = 0) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
};

const grassMaterial = new THREE.MeshStandardMaterial({ color: "#90aa72", roughness: 1 });
plane(WORLD_BOUNDS.width, WORLD_BOUNDS.depth, 0, 0, grassMaterial, -0.08);

const roadMaterial = new THREE.MeshStandardMaterial({ color: "#454a49", roughness: 0.95 });
const kerbMaterial = new THREE.MeshStandardMaterial({ color: "#d0c8b9", roughness: 0.92 });
const pavingMaterial = new THREE.MeshStandardMaterial({ color: "#b9b19f", roughness: 0.94 });
for (const [width, depth, x, z] of [[34, 3.0, 0, 3.6], [34, 2.7, 0, -4.2], [3.0, 26, 3.6, 0]]) {
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.12, depth + 0.5), kerbMaterial);
  kerb.position.set(x, -0.005, z);
  kerb.receiveShadow = true;
  scene.add(kerb);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, 0.062, z);
  road.receiveShadow = true;
  scene.add(road);
}

const laneMaterial = new THREE.MeshBasicMaterial({ color: "#e9dfbb", transparent: true, opacity: 0.78 });
const addLaneDash = (width, depth, x, z) => {
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), laneMaterial);
  dash.rotation.x = -Math.PI / 2;
  dash.position.set(x, 0.075, z);
  scene.add(dash);
};
for (let x = -15; x <= 15; x += 2.25) {
  addLaneDash(1.08, 0.065, x, 3.6);
  addLaneDash(1.08, 0.065, x, -4.2);
}
for (let z = -11; z <= 11; z += 2.25) addLaneDash(0.065, 1.08, 3.6, z);

const crosswalkMaterial = new THREE.MeshBasicMaterial({ color: "#f3eee0", transparent: true, opacity: 0.78 });
for (let stripe = -1.05; stripe <= 1.05; stripe += 0.35) {
  plane(0.18, 2.55, 1.25 + stripe, 3.6, crosswalkMaterial, 0.079);
  plane(2.55, 0.18, 3.6, -1.45 + stripe, crosswalkMaterial, 0.079);
}

plane(6.8, 4.7, -2.0, -0.3, new THREE.MeshStandardMaterial({ color: "#8cac70", roughness: 1 }), 0.015);
plane(4.5, 2.2, -1.0, 3.6, pavingMaterial, 0.078);

const windowMaterial = new THREE.MeshStandardMaterial({ color: "#9dc7cf", emissive: "#49747e", emissiveIntensity: 0.18, metalness: 0.05, roughness: 0.28 });
const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: "#f0e9dc", roughness: 0.75 });
const doorMaterial = new THREE.MeshStandardMaterial({ color: "#5a4135", roughness: 0.8 });
const foliageMaterials = ["#517d4b", "#668f55", "#789b5f"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92 }));
const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#6b4b35", roughness: 1 });
const flowerMaterial = new THREE.MeshStandardMaterial({ color: "#f4c554", roughness: 0.8 });

const addWindow = (group, x, y, z, scaleX = 1) => {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.54 * scaleX, 0.62, 0.075), windowFrameMaterial);
  frame.position.set(x, y, z);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.42 * scaleX, 0.5, 0.085), windowMaterial);
  pane.position.set(x, y, z + 0.006);
  group.add(frame, pane);
};

const makeGableRoofGeometry = (width, depth, height = 0.72) => {
  const halfWidth = width / 2 + 0.18;
  const halfDepth = depth / 2 + 0.18;
  let vertices;
  let indices;

  if (width >= depth) {
    const ridgeHalf = Math.max(halfWidth - 0.42, halfWidth * 0.56);
    vertices = [
      -halfWidth, 0, -halfDepth,
      halfWidth, 0, -halfDepth,
      halfWidth, 0, halfDepth,
      -halfWidth, 0, halfDepth,
      -ridgeHalf, height, 0,
      ridgeHalf, height, 0
    ];
    indices = [0, 5, 1, 0, 4, 5, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2];
  } else {
    const ridgeHalf = Math.max(halfDepth - 0.42, halfDepth * 0.56);
    vertices = [
      -halfWidth, 0, -halfDepth,
      halfWidth, 0, -halfDepth,
      halfWidth, 0, halfDepth,
      -halfWidth, 0, halfDepth,
      0, height, -ridgeHalf,
      0, height, ridgeHalf
    ];
    indices = [0, 5, 4, 0, 3, 5, 1, 4, 5, 1, 5, 2, 0, 4, 1, 3, 2, 5];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const facetedGeometry = geometry.toNonIndexed();
  facetedGeometry.computeVertexNormals();
  geometry.dispose();
  return facetedGeometry;
};

const addBuilding = (spec, index) => {
  const group = new THREE.Group();
  group.userData = { name: spec.name, footprint: spec };
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(spec.width + 0.55, 0.12, spec.depth + 0.55), pavingMaterial);
  foundation.position.y = 0.06;
  foundation.receiveShadow = true;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width, spec.height, spec.depth),
    new THREE.MeshStandardMaterial({ color: spec.colour, roughness: 0.86 })
  );
  body.position.y = spec.height / 2 + 0.12;
  body.castShadow = true;
  body.receiveShadow = true;
  const roof = new THREE.Mesh(
    makeGableRoofGeometry(spec.width, spec.depth),
    new THREE.MeshStandardMaterial({ color: spec.roof, roughness: 0.82, side: THREE.DoubleSide })
  );
  roof.position.y = spec.height + 0.12;
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(foundation, body, roof);

  const storeys = Math.max(1, Math.floor(spec.height / 1.25));
  const columns = spec.width > 2.8 ? 3 : 2;
  for (let floor = 0; floor < storeys; floor += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = ((column + 1) / (columns + 1) - 0.5) * spec.width;
      addWindow(group, x, 0.85 + floor * 1.12, spec.depth / 2 + 0.045, 0.9);
    }
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.9, 0.09), doorMaterial);
  door.position.set(index % 2 ? -spec.width * 0.24 : spec.width * 0.24, 0.57, spec.depth / 2 + 0.06);
  group.add(door);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.42), new THREE.MeshStandardMaterial({ color: spec.roof, roughness: 0.78 }));
  awning.position.set(door.position.x, 1.08, spec.depth / 2 + 0.24);
  awning.rotation.x = -0.18;
  group.add(awning);
  if (index % 3 === 0) {
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.75, 0.3), doorMaterial);
    chimney.position.set(spec.width * 0.25, spec.height + 0.55, 0);
    chimney.castShadow = true;
    group.add(chimney);
  }
  if (spec.protected) {
    const crossMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.18 });
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.1), crossMaterial);
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.18, 0.1), crossMaterial);
    vertical.position.set(0, spec.height * 0.64, spec.depth / 2 + 0.08);
    horizontal.position.copy(vertical.position);
    group.add(vertical, horizontal);
  }
  group.position.set(spec.x, 0, spec.z);
  scene.add(group);
  return group;
};
const townBuildings = BUILDING_SPECS.map(addBuilding);

const addTree = (x, z, scale = 1, variant = 0) => {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, 0.82 * scale, 9), trunkMaterial);
  trunk.position.y = 0.41 * scale;
  trunk.castShadow = true;
  tree.add(trunk);
  for (const [offsetX, offsetY, offsetZ, size] of [[0, 1.12, 0, 0.54], [-0.28, 1.05, 0.04, 0.38], [0.25, 1.03, 0.1, 0.4], [0.05, 1.28, -0.1, 0.38]]) {
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(size * scale, 2), foliageMaterials[variant % foliageMaterials.length]);
    canopy.position.set(offsetX * scale, offsetY * scale, offsetZ * scale);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    tree.add(canopy);
  }
  tree.position.set(x, 0, z);
  scene.add(tree);
};

[
  [-4.6, -1.5, 1.05], [-3.0, -1.5, 0.9], [-1.2, -1.3, 1.08], [0.4, -0.8, 0.86],
  [-4.7, 0.9, 0.92], [-2.8, 1.0, 1.12], [-0.7, 0.9, 0.88],
  [-14.5, 0.1, 0.92], [-14.2, 7.1, 1.0], [14.6, 0.2, 1.1], [14.7, 7.0, 0.9],
  [6.2, -1.4, 0.82], [6.0, 0.9, 0.95], [11.1, 1.0, 0.85]
].forEach(([x, z, scale], index) => addTree(x, z, scale, index));

const lampMetal = new THREE.MeshStandardMaterial({ color: "#343b3a", metalness: 0.55, roughness: 0.48 });
const lampGlow = new THREE.MeshStandardMaterial({ color: "#fff0b7", emissive: "#ffd978", emissiveIntensity: 1.1 });
const addLamp = (x, z) => {
  const lamp = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.65, 9), lampMetal);
  post.position.y = 0.825;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), lampGlow);
  cap.position.y = 1.68;
  lamp.add(post, cap);
  lamp.position.set(x, 0, z);
  scene.add(lamp);
};
for (const x of [-13, -9, -5, -1, 7, 11, 15]) {
  addLamp(x, 5.35);
  addLamp(x, -2.62);
}

const addBench = (x, z, rotation = 0) => {
  const bench = new THREE.Group();
  const timber = new THREE.MeshStandardMaterial({ color: "#8c5e3e", roughness: 0.88 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.34), timber);
  seat.position.y = 0.42;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.09), timber);
  back.position.set(0, 0.66, -0.14);
  for (const legX of [-0.38, 0.38]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.08), lampMetal);
    leg.position.set(legX, 0.21, 0);
    bench.add(leg);
  }
  bench.add(seat, back);
  bench.position.set(x, 0, z);
  bench.rotation.y = rotation;
  scene.add(bench);
};
addBench(-3.7, -0.15, Math.PI / 2);
addBench(-1.8, 1.2, Math.PI);
addBench(0.1, -0.1, -Math.PI / 2);

const fountainStone = new THREE.MeshStandardMaterial({ color: "#c9c3b6", roughness: 0.86 });
const fountainWater = new THREE.MeshPhysicalMaterial({ color: "#72b9ca", transparent: true, opacity: 0.78, roughness: 0.2, metalness: 0.05 });
const fountain = new THREE.Group();
const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.76, 0.26, 32), fountainStone);
basin.position.y = 0.13;
const water = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.035, 32), fountainWater);
water.position.y = 0.28;
const fountainPost = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.62, 18), fountainStone);
fountainPost.position.y = 0.52;
fountain.add(basin, water, fountainPost);
fountain.position.set(-1.35, 0, 0.1);
scene.add(fountain);

const addCar = (x, z, colour, rotation = 0) => {
  const car = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: colour, metalness: 0.16, roughness: 0.52 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.34, 0.58), bodyMaterial);
  body.position.y = 0.34;
  body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.28, 0.5), windowMaterial);
  cabin.position.set(-0.06, 0.62, 0);
  car.add(body, cabin);
  for (const wheelX of [-0.38, 0.38]) {
    for (const wheelZ of [-0.31, 0.31]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 16), lampMetal);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wheelX, 0.2, wheelZ);
      car.add(wheel);
    }
  }
  car.position.set(x, 0.07, z);
  car.rotation.y = rotation;
  scene.add(car);
};
addCar(-9.4, 2.7, "#b65645");
addCar(9.8, 4.5, "#d2a73e", Math.PI);
addCar(4.45, -7.6, "#557d8e", Math.PI / 2);

for (const [x, z] of [[-4.2, 1.65], [-3.6, 1.62], [-3.0, 1.66], [-2.4, 1.63], [-1.8, 1.66]]) {
  const flower = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), flowerMaterial);
  flower.position.set(x, 0.2, z);
  scene.add(flower);
}

const hillMaterial = new THREE.MeshStandardMaterial({ color: "#718866", roughness: 1 });
for (const [x, z, scale] of [[-19, -9, 5.2], [-17, 6, 4.4], [18, -7, 5.8], [19, 7, 4.9]]) {
  const hill = new THREE.Mesh(new THREE.ConeGeometry(scale, scale * 0.7, 9), hillMaterial);
  hill.position.set(x, scale * 0.23 - 0.1, z);
  hill.scale.y = 0.72;
  hill.receiveShadow = true;
  scene.add(hill);
}

const ambientClouds = new THREE.Group();
const fairCloudMaterial = new THREE.MeshStandardMaterial({ color: "#f7fbfa", transparent: true, opacity: 0.88, roughness: 1 });
for (const [x, y, z, scale] of [[-11, 10, -8, 1.4], [2, 11.5, -11, 1.8], [13, 9.4, -7, 1.25]]) {
  const cloud = new THREE.Group();
  for (const [offsetX, offsetY, size] of [[-0.65, 0, 0.72], [0, 0.15, 1], [0.72, -0.02, 0.68]]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(size * scale, 18, 12), fairCloudMaterial);
    puff.scale.y = 0.55;
    puff.position.set(offsetX * scale, offsetY * scale, 0);
    cloud.add(puff);
  }
  cloud.position.set(x, y, z);
  ambientClouds.add(cloud);
}
scene.add(ambientClouds);

const makeBoundary = (position, radius, colour) => {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 9, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
  );
  wall.position.y = 4.5;
  group.add(wall);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.07, radius + 0.07, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  group.add(ring);
  group.position.set(position.x, 0, position.z);
  scene.add(group);
  return group;
};

const civilianPosition = new THREE.Vector3(-2.0, 0, 3.6);
const friendlyPosition = new THREE.Vector3(-6.6, 0, -4.2);
const protectedPosition = new THREE.Vector3(8.9, 0, -0.2);
const humanitarianPosition = new THREE.Vector3(8.3, 0, 3.6);
const civilianBoundary = makeBoundary(civilianPosition, 2.65, colours.civilian);
const friendlyBoundary = makeBoundary(friendlyPosition, 2.35, colours.friendly);
const protectedBoundary = makeBoundary(protectedPosition, 2.8, colours.protected);
const humanitarianBoundary = makeBoundary(humanitarianPosition, 2.5, colours.humanitarian);

const clothingMaterials = ["#d48a2f", "#5b7f9d", "#9a5b53", "#6c8659", "#6f607f"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.82 }));
const skinMaterials = ["#f0c9a2", "#c98964", "#8e5f45"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }));
for (const [index, [x, z]] of [[-2.7,3.2],[-2.1,4.0],[-1.5,3.25],[-2.6,4.15],[-1.55,4.05]].entries()) {
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 4, 8), clothingMaterials[index % clothingMaterials.length]);
  body.position.y = 0.34;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), skinMaterials[index % skinMaterials.length]);
  head.position.y = 0.78;
  body.castShadow = true;
  head.castShadow = true;
  person.add(body, head);
  person.position.set(x, 0, z);
  person.rotation.y = index * 0.9;
  scene.add(person);
}

const friendlyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.friendly), emissive: new THREE.Color(colours.friendly), emissiveIntensity: 0.12 });
const friendlyUnit = new THREE.Group();
const friendlyBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.42, 0.75), friendlyMaterial);
friendlyBase.position.y = 0.3;
const friendlyCab = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.64), windowMaterial);
friendlyCab.position.set(0.18, 0.62, 0);
friendlyUnit.add(friendlyBase, friendlyCab);
for (const x of [-0.4, 0.4]) {
  for (const z of [-0.43, 0.43]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), lampMetal);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.18, z);
    friendlyUnit.add(wheel);
  }
}
friendlyUnit.position.copy(friendlyPosition);
scene.add(friendlyUnit);

const humanitarianMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.humanitarian), emissive: new THREE.Color(colours.humanitarian), emissiveIntensity: 0.1 });
const humanitarianConvoy = new THREE.Group();
for (const offset of [-0.75, 0, 0.75]) {
  const vehicle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.44), humanitarianMaterial);
  body.position.y = 0.28;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.4), windowMaterial);
  cab.position.set(0.16, 0.53, 0);
  vehicle.add(body, cab);
  for (const wheelX of [-0.2, 0.2]) {
    for (const wheelZ of [-0.24, 0.24]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 12), lampMetal);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wheelX, 0.13, wheelZ);
      vehicle.add(wheel);
    }
  }
  vehicle.position.x = offset;
  humanitarianConvoy.add(vehicle);
}
humanitarianConvoy.position.copy(humanitarianPosition);
scene.add(humanitarianConvoy);

const altitudeCeiling = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 18),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(colours.safety), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
);
altitudeCeiling.rotation.x = -Math.PI / 2;
altitudeCeiling.position.y = 7;
altitudeCeiling.visible = false;
scene.add(altitudeCeiling);

const weatherGroup = new THREE.Group();
const cloudMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#7d8789"), transparent: true, opacity: 0.72, roughness: 1 });
for (const [x, y, z, scale] of [[-3,6,0,1.5],[0,6.5,1,1.8],[3,5.7,-1,1.4]]) {
  const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 2), cloudMaterial);
  cloud.scale.y = 0.58;
  cloud.position.set(x, y, z);
  weatherGroup.add(cloud);
}
const rainPositions = [];
for (let index = 0; index < 180; index += 1) {
  rainPositions.push((Math.random() - 0.5) * 13, Math.random() * 6 + 0.5, (Math.random() - 0.5) * 9);
}
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute("position", new THREE.Float32BufferAttribute(rainPositions, 3));
weatherGroup.add(new THREE.Points(rainGeometry, new THREE.PointsMaterial({ color: 0xb9ced3, size: 0.045, transparent: true, opacity: 0.65 })));
weatherGroup.visible = false;
scene.add(weatherGroup);

const drone = new THREE.Group();
const droneBodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#e7ebe4"), roughness: 0.42, metalness: 0.2 });
const droneAccentMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.signal), emissive: new THREE.Color(colours.signal), emissiveIntensity: 0.25 });
const droneBody = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.22, 0.46), droneBodyMaterial);
droneBody.castShadow = true;
drone.add(droneBody);
const droneCanopy = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.36, 6, 12), windowMaterial);
droneCanopy.rotation.z = Math.PI / 2;
droneCanopy.position.set(0.08, 0.13, 0);
const droneCamera = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), lampMetal);
droneCamera.position.set(0.3, -0.2, 0);
drone.add(droneCanopy, droneCamera);
const rotors = [];
for (const [x, z] of [[-0.58,-0.48],[0.58,-0.48],[-0.58,0.48],[0.58,0.48]]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.065, 0.065), droneBodyMaterial);
  arm.position.set(x * 0.48, 0, z * 0.48);
  arm.rotation.y = x * z > 0 ? -0.69 : 0.69;
  drone.add(arm);
  const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.025, 8, 28), droneAccentMaterial);
  rotor.rotation.x = Math.PI / 2;
  rotor.position.set(x, 0.09, z);
  drone.add(rotor);
  rotors.push(rotor);
}
for (const z of [-0.25, 0.25]) {
  const skid = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 8, 20, Math.PI), droneBodyMaterial);
  skid.rotation.set(0, Math.PI / 2, Math.PI / 2);
  skid.position.set(0, -0.24, z);
  drone.add(skid);
}
scene.add(drone);

const bounderEnvelope = new THREE.Mesh(
  new THREE.TorusGeometry(0.98, 0.045, 10, 56),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(colours.signal), transparent: true, opacity: 0.92 })
);
bounderEnvelope.rotation.x = Math.PI / 2;
bounderEnvelope.position.y = -0.28;
drone.add(bounderEnvelope);

const fleetDrones = Array.from({ length: 6 }, (_, index) => {
  const guardian = drone.clone(true);
  guardian.scale.setScalar(0.82 - index * 0.018);
  guardian.visible = false;
  guardian.userData.guardianIndex = index + 2;
  scene.add(guardian);
  return guardian;
});

const curves = Object.fromEntries(Object.entries(ROUTE_WAYPOINTS).map(([name, waypoints]) => [
  name,
  new THREE.CatmullRomCurve3(waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, "centripetal", 0.35)
]));

const findCurveBuildingCollisions = (curve, clearance = 0.45) => {
  const collisions = new Set();
  for (const point of curve.getPoints(500)) {
    for (const building of BUILDING_SPECS) {
      const insideX = Math.abs(point.x - building.x) <= building.width / 2 + clearance;
      const insideZ = Math.abs(point.z - building.z) <= building.depth / 2 + clearance;
      if (insideX && insideZ && point.y <= building.height + 0.8 + clearance) collisions.add(building.name);
    }
  }
  return [...collisions];
};
const routeClearanceAudit = Object.fromEntries(Object.entries(curves).map(([name, curve]) => [name, findCurveBuildingCollisions(curve)]));
window.__bounderSceneAudit = {
  buildingCount: BUILDING_SPECS.length,
  routeClearance: routeClearanceAudit,
  routesClear: Object.values(routeClearanceAudit).every((collisions) => collisions.length === 0)
};
stage.dataset.routesClear = String(window.__bounderSceneAudit.routesClear);
stage.dataset.buildingCount = String(BUILDING_SPECS.length);
stage.dataset.routeClearance = JSON.stringify(routeClearanceAudit);
if (!window.__bounderSceneAudit.routesClear) console.error("Bounder route clearance invariant failed", routeClearanceAudit);

const routeMaterial = new THREE.LineDashedMaterial({ color: new THREE.Color(colours.route), dashSize: 0.44, gapSize: 0.2, transparent: true, opacity: 1 });
const routeGlowMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#b8ef87"), transparent: true, opacity: 0.3, depthWrite: false });
let routeLine;
let routeGlow;
let routeWaypoints;
const showRoute = (curve) => {
  if (routeLine) {
    scene.remove(routeLine);
    routeLine.geometry.dispose();
  }
  if (routeGlow) {
    scene.remove(routeGlow);
    routeGlow.geometry.dispose();
  }
  if (routeWaypoints) {
    scene.remove(routeWaypoints);
    for (const marker of routeWaypoints.children) {
      marker.geometry.dispose();
      marker.material.dispose();
    }
  }
  const points = curve.getPoints(180).map((point) => new THREE.Vector3(point.x, 0.15, point.z));
  const projectedCurve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.35);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  routeGlow = new THREE.Mesh(new THREE.TubeGeometry(projectedCurve, 180, 0.045, 6, false), routeGlowMaterial);
  routeLine = new THREE.Line(geometry, routeMaterial);
  routeLine.computeLineDistances();
  routeWaypoints = new THREE.Group();
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 12, 8),
      new THREE.MeshBasicMaterial({ color: colours.route, transparent: true, opacity: t === 1 ? 1 : 0.72 })
    );
    marker.position.copy(projectedCurve.getPointAt(t));
    routeWaypoints.add(marker);
  }
  scene.add(routeGlow, routeLine, routeWaypoints);
};

const scenarioPresentation = Object.freeze({
  safe: { stop: 1, initial: "All reviewed constraints currently pass." },
  civilian: { stop: 0.94, initial: "The route is approaching an active civilian-protection buffer." },
  friendly: { stop: 0.94, initial: "Authenticated friendly presence is inside the planned route corridor." },
  protected: { stop: 0.94, initial: "The route is approaching a declared protected-site boundary." },
  humanitarian: { stop: 0.94, initial: "The route is approaching an active humanitarian movement corridor." },
  altitude: { stop: 0.57, initial: "Local altitude is being compared with the signed flight ceiling." },
  weather: { stop: 0.48, initial: "Visibility and wind observations are approaching the permitted envelope." },
  window: { stop: 0.22, initial: "The requested state change is being checked against its authorized time window." },
  link: { stop: 0.3, initial: "Bounder is monitoring heartbeat and telemetry freshness." },
  replay: { stop: 0, initial: "The supplied policy sequence was already accepted." }
});

const expectedScenarioIDs = Object.keys(scenarioPresentation);
const validRules = new Set(["all", ...[...root.querySelectorAll(".rule-stack li")].map((item) => item.dataset.rule)]);
let receiptBundle;
let receiptsByScenario = new Map();
let fleetEvidence;
let fleetMode = false;

const validateReceiptBundle = (bundle) => {
  if (!bundle || bundle.version !== "bounder-receipt-bundle/v1" || bundle.engine !== "bounder-io/interlock" || !Array.isArray(bundle.receipts)) {
    throw new Error("receipt bundle metadata is invalid");
  }
  if (bundle.receipts.length !== expectedScenarioIDs.length) throw new Error("receipt bundle scenario count is invalid");
  const receipts = new Map();
  for (const receipt of bundle.receipts) {
    if (!receipt || receipt.version !== "bounder-receipt/v1" || !expectedScenarioIDs.includes(receipt.scenario)) {
      throw new Error("receipt scenario or version is invalid");
    }
    if (receipts.has(receipt.scenario) || !validRules.has(receipt.rule)) throw new Error("receipt scenario or rule is duplicated or unknown");
    if (typeof receipt.allowed !== "boolean" || typeof receipt.code !== "string" || typeof receipt.reason !== "string") {
      throw new Error("receipt decision is invalid");
    }
    if (typeof receipt.signature_verified !== "boolean" || !/^sha256:[0-9a-f]{64}$/.test(receipt.policy_hash)) {
      throw new Error("receipt provenance is invalid");
    }
    if (!receipt.adapter || receipt.adapter.command_sent !== false || typeof receipt.adapter.output !== "string") {
      throw new Error("receipt adapter state is invalid");
    }
    if ((receipt.scenario === "safe") !== receipt.allowed) throw new Error("receipt allow set is invalid");
    receipts.set(receipt.scenario, receipt);
  }
  if (expectedScenarioIDs.some((name) => !receipts.has(name))) throw new Error("receipt bundle is incomplete");
  return receipts;
};

const loadReceiptBundle = async () => {
  const response = await fetch("./data/bounder-receipts.v1.json", { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error(`receipt bundle request failed with ${response.status}`);
  const bundle = await response.json();
  const receipts = validateReceiptBundle(bundle);
  receiptBundle = bundle;
  receiptsByScenario = receipts;
  stage.dataset.receiptBundleVersion = bundle.version;
  stage.dataset.receiptEngine = bundle.engine;
  stage.dataset.receiptCount = String(receipts.size);
  stage.dataset.receiptsReady = "true";
};

const validateFleetEvidence = (evidence) => {
  if (!evidence || evidence.version !== "bounder-fleet-evidence/v1" || evidence.fleet_id !== "relief-fleet") {
    throw new Error("fleet evidence metadata is invalid");
  }
  if (!evidence.summary || evidence.summary.devices !== 11 || evidence.summary.passed !== 11 || evidence.summary.allowed + evidence.summary.blocked !== 11 || typeof evidence.policy_profile !== "string" || !Array.isArray(evidence.devices) || evidence.devices.length !== 11) {
    throw new Error("fleet evidence summary is invalid");
  }
  const deviceIDs = new Set();
  for (const device of evidence.devices) {
    if (!device?.passed || typeof device.device_id !== "string" || typeof device.scenario !== "string" || typeof device.receipt?.code !== "string" || typeof device.receipt.allowed !== "boolean") {
      throw new Error("fleet device evidence is invalid");
    }
    if (deviceIDs.has(device.device_id)) throw new Error("fleet device evidence is duplicated");
    deviceIDs.add(device.device_id);
  }
  if (!evidence.resilience || evidence.resilience.version !== "bounder-resilience-evidence/v1" || evidence.resilience.mode !== "deterministic-live-replay" || !Array.isArray(evidence.resilience.scenarios) || evidence.resilience.scenarios.length < 8) {
    throw new Error("fleet resilience evidence is invalid");
  }
  const resilienceIDs = new Set();
  for (const scenario of evidence.resilience.scenarios) {
    if (!scenario?.id || resilienceIDs.has(scenario.id) || !scenario.name || !scenario.expected_code || !scenario.safe_response || !scenario.proof || !Array.isArray(scenario.events) || scenario.events.length < 3) {
      throw new Error("fleet resilience scenario is invalid");
    }
    let previousTime = -1;
    for (const event of scenario.events) {
      if (!Number.isInteger(event.at_ms) || event.at_ms < previousTime || !event.kind || !event.status || !event.code || !event.message) {
        throw new Error("fleet resilience timeline is invalid");
      }
      previousTime = event.at_ms;
    }
    resilienceIDs.add(scenario.id);
  }
  return evidence;
};

const renderFleetEvidence = (evidence) => {
  fleetFields.name.textContent = evidence.fleet_id;
  fleetFields.devices.textContent = `${evidence.summary.devices} verified`;
  fleetFields.policy.textContent = evidence.policy_profile;
  fleetFields.policy.title = evidence.policy_profile;
  fleetFields.evidence.textContent = `${evidence.summary.allowed} allow · ${evidence.summary.blocked} hold`;
  const fragment = document.createDocumentFragment();
  for (const device of evidence.devices) {
    const node = document.createElement("span");
    node.className = `fleet-node ${device.receipt.allowed ? "is-allowed" : "is-held"}`;
    node.setAttribute("role", "listitem");
    node.dataset.deviceId = device.device_id;
    node.title = `${device.device_id}: ${device.scenario} · ${device.receipt.code}`;
    const marker = document.createElement("i");
    marker.setAttribute("aria-hidden", "true");
    const label = document.createElement("b");
    label.textContent = device.device_id.replace("bounder-", "");
    const code = document.createElement("small");
    code.textContent = device.receipt.code.replaceAll("_", " ");
    node.append(marker, label, code);
    fragment.append(node);
  }
  fleetNodes.replaceChildren(fragment);
  stage.dataset.fleetEvidenceVersion = evidence.version;
  stage.dataset.fleetGuardians = String(evidence.summary.devices);
  stage.dataset.fleetReady = "true";
};

const resilienceRoute = Object.freeze({
  "network-partition": "civilian",
  "audit-outage": "civilian",
  "corrupted-envelope": "replay",
  "clock-rollback": "window",
  "guardian-restart": "replay",
  "key-revocation": "replay",
  "stale-evidence": "weather",
  "partial-rollout": "civilian",
  "fleet-revocation": "link",
  "offline-expiry": "link"
});
const resilienceRule = Object.freeze({
  "network-partition": "link",
  "audit-outage": "fleet",
  "corrupted-envelope": "fleet",
  "clock-rollback": "operating",
  "guardian-restart": "fleet",
  "key-revocation": "fleet",
  "stale-evidence": "authority",
  "partial-rollout": "fleet",
  "fleet-revocation": "fleet",
  "offline-expiry": "authority"
});
let selectedResilience;
let resilienceCursor = -1;
let resilienceTimers = [];
let resilienceSource;
let resilienceMode = false;

const clearResilienceTransport = () => {
  for (const timer of resilienceTimers) window.clearTimeout(timer);
  resilienceTimers = [];
  if (resilienceSource) {
    resilienceSource.close();
    resilienceSource = undefined;
  }
  resilienceActions.pause.disabled = true;
};

const renderResilienceTimeline = () => {
  if (!selectedResilience) return;
  const fragment = document.createDocumentFragment();
  selectedResilience.events.forEach((event, index) => {
    const item = document.createElement("li");
    item.className = "resilience-event";
    item.classList.toggle("is-reached", index <= resilienceCursor);
    item.classList.toggle("is-current", index === resilienceCursor);
    item.classList.toggle("is-fault", event.status === "fault");
    item.classList.toggle("is-held", event.status === "held");
    const time = document.createElement("time");
    time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
    const label = document.createElement("b");
    label.textContent = event.kind;
    const code = document.createElement("code");
    code.textContent = event.code;
    item.title = event.message;
    item.append(time, label, code);
    fragment.append(item);
  });
  resilienceEvents.replaceChildren(fragment);
};

const markAffectedGuardians = (device) => {
  for (const node of fleetNodes.querySelectorAll(".fleet-node")) {
    const all = device === "all guardians" || device === "six canaries";
    node.classList.toggle("is-affected", all || node.dataset.deviceId === device);
  }
};

const applyResilienceEvent = (event) => {
  if (!selectedResilience) return;
  const index = selectedResilience.events.findIndex((candidate) => candidate.at_ms === event.at_ms && candidate.code === event.code);
  if (index < 0) return;
  resilienceCursor = index;
  resilienceScrubber.value = String(event.at_ms);
  resilienceFields.time.textContent = `${(event.at_ms / 1000).toFixed(2)} s`;
  resilienceFields.transport.textContent = event.kind === "audit" ? "Evidence recorded" : event.message;
  renderResilienceTimeline();
  markAffectedGuardians(event.device_id || selectedResilience.affected_device);
  receiptSource.textContent = "Fleet resilience evidence";
  receiptFields.engine.textContent = "Creed Space Fleet + Bounder guardian";
  receiptFields.signature.textContent = "Verified in Fleet laboratory";
  receiptFields.policy.textContent = fleetEvidence.policy_profile;
  receiptFields.issuer.textContent = "creed.space/fleet";
  receiptFields.subject.textContent = event.device_id || selectedResilience.affected_device;
  receiptFields.sequence.textContent = String(event.policy_sequence || 0);
  receiptFields.evidence.textContent = selectedResilience.proof;
  receiptFields.evaluated.textContent = `t + ${(event.at_ms / 1000).toFixed(2)} seconds`;
  receiptFields.hash.textContent = "See signed Fleet evidence bundle";
  if (event.kind === "baseline") {
    phaseElement.textContent = "Policy active";
    outcomeElement.textContent = "Monitoring";
    adapterOutput.textContent = "No state change yet";
    setRuleState(resilienceRule[selectedResilience.id], false);
  } else if (event.kind === "fault") {
    phaseElement.textContent = "Fault injected";
    outcomeElement.textContent = "Verifying";
    adapterOutput.textContent = "Authority frozen during verification";
    setRuleState(resilienceRule[selectedResilience.id], false);
  } else if (event.kind === "decision") {
    phaseElement.textContent = "Bounder held";
    outcomeElement.textContent = "Held safely";
    adapterOutput.textContent = "No new command authority";
    setRuleState(resilienceRule[selectedResilience.id], true);
    bounderEnvelope.material.color.set(colours.safety);
  } else {
    phaseElement.textContent = "Receipt recorded";
    outcomeElement.textContent = "Audited";
    adapterOutput.textContent = "Safe state retained";
  }
  statusCode.textContent = event.code;
  decisionCode.textContent = event.code;
  reasonElement.textContent = event.message;
};

const resetResilience = () => {
  clearResilienceTransport();
  resilienceCursor = -1;
  resilienceScrubber.value = "0";
  resilienceFields.time.textContent = "0.00 s";
  resilienceFields.transport.textContent = "Ready";
  markAffectedGuardians("");
  renderResilienceTimeline();
  if (selectedResilience) {
    const first = selectedResilience.events[0];
    drone.position.copy(curves[resilienceRoute[selectedResilience.id]].getPointAt(0));
    bounderEnvelope.material.color.set(colours.signal);
    statusCode.textContent = first.code;
    decisionCode.textContent = "ready";
    phaseElement.textContent = "Fault laboratory ready";
    outcomeElement.textContent = "Ready";
    reasonElement.textContent = selectedResilience.fault;
    adapterOutput.textContent = "No state change yet";
    receiptSource.textContent = "Fleet resilience evidence";
    receiptFields.engine.textContent = "Creed Space Fleet + Bounder guardian";
    receiptFields.signature.textContent = "Verified in Fleet laboratory";
    receiptFields.policy.textContent = fleetEvidence.policy_profile;
    receiptFields.issuer.textContent = "creed.space/fleet";
    receiptFields.subject.textContent = selectedResilience.affected_device;
    receiptFields.sequence.textContent = String(first.policy_sequence || 0);
    receiptFields.evidence.textContent = selectedResilience.proof;
    receiptFields.evaluated.textContent = "Ready to stream";
    receiptFields.hash.textContent = "See signed Fleet evidence bundle";
    setRuleState(resilienceRule[selectedResilience.id], false);
  }
};

const playResilienceLocally = () => {
  clearResilienceTransport();
  const origin = resilienceCursor >= 0 ? selectedResilience.events[resilienceCursor].at_ms : 0;
  selectedResilience.events.forEach((event, index) => {
    if (index <= resilienceCursor) return;
    resilienceTimers.push(window.setTimeout(() => {
      applyResilienceEvent(event);
      if (index === selectedResilience.events.length - 1) resilienceActions.pause.disabled = true;
    }, Math.max(0, event.at_ms - origin)));
  });
  resilienceActions.pause.disabled = false;
  resilienceFields.transport.textContent = "Deterministic evidence replay";
};

const runResilience = () => {
  if (!selectedResilience) return;
  resetResilience();
  if (!("EventSource" in window)) {
    playResilienceLocally();
    return;
  }
  let received = false;
  const source = new EventSource(`./api/resilience/events?scenario=${encodeURIComponent(selectedResilience.id)}`);
  resilienceSource = source;
  resilienceActions.pause.disabled = false;
  resilienceFields.transport.textContent = "Connecting to local Fleet stream";
  source.addEventListener("resilience", ({ data }) => {
    received = true;
    try {
      applyResilienceEvent(JSON.parse(data));
    } catch (error) {
      console.error("Invalid resilience stream event", error);
      source.close();
    }
  });
  source.addEventListener("complete", () => {
    source.close();
    resilienceSource = undefined;
    resilienceActions.pause.disabled = true;
  });
  source.onerror = () => {
    source.close();
    resilienceSource = undefined;
    if (!received) playResilienceLocally();
  };
};

const selectResilienceScenario = (id) => {
  const scenario = fleetEvidence.resilience.scenarios.find((candidate) => candidate.id === id);
  if (!scenario) return;
  clearResilienceTransport();
  resilienceMode = false;
  selectScenario(resilienceRoute[id]);
  resilienceMode = true;
  playing = false;
  playButton.textContent = "Play simulation";
  playButton.disabled = true;
  for (const button of root.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", "false");
  }
  selectedResilience = scenario;
  for (const button of resilienceScenarios.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.resilienceScenario === id));
  }
  resilienceFields.name.textContent = scenario.name;
  resilienceFields.fault.textContent = scenario.fault;
  resilienceFields.device.textContent = scenario.affected_device;
  resilienceFields.expected.textContent = scenario.expected_code;
  resilienceFields.response.textContent = scenario.safe_response;
  resilienceFields.proof.textContent = scenario.proof;
  resilienceScrubber.max = String(scenario.events[scenario.events.length - 1].at_ms);
  resetResilience();
};

const renderResilienceEvidence = (evidence) => {
  const fragment = document.createDocumentFragment();
  for (const scenario of evidence.resilience.scenarios) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "resilience-scenario";
    button.dataset.resilienceScenario = scenario.id;
    button.setAttribute("aria-pressed", "false");
    button.textContent = scenario.name;
    button.addEventListener("click", () => selectResilienceScenario(scenario.id));
    fragment.append(button);
  }
  resilienceScenarios.replaceChildren(fragment);
  resilienceLab.hidden = false;
};

const loadFleetEvidence = async () => {
  const response = await fetch("./data/bounder-fleet-evidence.v1.json", { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error(`fleet evidence request failed with ${response.status}`);
  fleetEvidence = validateFleetEvidence(await response.json());
  renderFleetEvidence(fleetEvidence);
  renderResilienceEvidence(fleetEvidence);
};

let selectedScenario = "safe";
let progress = 0;
let playing = !reduceMotion;
let lastTime = 0;
let deniedTime = 0;
let currentReceipt;

const setRuleState = (failedRule, triggered) => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    const isTarget = item.dataset.rule === failedRule;
    item.classList.toggle("is-failed", isTarget && triggered);
    item.classList.toggle("is-monitoring", isTarget && !triggered);
    item.querySelector("strong").textContent = isTarget ? (triggered ? "DENY" : "CHECK") : "PASS";
  }
};

const renderReceiptMetadata = (receipt) => {
  receiptSource.textContent = receipt.decision_source === receiptBundle.engine ? "Go interlock receipt" : "Adapter receipt after Go verification";
  receiptFields.engine.textContent = receipt.decision_source;
  receiptFields.signature.textContent = receipt.signature_verified ? "Ed25519 verified by engine" : "Verification precondition failed";
  receiptFields.policy.textContent = receipt.policy_id;
  receiptFields.issuer.textContent = receipt.issuer;
  receiptFields.subject.textContent = receipt.subject;
  receiptFields.sequence.textContent = String(receipt.sequence);
  receiptFields.evidence.textContent = `${receipt.evidence.tier} · ${receipt.evidence.auditor} · age ${receipt.evidence.age_seconds}s`;
  receiptFields.evaluated.textContent = receipt.evaluated_at;
  receiptFields.hash.textContent = receipt.policy_hash;
};

const setDecision = (receipt, presentation, triggered) => {
  renderReceiptMetadata(receipt);
  if (!triggered) {
    phaseElement.textContent = "Bounder monitoring";
    statusCode.textContent = "evaluating";
    outcomeElement.textContent = "Monitoring";
    decisionCode.textContent = "evaluating";
    reasonElement.textContent = presentation.initial;
    adapterOutput.textContent = "No state change yet";
    setRuleState(receipt.rule, false);
    return;
  }
  phaseElement.textContent = receipt.allowed ? "Route complete" : "Bounder denied";
  statusCode.textContent = receipt.code;
  outcomeElement.textContent = receipt.allowed ? "Allowed" : "Denied";
  decisionCode.textContent = receipt.code;
  reasonElement.textContent = receipt.reason;
  adapterOutput.textContent = receipt.adapter.output;
  setRuleState(receipt.rule, !receipt.allowed);
};

const selectScenario = (name) => {
  const receipt = receiptsByScenario.get(name);
  if (!receipt) return;
  selectedScenario = name;
  currentReceipt = receipt;
  progress = 0;
  deniedTime = 0;
  playing = !reduceMotion;
  playButton.textContent = playing ? "Pause simulation" : "Play simulation";
  playButton.setAttribute("aria-pressed", String(!playing));
  for (const button of root.querySelectorAll("[data-scenario]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scenario === name));
  }
  civilianBoundary.visible = name === "civilian";
  friendlyBoundary.visible = name === "friendly";
  protectedBoundary.visible = name === "protected";
  humanitarianBoundary.visible = name === "humanitarian";
  altitudeCeiling.visible = name === "altitude";
  weatherGroup.visible = name === "weather";
  sun.intensity = name === "window" ? 0.75 : name === "weather" ? 1.35 : 3.1;
  scene.background.set(name === "window" ? "#68778b" : name === "weather" ? "#88979b" : "#b9d7df");
  scene.fog.color.copy(scene.background);
  scene.fog.near = name === "weather" ? 18 : 28;
  scene.fog.far = name === "weather" ? 32 : 62;
  ambientClouds.visible = name !== "weather";
  showRoute(curves[name]);
  drone.position.copy(curves[name].getPointAt(0));
  bounderEnvelope.material.color.set(colours.signal);
  bounderEnvelope.scale.setScalar(1);
  setDecision(receipt, scenarioPresentation[name], name === "replay");
};

const update = (delta, elapsed) => {
  if (!currentReceipt) return;
  const presentation = scenarioPresentation[selectedScenario];
  if (playing && progress < presentation.stop) progress = Math.min(presentation.stop, progress + delta * 0.085);
  const point = curves[selectedScenario].getPointAt(progress);
  const nextPoint = curves[selectedScenario].getPointAt(Math.min(progress + 0.008, 1));
  drone.position.copy(point);
  drone.position.y += Math.sin(elapsed * 0.004) * 0.045;
  drone.rotation.y = Math.atan2(nextPoint.x - point.x, nextPoint.z - point.z);
  for (let index = 0; index < fleetDrones.length; index += 1) {
    const guardian = fleetDrones[index];
    guardian.visible = fleetMode;
    if (!fleetMode) continue;
    const guardianProgress = Math.max(0, progress - (index + 1) * 0.055);
    const guardianPoint = curves[selectedScenario].getPointAt(guardianProgress);
    const guardianNext = curves[selectedScenario].getPointAt(Math.min(guardianProgress + 0.008, 1));
    guardian.position.copy(guardianPoint);
    guardian.position.y += Math.sin(elapsed * 0.003 + index) * 0.04;
    guardian.rotation.y = Math.atan2(guardianNext.x - guardianPoint.x, guardianNext.z - guardianPoint.z);
  }
  for (const rotor of rotors) rotor.rotation.z += delta * 12;
  ambientClouds.position.x = Math.sin(elapsed * 0.00008) * 0.55;
  if (weatherGroup.visible) {
    weatherGroup.rotation.y += delta * 0.035;
    const rain = weatherGroup.children[weatherGroup.children.length - 1];
    const positions = rain.geometry.attributes.position;
    for (let index = 1; index < positions.count * 3; index += 3) {
      positions.array[index] -= delta * 5;
      if (positions.array[index] < 0.3) positions.array[index] = 6.5;
    }
    positions.needsUpdate = true;
  }

  if (resilienceMode) return;

  const triggered = progress >= presentation.stop;
  if (triggered && !currentReceipt.allowed) {
    deniedTime += delta;
    bounderEnvelope.material.color.set(colours.safety);
    bounderEnvelope.scale.setScalar(1 + Math.sin(deniedTime * 7) * 0.13);
    setDecision(currentReceipt, presentation, true);
  } else if (triggered && currentReceipt.allowed) {
    setDecision(currentReceipt, presentation, true);
  }
};

const resize = () => {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

const animate = (time) => {
  const delta = Math.min((time - lastTime) / 1000 || 0, 0.05);
  lastTime = time;
  update(delta, time);
  updateCameraNavigation(delta);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

for (const button of root.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => {
    clearResilienceTransport();
    resilienceMode = false;
    selectedResilience = undefined;
    markAffectedGuardians("");
    playButton.disabled = false;
    selectScenario(button.dataset.scenario);
  });
}
playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause simulation" : "Play simulation";
  playButton.setAttribute("aria-pressed", String(!playing));
});
fleetButton.addEventListener("click", () => {
  if (!fleetEvidence) return;
  fleetMode = !fleetMode;
  fleetButton.textContent = fleetMode ? "Single guardian" : "Show fleet";
  fleetButton.setAttribute("aria-pressed", String(fleetMode));
  root.querySelector(".fleet-control-panel").classList.toggle("is-active", fleetMode);
  if (!fleetMode) for (const guardian of fleetDrones) guardian.visible = false;
});
resilienceActions.run.addEventListener("click", runResilience);
resilienceActions.pause.addEventListener("click", () => {
  clearResilienceTransport();
  resilienceFields.transport.textContent = "Paused";
});
resilienceActions.step.addEventListener("click", () => {
  if (!selectedResilience) return;
  clearResilienceTransport();
  const next = Math.min(resilienceCursor + 1, selectedResilience.events.length - 1);
  applyResilienceEvent(selectedResilience.events[next]);
});
resilienceActions.reset.addEventListener("click", resetResilience);
resilienceScrubber.addEventListener("input", () => {
  if (!selectedResilience) return;
  clearResilienceTransport();
  const time = Number(resilienceScrubber.value);
  const index = selectedResilience.events.findLastIndex((event) => event.at_ms <= time);
  if (index >= 0) applyResilienceEvent(selectedResilience.events[index]);
  else resetResilience();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    playing = false;
    clearResilienceTransport();
  }
});
new ResizeObserver(resize).observe(stage);
const reportEmbeddedHeight = () => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "bounder-simulator-height", height: document.documentElement.scrollHeight }, window.location.origin);
  }
};
new ResizeObserver(reportEmbeddedHeight).observe(document.body);

const showReceiptLoadFailure = () => {
  playing = false;
  playButton.disabled = true;
  fleetButton.disabled = true;
  for (const button of root.querySelectorAll("[data-scenario]")) button.disabled = true;
  stage.dataset.receiptsReady = "false";
  stage.dataset.fleetReady = "false";
  receiptSource.textContent = "Receipt fixture unavailable";
  phaseElement.textContent = "Simulation paused";
  statusCode.textContent = "fixture_unavailable";
  outcomeElement.textContent = "Unavailable";
  decisionCode.textContent = "fixture_unavailable";
  reasonElement.textContent = "The Go interlock receipt bundle could not be loaded or validated. The simulation remains paused.";
  adapterOutput.textContent = "No command authority";
  setRuleState("all", false);
};

const bootstrap = async () => {
  playButton.disabled = true;
  try {
    await Promise.all([loadReceiptBundle(), loadFleetEvidence()]);
    playButton.disabled = false;
    fleetButton.disabled = false;
    selectScenario("safe");
    selectResilienceScenario(fleetEvidence.resilience.scenarios[0].id);
  } catch (error) {
    console.error("Bounder receipt bundle failed closed", error);
    showRoute(curves.safe);
    drone.position.copy(curves.safe.getPointAt(0));
    showReceiptLoadFailure();
  }
  resize();
  reportEmbeddedHeight();
  requestAnimationFrame(animate);
};

bootstrap();
