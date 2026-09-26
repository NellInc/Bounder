import * as THREE from "three";
import {
  BUILDING_SPECS,
  PROTECTION_BOUNDARIES,
  ROUTE_CURVE,
  ROUTE_WAYPOINTS,
  WORLD_BOUNDS,
  findPolylineBuildingCollisions,
  metres
} from "../simulator-world.js";

// Static repeated props (windows, doors, trees, lamps, road markings) are drawn as one instanced
// mesh per geometry and material, which keeps the draw-call count low on phones.
const createInstanceBatches = (scene) => {
  const batches = new Map();
  const matrix = new THREE.Matrix4();
  const add = (key, geometry, material, transform, colour, { castShadow = false, receiveShadow = false } = {}) => {
    let batch = batches.get(key);
    if (!batch) {
      batch = { geometry, material, matrices: [], colours: [], castShadow, receiveShadow };
      batches.set(key, batch);
    }
    batch.matrices.push(transform.clone());
    batch.colours.push(colour ? new THREE.Color(colour) : null);
  };
  const flush = () => {
    for (const batch of batches.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((transform, index) => {
        mesh.setMatrixAt(index, matrix.copy(transform));
        if (batch.colours[index]) mesh.setColorAt(index, batch.colours[index]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = batch.castShadow;
      mesh.receiveShadow = batch.receiveShadow;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    batches.clear();
  };
  return { add, flush };
};

const composeMatrix = (() => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  return (x, y, z, { rotationX = 0, rotationY = 0, rotationZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1 } = {}) => new THREE.Matrix4().compose(
    position.set(x, y, z),
    quaternion.setFromEuler(euler.set(rotationX, rotationY, rotationZ)),
    scale.set(scaleX, scaleY, scaleZ)
  );
})();

// The route-clearance audit is verification instrumentation. It runs only when a test or a
// reviewer asks for it explicitly with ?audit=1, so ordinary visits never pay for it.
const sceneAuditRequested = () => {
  try {
    return new URLSearchParams(window.location.search).get("audit") === "1";
  } catch {
    return false;
  }
};

// Illustrative geometry only. Recorded evidence, never geometry, owns the outcome.
export const createTownScene = ({ scene, colours, stage }) => {
  const instances = createInstanceBatches(scene);
  const hemisphere = new THREE.HemisphereLight(0xe9f7ff, 0x5b6749, 2.15);
  scene.add(hemisphere);
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

  // The countryside disc runs far past the fog's far distance, so no camera pose can see its edge.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(160, 64),
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

  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const laneMaterial = new THREE.MeshBasicMaterial({ color: "#e9dfbb", transparent: true, opacity: 0.78 });
  const addLaneDash = (width, depth, x, z) => {
    instances.add("lane", unitPlane, laneMaterial, composeMatrix(x, 0.075, z, { rotationX: -Math.PI / 2, scaleX: width, scaleY: depth }));
  };
  for (let x = -15; x <= 15; x += 2.25) {
    addLaneDash(1.08, 0.065, x, 3.6);
    addLaneDash(1.08, 0.065, x, -4.2);
  }
  for (let z = -11; z <= 11; z += 2.25) addLaneDash(0.065, 1.08, 3.6, z);

  const crosswalkMaterial = new THREE.MeshBasicMaterial({ color: "#f3eee0", transparent: true, opacity: 0.78 });
  const addStripe = (width, depth, x, z) => {
    instances.add("crosswalk", unitPlane, crosswalkMaterial, composeMatrix(x, 0.079, z, { rotationX: -Math.PI / 2, scaleX: width, scaleY: depth }), null, { receiveShadow: true });
  };
  for (let stripe = -1.05; stripe <= 1.05; stripe += 0.35) {
    addStripe(0.18, 2.55, 1.25 + stripe, 3.6);
    addStripe(2.55, 0.18, 3.6, -1.45 + stripe);
  }

  plane(6.8, 4.7, -2.0, -0.3, new THREE.MeshStandardMaterial({ color: "#8cac70", roughness: 1 }), 0.015);
  plane(4.5, 2.2, -1.0, 3.6, pavingMaterial, 0.078);

  const windowMaterial = new THREE.MeshStandardMaterial({ color: "#9dc7cf", emissive: "#49747e", emissiveIntensity: 0.18, metalness: 0.05, roughness: 0.28 });
  const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: "#f0e9dc", roughness: 0.75 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: "#5a4135", roughness: 0.8 });
  const foliageMaterials = ["#517d4b", "#668f55", "#789b5f"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92 }));
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#6b4b35", roughness: 1 });
  const flowerMaterial = new THREE.MeshStandardMaterial({ color: "#f4c554", roughness: 0.8 });

  // Building panes have their own material so the dusk grade can light them without also
  // lighting vehicle and drone glazing.
  const buildingWindowMaterial = windowMaterial.clone();
  const windowFrameGeometry = new THREE.BoxGeometry(0.54 * 0.9, 0.62, 0.075);
  const windowPaneGeometry = new THREE.BoxGeometry(0.42 * 0.9, 0.5, 0.085);
  const doorGeometry = new THREE.BoxGeometry(0.55, 0.9, 0.09);
  const awningGeometry = new THREE.BoxGeometry(0.9, 0.08, 0.42);
  const awningMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.78 });
  const WINDOW_HALF_WIDTH = (0.54 * 0.9) / 2;
  const AWNING_HALF_WIDTH = 0.9 / 2;
  const toWorld = (groupMatrix, x, y, z, options) => groupMatrix.clone().multiply(composeMatrix(x, y, z, options));
  const addWindow = (groupMatrix, x, y, z) => {
    instances.add("window-frame", windowFrameGeometry, windowFrameMaterial, toWorld(groupMatrix, x, y, z));
    instances.add("window-pane", windowPaneGeometry, buildingWindowMaterial, toWorld(groupMatrix, x, y, z + 0.006));
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
    // Facades, doors and awnings are modelled on local +z; buildings that front a street to their
    // north are turned half a revolution.
    group.position.set(spec.x, 0, spec.z);
    group.rotation.y = spec.facing === -1 ? Math.PI : 0;
    group.updateMatrix();
    const groupMatrix = group.matrix.clone();

    const doorX = index % 2 ? -spec.width * 0.24 : spec.width * 0.24;
    const storeys = Math.max(1, Math.floor(spec.height / 1.25));
    const columns = spec.width > 2.8 ? 3 : 2;
    for (let floor = 0; floor < storeys; floor += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = ((column + 1) / (columns + 1) - 0.5) * spec.width;
        // Leave the ground-floor bay beside the door clear for the door and its awning.
        if (floor === 0 && Math.abs(x - doorX) < AWNING_HALF_WIDTH + WINDOW_HALF_WIDTH + 0.02) continue;
        addWindow(groupMatrix, x, 0.85 + floor * 1.12, spec.depth / 2 + 0.045);
      }
    }
    instances.add("door", doorGeometry, doorMaterial, toWorld(groupMatrix, doorX, 0.57, spec.depth / 2 + 0.06));
    instances.add("awning", awningGeometry, awningMaterial, toWorld(groupMatrix, doorX, 1.08, spec.depth / 2 + 0.24, { rotationX: -0.18 }), spec.roof);
    if (spec.hasChimney) {
      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.75, 0.3), doorMaterial);
      chimney.position.set(spec.width * 0.25, spec.height + 0.55, 0);
      chimney.castShadow = true;
      group.add(chimney);
    }
    if (spec.protected) {
      // A white cross on a green plate reads as a first-aid clinic without using the protected
      // Red Cross emblem, and stays legible against the pale wall.
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.9, 0.06),
        new THREE.MeshStandardMaterial({ color: "#0b7a44", roughness: 0.6 })
      );
      plate.position.set(0, spec.height * 0.72, spec.depth / 2 + 0.035);
      const crossMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.18 });
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.05), crossMaterial);
      const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.05), crossMaterial);
      vertical.position.set(0, spec.height * 0.72, spec.depth / 2 + 0.08);
      horizontal.position.copy(vertical.position);
      group.add(plate, vertical, horizontal);
    }
    scene.add(group);
    return group;
  };
  const townBuildings = BUILDING_SPECS.map(addBuilding);

  const trunkGeometry = new THREE.CylinderGeometry(0.09, 0.14, 0.82, 9);
  const canopyGeometry = new THREE.IcosahedronGeometry(1, 2);
  const addTree = (x, z, scale = 1, variant = 0) => {
    instances.add("trunk", trunkGeometry, trunkMaterial, composeMatrix(x, 0.41 * scale, z, { scaleX: scale, scaleY: scale, scaleZ: scale }), null, { castShadow: true });
    const material = foliageMaterials[variant % foliageMaterials.length];
    for (const [offsetX, offsetY, offsetZ, size] of [[0, 1.12, 0, 0.54], [-0.28, 1.05, 0.04, 0.38], [0.25, 1.03, 0.1, 0.4], [0.05, 1.28, -0.1, 0.38]]) {
      const radius = size * scale;
      instances.add(`canopy-${variant % foliageMaterials.length}`, canopyGeometry, material, composeMatrix(x + offsetX * scale, offsetY * scale, z + offsetZ * scale, { scaleX: radius, scaleY: radius, scaleZ: radius }), null, { castShadow: true, receiveShadow: true });
    }
  };

  [
    [-4.6, -1.5, 1.05], [-3.0, -1.5, 0.9], [-1.2, -1.3, 1.08], [0.4, -0.8, 0.86],
    [-4.7, 0.9, 0.92], [-2.8, 1.0, 1.12], [-0.7, 0.9, 0.88],
    [-14.5, 0.1, 0.92], [-14.2, 7.1, 1.0], [14.6, 0.2, 1.1], [14.7, 7.0, 0.9],
    [6.2, -1.4, 0.82], [6.0, 0.9, 0.95], [11.1, 1.0, 0.85]
  ].forEach(([x, z, scale], index) => addTree(x, z, scale, index));

  const lampMetal = new THREE.MeshStandardMaterial({ color: "#343b3a", metalness: 0.55, roughness: 0.48 });
  const lampGlow = new THREE.MeshStandardMaterial({ color: "#fff0b7", emissive: "#ffd978", emissiveIntensity: 1.1 });
  const lampPostGeometry = new THREE.CylinderGeometry(0.035, 0.055, 1.65, 9);
  const lampCapGeometry = new THREE.SphereGeometry(0.12, 12, 8);
  const addLamp = (x, z) => {
    instances.add("lamp-post", lampPostGeometry, lampMetal, composeMatrix(x, 0.825, z));
    instances.add("lamp-cap", lampCapGeometry, lampGlow, composeMatrix(x, 1.68, z));
  };
  for (const x of [-13, -9, -5, -1, 7, 11, 15]) {
    addLamp(x, 5.35);
    addLamp(x, -2.62);
  }

  const timber = new THREE.MeshStandardMaterial({ color: "#8c5e3e", roughness: 0.88 });
  const addBench = (x, z, rotation = 0) => {
    // A 1.8 m park bench with a 0.45 m seat, at the shared metres-per-unit scale.
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(metres(1.8), metres(0.1), metres(0.45)), timber);
    seat.position.y = metres(0.45);
    const back = new THREE.Mesh(new THREE.BoxGeometry(metres(1.8), metres(0.4), metres(0.08)), timber);
    back.position.set(0, metres(0.7), -metres(0.2));
    for (const legX of [-metres(0.7), metres(0.7)]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(metres(0.08), metres(0.45), metres(0.4)), lampMetal);
      leg.position.set(legX, metres(0.225), 0);
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

  const addWheels = (group, radius, width, positions) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, width, 16);
    for (const [wheelX, wheelZ] of positions) {
      const wheel = new THREE.Mesh(geometry, lampMetal);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wheelX, radius, wheelZ);
      group.add(wheel);
    }
  };

  const addCar = (x, z, colour, rotation = 0) => {
    // A 4.4 m saloon, 1.8 m wide and about 1.5 m tall.
    const car = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: colour, metalness: 0.16, roughness: 0.52 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(metres(4.4), metres(0.75), metres(1.8)), bodyMaterial);
    body.position.y = metres(0.3 + 0.375);
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(metres(2.4), metres(0.5), metres(1.6)), windowMaterial);
    cabin.position.set(-metres(0.2), metres(1.05 + 0.25), 0);
    car.add(body, cabin);
    const axle = metres(1.35);
    const track = metres(0.8);
    addWheels(car, metres(0.33), metres(0.22), [[-axle, -track], [-axle, track], [axle, -track], [axle, track]]);
    car.position.set(x, 0.07, z);
    car.rotation.y = rotation;
    scene.add(car);
  };
  addCar(-9.4, 2.7, "#b65645");
  addCar(12.6, 4.5, "#d2a73e", Math.PI);
  addCar(4.45, -7.6, "#557d8e", Math.PI / 2);

  const flowerGeometry = new THREE.SphereGeometry(0.09, 8, 6);
  for (const [x, z] of [[-4.2, 1.65], [-3.6, 1.62], [-3.0, 1.66], [-2.4, 1.63], [-1.8, 1.66]]) {
    instances.add("flower", flowerGeometry, flowerMaterial, composeMatrix(x, 0.2, z));
  }

  // Low rounded hills sit well beyond the town, so they frame the overview's horizon but stay
  // outside every close scenario view.
  const hillMaterial = new THREE.MeshStandardMaterial({ color: "#7a9068", roughness: 1 });
  const hillGeometry = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [x, z, width, height, depth] of [[-31, -15, 9, 3.2, 7], [-30, 12, 8, 2.6, 6.5], [31, -13, 10, 3.6, 7.5], [30, 14, 8.5, 2.8, 6.5], [-6, -33, 12, 3.0, 6], [12, -31, 9, 2.4, 5.5]]) {
    const hill = new THREE.Mesh(hillGeometry, hillMaterial);
    hill.scale.set(width, height, depth);
    hill.position.set(x, -0.12, z);
    hill.receiveShadow = true;
    scene.add(hill);
  }

  const ambientClouds = new THREE.Group();
  const fairCloudMaterial = new THREE.MeshStandardMaterial({ color: "#f7fbfa", transparent: true, opacity: 0.88, roughness: 1 });
  // Fair-weather clouds hang over the far horizon: visible along the top of the overview, never
  // between a close scenario camera and the town.
  for (const [x, y, z, scale] of [[-24, 8.8, -9, 1.6], [-9, 9.2, -27, 2.0], [7, 8.6, -30, 1.7], [22, 9.0, -24, 1.5]]) {
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
    // Drawn only for the scenario that selects it; no boundary shows before a receipt loads.
    group.visible = false;
    scene.add(group);
    return group;
  };

  const boundaryPosition = (name) => new THREE.Vector3(PROTECTION_BOUNDARIES[name].x, 0, PROTECTION_BOUNDARIES[name].z);
  const civilianPosition = boundaryPosition("civilian");
  const friendlyPosition = boundaryPosition("friendly");
  const humanitarianPosition = boundaryPosition("humanitarian");
  const civilianBoundary = makeBoundary(civilianPosition, PROTECTION_BOUNDARIES.civilian.radius, colours.civilian);
  const friendlyBoundary = makeBoundary(friendlyPosition, PROTECTION_BOUNDARIES.friendly.radius, colours.friendly);
  const protectedBoundary = makeBoundary(boundaryPosition("protected"), PROTECTION_BOUNDARIES.protected.radius, colours.protected);
  const humanitarianBoundary = makeBoundary(humanitarianPosition, PROTECTION_BOUNDARIES.humanitarian.radius, colours.humanitarian);

  // People are about 1.75 m tall at the shared scale, so vehicles and doors read correctly
  // beside them.
  const clothingMaterials = ["#d48a2f", "#5b7f9d", "#9a5b53", "#6c8659", "#6f607f"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.82 }));
  const skinMaterials = ["#f0c9a2", "#c98964", "#8e5f45"].map((colour) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 }));
  const personBodyGeometry = new THREE.CapsuleGeometry(metres(0.24), metres(0.95), 4, 8);
  const personHeadGeometry = new THREE.SphereGeometry(metres(0.13), 12, 8);
  for (const [index, [x, z]] of [[-2.7,3.2],[-2.1,4.0],[-1.5,3.25],[-2.6,4.15],[-1.55,4.05]].entries()) {
    const person = new THREE.Group();
    const body = new THREE.Mesh(personBodyGeometry, clothingMaterials[index % clothingMaterials.length]);
    body.position.y = metres(0.715);
    const head = new THREE.Mesh(personHeadGeometry, skinMaterials[index % skinMaterials.length]);
    head.position.y = metres(1.56);
    body.castShadow = true;
    head.castShadow = true;
    person.add(body, head);
    person.position.set(x, 0, z);
    person.rotation.y = index * 0.9;
    scene.add(person);
  }

  // A 4.8 m utility vehicle marks the authenticated friendly team.
  const friendlyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.friendly), emissive: new THREE.Color(colours.friendly), emissiveIntensity: 0.12 });
  const friendlyUnit = new THREE.Group();
  const friendlyBase = new THREE.Mesh(new THREE.BoxGeometry(metres(4.8), metres(1.0), metres(2.1)), friendlyMaterial);
  friendlyBase.position.y = metres(0.35 + 0.5);
  friendlyBase.castShadow = true;
  const friendlyCab = new THREE.Mesh(new THREE.BoxGeometry(metres(2.2), metres(0.75), metres(1.9)), windowMaterial);
  friendlyCab.position.set(metres(0.6), metres(1.35 + 0.375), 0);
  friendlyUnit.add(friendlyBase, friendlyCab);
  addWheels(friendlyUnit, metres(0.42), metres(0.3), [[-metres(1.5), -metres(0.95)], [-metres(1.5), metres(0.95)], [metres(1.5), -metres(0.95)], [metres(1.5), metres(0.95)]]);
  friendlyUnit.position.copy(friendlyPosition);
  scene.add(friendlyUnit);

  // Two 5.7 m relief lorries (cab plus cargo box) inside the humanitarian corridor.
  const humanitarianMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(colours.humanitarian), emissive: new THREE.Color(colours.humanitarian), emissiveIntensity: 0.1 });
  const cargoMaterial = new THREE.MeshStandardMaterial({ color: "#eef1ec", roughness: 0.8 });
  const humanitarianConvoy = new THREE.Group();
  for (const offset of [-1.2, 1.2]) {
    const vehicle = new THREE.Group();
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(metres(4.0), metres(2.2), metres(2.3)), cargoMaterial);
    cargo.position.set(-metres(0.85), metres(0.55 + 1.1), 0);
    cargo.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(metres(1.6), metres(1.8), metres(2.2)), humanitarianMaterial);
    cab.position.set(metres(2.0), metres(0.55 + 0.9), 0);
    cab.castShadow = true;
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(metres(0.1), metres(0.7), metres(1.9)), windowMaterial);
    windscreen.position.set(metres(2.8), metres(1.85), 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(metres(4.02), metres(0.35), metres(2.32)), humanitarianMaterial);
    stripe.position.set(-metres(0.85), metres(1.65), 0);
    vehicle.add(cargo, cab, windscreen, stripe);
    addWheels(vehicle, metres(0.45), metres(0.3), [[-metres(1.9), -metres(1.0)], [-metres(1.9), metres(1.0)], [metres(1.9), -metres(1.0)], [metres(1.9), metres(1.0)]]);
    vehicle.position.x = offset;
    humanitarianConvoy.add(vehicle);
  }
  humanitarianConvoy.position.copy(humanitarianPosition);
  scene.add(humanitarianConvoy);

  // Marker labels are drawn at a constant on-screen size (sizeAttenuation off); the controller
  // sets their scale from the stage height so the text stays legible at every width.
  const worldLabels = [];
  const LABEL_TEXTURE_HEIGHT = 96;
  const labelFont = () => {
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
    return `600 50px ${family}`;
  };
  const drawWorldLabel = (sprite) => {
    const { text, colour, canvas: labelCanvas } = sprite.userData.label;
    const context = labelCanvas.getContext("2d");
    context.font = labelFont();
    const padding = 34;
    const width = Math.ceil(context.measureText(text).width + padding * 2);
    labelCanvas.width = width;
    labelCanvas.height = LABEL_TEXTURE_HEIGHT;
    context.font = labelFont();
    context.fillStyle = "rgba(17, 19, 15, 0.9)";
    context.beginPath();
    context.roundRect(3, 3, width - 6, LABEL_TEXTURE_HEIGHT - 6, 18);
    context.fill();
    context.strokeStyle = colour;
    context.lineWidth = 6;
    context.stroke();
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, LABEL_TEXTURE_HEIGHT / 2 + 2);
    sprite.userData.aspect = width / LABEL_TEXTURE_HEIGHT;
    if (sprite.material.map) sprite.material.map.dispose();
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
  };
  const makeWorldLabel = (text, colour) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, sizeAttenuation: false }));
    sprite.userData.label = { text, colour, canvas: document.createElement("canvas") };
    sprite.position.y = 2.1;
    sprite.renderOrder = 10;
    drawWorldLabel(sprite);
    worldLabels.push(sprite);
    return sprite;
  };
  const redrawWorldLabels = () => worldLabels.forEach(drawWorldLabel);

  const makeROEMarker = (position, label, colour) => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.18, roughness: 0.55 });
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), material);
    beacon.position.y = 0.85;
    beacon.castShadow = true;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.72, 12), lampMetal);
    stem.position.y = 0.38;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.82, 48),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    group.add(beacon, stem, ring, makeWorldLabel(label, colour));
    group.position.copy(position);
    group.visible = false;
    scene.add(group);
    return group;
  };

  const roeColours = Object.freeze({
    surrender: "#f2c14e",
    incapacitated: "#e88762",
    identification: "#d5a021",
    proportionality: "#c983b9",
    human_authorization: "#6fa8dc"
  });
  const roeMarkers = Object.freeze({
    surrender: makeROEMarker(new THREE.Vector3(-1.2, 0, -4.2), "Surrender signalled", roeColours.surrender),
    incapacitated: makeROEMarker(new THREE.Vector3(3.6, 0, -1.2), "Incapacitated person", roeColours.incapacitated),
    identification: makeROEMarker(new THREE.Vector3(3.6, 0, 3.6), "Identity unconfirmed", roeColours.identification),
    proportionality: makeROEMarker(new THREE.Vector3(0, 0, 3.6), "Consequence check unresolved", roeColours.proportionality),
    human_authorization: makeROEMarker(new THREE.Vector3(-3.6, 0, 3.6), "Human authorisation absent", roeColours.human_authorization)
  });

  const altitudeCeiling = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colours.safety), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  altitudeCeiling.rotation.x = -Math.PI / 2;
  altitudeCeiling.position.y = 7;
  altitudeCeiling.visible = false;
  scene.add(altitudeCeiling);

  // The weather receipt records wind above the signed maximum with 8 km visibility, so the scene
  // shows wind (fast high cloud, streaks and a stretched windsock) rather than fog or rain.
  // Wind blows toward -x, a headwind on the weather route.
  const weatherGroup = new THREE.Group();
  const weatherClouds = new THREE.Group();
  const stormCloudMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#9ea8aa"), transparent: true, opacity: 0.82, roughness: 1 });
  const stormPuffGeometry = new THREE.IcosahedronGeometry(1, 2);
  for (const [x, y, z, scale] of [[-9, 9.6, -3, 1.6], [-1, 10.2, -6, 2.0], [6, 9.2, -2, 1.5], [13, 9.8, -8, 1.8], [-16, 10.4, -9, 1.7]]) {
    const cloud = new THREE.Group();
    for (const [offsetX, offsetY, size] of [[-0.8, 0, 0.7], [0, 0.18, 1], [0.85, -0.04, 0.72]]) {
      const puff = new THREE.Mesh(stormPuffGeometry, stormCloudMaterial);
      puff.scale.set(size * scale * 1.25, size * scale * 0.5, size * scale);
      puff.position.set(offsetX * scale, offsetY * scale, 0);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    weatherClouds.add(cloud);
  }
  weatherGroup.add(weatherClouds);

  const WIND_SPAN = { minX: -14, maxX: 8 };
  const windPositions = [];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let index = 0; index < 70; index += 1) {
    const x = WIND_SPAN.minX + random() * (WIND_SPAN.maxX - WIND_SPAN.minX);
    const y = 1.2 + random() * 7;
    const z = -1 + random() * 8;
    const length = 0.7 + random() * 1.1;
    windPositions.push(x, y, z, x + length, y + 0.04, z);
  }
  const windGeometry = new THREE.BufferGeometry();
  windGeometry.setAttribute("position", new THREE.Float32BufferAttribute(windPositions, 3));
  const windStreaks = new THREE.LineSegments(windGeometry, new THREE.LineBasicMaterial({ color: 0xf4f8f6, transparent: true, opacity: 0.55, depthWrite: false }));
  windStreaks.userData.span = WIND_SPAN;
  weatherGroup.add(windStreaks);

  const windsock = new THREE.Group();
  const windsockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 2.1, 9), lampMetal);
  windsockPole.position.y = 1.05;
  const windsockMaterial = new THREE.MeshStandardMaterial({ color: "#e0662c", roughness: 0.7, side: THREE.DoubleSide });
  const windsockBand = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.7, side: THREE.DoubleSide });
  const sock = new THREE.Group();
  const sockSegments = [[0.19, 0.16, windsockMaterial], [0.16, 0.13, windsockBand], [0.13, 0.1, windsockMaterial], [0.1, 0.07, windsockBand]];
  sockSegments.forEach(([radiusTop, radiusBottom, material], index) => {
    const segment = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, 0.26, 14, 1, true), material);
    segment.position.y = -0.13 - index * 0.26;
    sock.add(segment);
  });
  // Fully stretched downwind (toward -x) with a slight droop: the wind is well above the limit.
  // The segments hang along local -y, so a negative quarter turn about z points the tail at -x.
  sock.rotation.z = -(Math.PI / 2 - 0.08);
  sock.position.set(0, 2.02, 0);
  windsock.add(windsockPole, sock);
  // On the pavement beside the weather hold, inside that scenario's framing.
  windsock.position.set(-2.2, 0, 5.45);
  windsock.scale.setScalar(1.35);
  weatherGroup.add(windsock);
  weatherGroup.visible = false;
  scene.add(weatherGroup);

  const drone = new THREE.Group();
  const droneBodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#e7ebe4"), roughness: 0.42, metalness: 0.2 });
  const rotorGuardMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#4b534f"), roughness: 0.5, metalness: 0.3 });
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color("#262b28"), roughness: 0.45 });
  const rotorDiscMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#262b28"), transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  const droneBody = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.22, 0.46), droneBodyMaterial);
  droneBody.castShadow = true;
  drone.add(droneBody);
  // The camera pod and canopy sit toward local +x: the model flies nose first along +x.
  const droneCanopy = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.36, 6, 12), windowMaterial);
  droneCanopy.rotation.z = Math.PI / 2;
  droneCanopy.position.set(0.08, 0.13, 0);
  const droneCamera = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), lampMetal);
  droneCamera.position.set(0.3, -0.2, 0);
  drone.add(droneCanopy, droneCamera);
  const rotors = [];
  const guardGeometry = new THREE.TorusGeometry(0.3, 0.018, 8, 36);
  const bladeGeometry = new THREE.BoxGeometry(0.54, 0.014, 0.065);
  const hubGeometry = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12);
  const discGeometry = new THREE.CircleGeometry(0.27, 32);
  for (const [x, z] of [[-0.58,-0.48],[0.58,-0.48],[-0.58,0.48],[0.58,0.48]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.065, 0.065), droneBodyMaterial);
    arm.position.set(x * 0.48, 0, z * 0.48);
    arm.rotation.y = x * z > 0 ? -0.69 : 0.69;
    drone.add(arm);
    const guard = new THREE.Mesh(guardGeometry, rotorGuardMaterial);
    guard.rotation.x = Math.PI / 2;
    guard.position.set(x, 0.09, z);
    drone.add(guard);
    // Two-blade propeller that spins about its vertical axis, over a faint disc that reads as
    // blade blur.
    const propeller = new THREE.Group();
    propeller.userData.propeller = true;
    propeller.position.set(x, 0.1, z);
    propeller.rotation.y = (x + z) * 2;
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade.rotation.x = 0.12;
    const hub = new THREE.Mesh(hubGeometry, bladeMaterial);
    const disc = new THREE.Mesh(discGeometry, rotorDiscMaterial);
    disc.rotation.x = -Math.PI / 2;
    propeller.add(blade, hub, disc);
    drone.add(propeller);
    rotors.push(propeller);
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
  bounderEnvelope.userData.envelope = true;
  drone.add(bounderEnvelope);

  // A plumb line and ground mark under the lead drone make its height and position legible, so a
  // drone flying above a street never reads as sitting on a roof behind it.
  const tetherMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#1b1f1a"), transparent: true, opacity: 0.45, depthWrite: false });
  const droneTether = new THREE.Group();
  const tetherLine = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6, 1, true), tetherMaterial);
  tetherLine.position.y = 0.5;
  const tetherMark = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.2, 24), tetherMaterial);
  tetherMark.rotation.x = -Math.PI / 2;
  droneTether.add(tetherLine, tetherMark);
  droneTether.userData.line = tetherLine;
  // Hidden until the first recorded receipt places the drone.
  droneTether.visible = false;
  scene.add(droneTether);

  // Fleet Guardians are illustrative companions. No recorded receipt maps to these meshes, so their
  // envelopes use their own neutral material and never take the lead drone's hold colour.
  // Their bodies take a cooler grey of their own so the lead drone, whose receipt is shown, stays
  // distinct.
  const guardianEnvelopeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color("#dfe6dc"), transparent: true, opacity: 0.55 });
  const guardianBodyMaterial = droneBodyMaterial.clone();
  guardianBodyMaterial.color.set("#c3ccc6");
  const fleetDrones = Array.from({ length: 6 }, (_, index) => {
    const guardian = drone.clone(true);
    guardian.scale.setScalar(0.82);
    guardian.visible = false;
    guardian.userData.guardianIndex = index + 2;
    guardian.traverse((part) => {
      if (part.userData.envelope) part.material = guardianEnvelopeMaterial;
      else if (part.material === droneBodyMaterial) part.material = guardianBodyMaterial;
      if (part.userData.propeller) rotors.push(part);
    });
    scene.add(guardian);
    return guardian;
  });

  const curves = Object.fromEntries(Object.entries(ROUTE_WAYPOINTS).map(([name, waypoints]) => [
    name,
    new THREE.CatmullRomCurve3(waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, ROUTE_CURVE.curveType, ROUTE_CURVE.tension)
  ]));

  stage.dataset.buildingCount = String(BUILDING_SPECS.length);
  if (sceneAuditRequested()) {
    const routeClearanceAudit = Object.fromEntries(Object.entries(curves).map(([name, curve]) => [
      name,
      findPolylineBuildingCollisions(curve.getPoints(500).map(({ x, y, z }) => [x, y, z]), 0.45)
    ]));
    const routesClear = Object.values(routeClearanceAudit).every((collisions) => collisions.length === 0);
    window.__bounderSceneAudit = {
      buildingCount: BUILDING_SPECS.length,
      buildingBounds: BUILDING_SPECS.map(({ name, visibleBounds }) => ({ name, ...visibleBounds })),
      routeClearance: routeClearanceAudit,
      routesClear
    };
    stage.dataset.routesClear = String(routesClear);
    stage.dataset.routeClearance = JSON.stringify(routeClearanceAudit);
    if (!routesClear) console.error("Bounder route clearance invariant failed", routeClearanceAudit);
  }

  instances.flush();

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


  return {
    sun,
    hemisphere,
    lampGlow,
    buildingWindowMaterial,
    fairCloudMaterial,
    civilianBoundary,
    friendlyBoundary,
    protectedBoundary,
    humanitarianBoundary,
    roeMarkers,
    roeColours,
    worldLabels,
    redrawWorldLabels,
    altitudeCeiling,
    weatherGroup,
    weatherClouds,
    windStreaks,
    ambientClouds,
    curves,
    drone,
    droneTether,
    bounderEnvelope,
    fleetDrones,
    rotors,
    showRoute
  };
};
