import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js?deps=three@0.180.0";

const root = document.querySelector(".simulator-workbench");
const stage = root.querySelector(".simulator-stage");
const canvas = stage.querySelector("canvas");
const phaseElement = root.querySelector(".status-phase");
const statusCode = root.querySelector(".status-code");
const outcomeElement = root.querySelector(".decision-outcome");
const decisionCode = root.querySelector(".decision-code");
const reasonElement = root.querySelector(".decision-reason");
const adapterOutput = root.querySelector(".adapter-output");
const playButton = root.querySelector("[data-action='play']");
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
renderer.setClearColor(new THREE.Color(colours.ink), 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color(colours.ink), 24, 48);
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
camera.position.set(15, 14, 17);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = 12;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.48;

scene.add(new THREE.HemisphereLight(0xffffff, 0x455044, 1.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(8, 15, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(32, 24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color("#242920"), roughness: 0.98 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(32, 32, new THREE.Color("#596052"), new THREE.Color("#353b31"));
grid.material.transparent = true;
grid.material.opacity = 0.52;
scene.add(grid);

const roadMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#171a17"), roughness: 0.96 });
for (const [width, depth, x, z] of [[32, 2.5, 0, 2.1], [2.8, 24, 3.1, 0], [18, 1.8, -5, -3.3]]) {
  const road = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, 0.012, z);
  road.receiveShadow = true;
  scene.add(road);
}
const laneMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#7f896f"), transparent: true, opacity: 0.55 });
for (let x = -14; x <= 14; x += 2.2) {
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.055), laneMaterial);
  dash.rotation.x = -Math.PI / 2;
  dash.position.set(x, 0.025, 2.1);
  scene.add(dash);
}
const park = new THREE.Mesh(
  new THREE.PlaneGeometry(6.2, 4.2),
  new THREE.MeshStandardMaterial({ color: new THREE.Color("#33432e"), roughness: 1 })
);
park.rotation.x = -Math.PI / 2;
park.position.set(-4.8, 0.018, -0.6);
scene.add(park);

const buildingMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#4c5348"), roughness: 0.88 });
const roofMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#626a5e"), roughness: 0.8 });
const buildings = [[-8,-5,2.4],[-5.2,-5.4,3.6],[-2,-5.2,2.6],[6.8,-5,3.1],[9,-2,4.3],[-8,1,3.8],[-8,4.8,2.5],[5.8,5.1,3.5],[9,4,2.2]];
for (const [x, z, height] of buildings) {
  const building = new THREE.Mesh(new THREE.BoxGeometry(2.25, height, 2.25), buildingMaterial);
  building.position.set(x, height / 2, z);
  building.castShadow = true;
  building.receiveShadow = true;
  scene.add(building);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.12, 2.35), roofMaterial);
  roof.position.set(x, height + 0.06, z);
  scene.add(roof);
}

const trunkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#544638"), roughness: 1 });
const canopyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#58734a"), roughness: 0.94 });
for (const [x, z, scale] of [[-7,-1.5,1],[-5,-1.1,1.2],[-3,-0.6,.9],[-6.4,.4,.8],[-3.4,.8,1.1],[7,1,.9],[8.8,1.3,.75],[7.5,-.8,.8]]) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.75, 9), trunkMaterial);
  trunk.position.y = 0.375;
  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * scale, 1), canopyMaterial);
  canopy.position.y = 1.05;
  canopy.castShadow = true;
  tree.add(trunk, canopy);
  tree.position.set(x, 0, z);
  scene.add(tree);
}

const makeBoundary = (position, radius, colour) => {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 4.6, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })
  );
  wall.position.y = 2.3;
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

const civilianPosition = new THREE.Vector3(1.2, 0, 0.2);
const friendlyPosition = new THREE.Vector3(-2.2, 0, 4.6);
const protectedPosition = new THREE.Vector3(5.1, 0, -2.7);
const humanitarianPosition = new THREE.Vector3(3.6, 0, 3.3);
const civilianBoundary = makeBoundary(civilianPosition, 2.65, colours.civilian);
const friendlyBoundary = makeBoundary(friendlyPosition, 2.35, colours.friendly);
const protectedBoundary = makeBoundary(protectedPosition, 2.8, colours.protected);
const humanitarianBoundary = makeBoundary(humanitarianPosition, 2.5, colours.humanitarian);

const personMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.civilian), roughness: 0.7 });
for (const [x, z] of [[0.6,-0.2],[1.5,0.4],[2,0],[0.9,0.8],[1.9,1]]) {
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.4, 4, 8), personMaterial);
  body.position.y = 0.34;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), personMaterial);
  head.position.y = 0.78;
  person.add(body, head);
  person.position.set(x, 0, z);
  scene.add(person);
}

const friendlyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.friendly), emissive: new THREE.Color(colours.friendly), emissiveIntensity: 0.12 });
const friendlyUnit = new THREE.Group();
const friendlyBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.42, 0.75), friendlyMaterial);
friendlyBase.position.y = 0.3;
friendlyUnit.add(friendlyBase);
for (const x of [-0.4, 0.4]) {
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), friendlyMaterial);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(x, 0.18, 0.43);
  friendlyUnit.add(wheel);
}
friendlyUnit.position.copy(friendlyPosition);
scene.add(friendlyUnit);

const protectedMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#d9ddd5"), roughness: 0.85 });
const protectedRoofMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.protected), roughness: 0.75 });
const protectedSite = new THREE.Group();
const protectedBuilding = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.8, 2.3), protectedMaterial);
protectedBuilding.position.y = 0.9;
const protectedRoof = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.18, 2.45), protectedRoofMaterial);
protectedRoof.position.y = 1.9;
protectedSite.add(protectedBuilding, protectedRoof);
protectedSite.position.copy(protectedPosition);
scene.add(protectedSite);

const humanitarianMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.humanitarian), emissive: new THREE.Color(colours.humanitarian), emissiveIntensity: 0.1 });
const humanitarianConvoy = new THREE.Group();
for (const offset of [-0.75, 0, 0.75]) {
  const vehicle = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.42), humanitarianMaterial);
  vehicle.position.set(offset, 0.22, 0);
  humanitarianConvoy.add(vehicle);
}
humanitarianConvoy.position.copy(humanitarianPosition);
scene.add(humanitarianConvoy);

const altitudeCeiling = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 18),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(colours.safety), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
);
altitudeCeiling.rotation.x = -Math.PI / 2;
altitudeCeiling.position.y = 4.2;
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
scene.add(drone);

const bounderEnvelope = new THREE.Mesh(
  new THREE.TorusGeometry(0.98, 0.045, 10, 56),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(colours.signal), transparent: true, opacity: 0.92 })
);
bounderEnvelope.rotation.x = Math.PI / 2;
bounderEnvelope.position.y = -0.28;
drone.add(bounderEnvelope);

const curves = {
  safe: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,5.5),new THREE.Vector3(-3.5,2.1,7),new THREE.Vector3(2.5,2,6.4),new THREE.Vector3(7.5,1.9,4),new THREE.Vector3(11,1.8,1)]),
  civilian: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,4.5),new THREE.Vector3(-3,1.9,2),new THREE.Vector3(1.2,1.8,0.2),new THREE.Vector3(7,1.8,-2)]),
  friendly: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,6),new THREE.Vector3(-4.3,1.9,5.3),new THREE.Vector3(-2.2,1.8,4.6),new THREE.Vector3(4,1.8,2)]),
  protected: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,4),new THREE.Vector3(-2,1.9,1),new THREE.Vector3(5.1,1.8,-2.7),new THREE.Vector3(10,1.8,-5)]),
  humanitarian: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-6,2,5.5),new THREE.Vector3(-1,1.9,4.2),new THREE.Vector3(3.6,1.8,3.3),new THREE.Vector3(10,1.8,2)]),
  altitude: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2.4,5.5),new THREE.Vector3(-3,3.5,5),new THREE.Vector3(1,5.2,4.6),new THREE.Vector3(7,5.8,3)]),
  weather: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2.2,5),new THREE.Vector3(-3,2.4,3),new THREE.Vector3(2,2.3,1),new THREE.Vector3(8,2,-1)]),
  window: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,5.5),new THREE.Vector3(-3.5,2.1,7),new THREE.Vector3(2.5,2,6.4)]),
  link: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,5.5),new THREE.Vector3(-3.5,2.1,7),new THREE.Vector3(2.5,2,6.4),new THREE.Vector3(7.5,1.9,4)]),
  replay: new THREE.CatmullRomCurve3([new THREE.Vector3(-11,1.8,7),new THREE.Vector3(-7,2,5.5),new THREE.Vector3(-3.5,2.1,7)])
};

const routeMaterial = new THREE.LineDashedMaterial({ color: new THREE.Color(colours.route), dashSize: 0.46, gapSize: 0.24, transparent: true, opacity: 0.95 });
let routeLine;
const showRoute = (curve) => {
  if (routeLine) scene.remove(routeLine);
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(140));
  routeLine = new THREE.Line(geometry, routeMaterial);
  routeLine.computeLineDistances();
  scene.add(routeLine);
};

const scenarios = {
  safe: {
    stop: 1, failRule: null, code: "allowed", outcome: "Monitoring",
    initial: "All reviewed constraints currently pass.",
    denied: "The complete route remained inside its signed operating envelope.",
    output: "LOITER mode permitted in SITL"
  },
  civilian: {
    stop: 0.57, failRule: "civilian", code: "civilian_proximity", outcome: "Denied",
    initial: "The route is approaching an active civilian-protection buffer.",
    denied: "Civilian proximity violates the signed minimum separation. No new movement command is sent.",
    output: "Hold outside civilian buffer"
  },
  friendly: {
    stop: 0.61, failRule: "friendly", code: "friendly_force_proximity", outcome: "Denied",
    initial: "Authenticated friendly presence is inside the planned route corridor.",
    denied: "Friendly-force separation fails. Bounder prevents the blue-on-blue risk from reaching the adapter.",
    output: "Hold outside friendly separation"
  },
  protected: {
    stop: 0.69, failRule: "protected", code: "protected_site", outcome: "Denied",
    initial: "The route is approaching a declared protected-site boundary.",
    denied: "The protected-site rule fails locally. The simulated autopilot receives no new state change.",
    output: "Hold outside protected site"
  },
  humanitarian: {
    stop: 0.66, failRule: "humanitarian", code: "humanitarian_corridor_protected", outcome: "Denied",
    initial: "The route is approaching an active humanitarian movement corridor.",
    denied: "The protected humanitarian corridor is occupied. Bounder denies the route change and preserves separation.",
    output: "Hold outside humanitarian corridor"
  },
  altitude: {
    stop: 0.57, failRule: "operating", code: "altitude_above_maximum", outcome: "Denied",
    initial: "Local altitude is being compared with the signed flight ceiling.",
    denied: "The requested climb exceeds the signed altitude ceiling. The adapter receives no climb authority.",
    output: "Maintain permitted altitude"
  },
  weather: {
    stop: 0.48, failRule: "weather", code: "weather_outside_envelope", outcome: "Denied",
    initial: "Visibility and wind observations are approaching the permitted envelope.",
    denied: "Observed weather is outside the signed operating envelope. Bounder denies the route continuation.",
    output: "Hold for weather recovery"
  },
  window: {
    stop: 0.22, failRule: "operating", code: "operating_window_closed", outcome: "Denied",
    initial: "The requested state change is being checked against its authorized time window.",
    denied: "The operating window is closed. A valid route cannot create authority outside its approved time.",
    output: "Await authorized window"
  },
  link: {
    stop: 0.3, failRule: "link", code: "transport_unavailable", outcome: "Denied",
    initial: "Bounder is monitoring heartbeat and telemetry freshness.",
    denied: "The trusted link is unavailable. New authority is denied while the adapter retains its engineered safe state.",
    output: "No new adapter authority"
  },
  replay: {
    stop: 0, failRule: "authority", code: "policy_replay", outcome: "Denied",
    initial: "The supplied policy sequence was already accepted.",
    denied: "Replay verification fails before route evaluation. No MAVLink state change is attempted.",
    output: "No command sent"
  }
};

let selectedScenario = "safe";
let progress = 0;
let playing = !reduceMotion;
let lastTime = 0;
let deniedTime = 0;

const setRuleState = (failedRule, triggered) => {
  for (const item of root.querySelectorAll(".rule-stack li")) {
    const isTarget = item.dataset.rule === failedRule;
    item.classList.toggle("is-failed", isTarget && triggered);
    item.classList.toggle("is-monitoring", isTarget && !triggered);
    item.querySelector("strong").textContent = isTarget ? (triggered ? "DENY" : "CHECK") : "PASS";
  }
};

const setDecision = (scenario, triggered) => {
  const denied = scenario.failRule && triggered;
  phaseElement.textContent = denied ? "Bounder denied" : "Bounder monitoring";
  statusCode.textContent = denied ? scenario.code : "evaluating";
  outcomeElement.textContent = denied ? scenario.outcome : "Monitoring";
  decisionCode.textContent = denied ? scenario.code : "evaluating";
  reasonElement.textContent = denied ? scenario.denied : scenario.initial;
  adapterOutput.textContent = denied ? scenario.output : "No state change yet";
  setRuleState(scenario.failRule, denied);
};

const selectScenario = (name) => {
  selectedScenario = name;
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
  sun.intensity = name === "window" ? 0.55 : 2.4;
  scene.fog.far = name === "weather" ? 25 : 48;
  showRoute(curves[name]);
  drone.position.copy(curves[name].getPointAt(0));
  bounderEnvelope.material.color.set(colours.signal);
  bounderEnvelope.scale.setScalar(1);
  setDecision(scenarios[name], name === "replay");
  if (name === "replay") adapterOutput.textContent = scenarios[name].output;
};

const update = (delta, elapsed) => {
  const scenario = scenarios[selectedScenario];
  if (playing && progress < scenario.stop) progress = Math.min(scenario.stop, progress + delta * 0.06);
  const point = curves[selectedScenario].getPointAt(progress);
  const nextPoint = curves[selectedScenario].getPointAt(Math.min(progress + 0.008, 1));
  drone.position.copy(point);
  drone.position.y += Math.sin(elapsed * 0.004) * 0.045;
  drone.rotation.y = Math.atan2(nextPoint.x - point.x, nextPoint.z - point.z);
  for (const rotor of rotors) rotor.rotation.z += delta * 12;
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

  const triggered = scenario.failRule && progress >= scenario.stop;
  if (triggered) {
    deniedTime += delta;
    bounderEnvelope.material.color.set(colours.safety);
    bounderEnvelope.scale.setScalar(1 + Math.sin(deniedTime * 7) * 0.13);
    setDecision(scenario, true);
  } else if (!scenario.failRule && progress >= 0.995) {
    phaseElement.textContent = "Route complete";
    statusCode.textContent = scenario.code;
    outcomeElement.textContent = "Allowed";
    decisionCode.textContent = scenario.code;
    reasonElement.textContent = scenario.denied;
    adapterOutput.textContent = scenario.output;
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
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

for (const button of root.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => selectScenario(button.dataset.scenario));
}
playButton.addEventListener("click", () => {
  playing = !playing;
  playButton.textContent = playing ? "Pause simulation" : "Play simulation";
  playButton.setAttribute("aria-pressed", String(!playing));
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) playing = false;
});
new ResizeObserver(resize).observe(stage);
const reportEmbeddedHeight = () => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "bounder-simulator-height", height: document.documentElement.scrollHeight }, window.location.origin);
  }
};
new ResizeObserver(reportEmbeddedHeight).observe(document.body);
selectScenario("safe");
resize();
reportEmbeddedHeight();
requestAnimationFrame(animate);
