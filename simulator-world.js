const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
};

export const WORLD_BOUNDS = deepFreeze({ width: 34, depth: 26 });
export const MAX_POLYLINE_WAYPOINTS = 4096;

// One scene unit is about 2.7 metres: a storey is 1.12 units and a door 0.9 units, so people,
// vehicles and street furniture are sized from this constant rather than by eye.
export const METRES_PER_UNIT = 2.7;
export const metres = (value) => value / METRES_PER_UNIT;

// Illustrative protection boundaries drawn around the relevant scenario subjects. Their
// geometry only places the held drone; the recorded receipt owns the outcome.
export const PROTECTION_BOUNDARIES = deepFreeze({
  civilian: { x: -2.0, z: 3.6, radius: 2.65 },
  friendly: { x: -6.6, z: -4.2, radius: 2.35 },
  protected: { x: 8.9, z: -0.2, radius: 2.8 },
  humanitarian: { x: 8.3, z: 3.6, radius: 2.5 }
});

// Every boundary receipt says the vehicle holds outside the boundary, so the drawn hold point
// keeps at least this horizontal margin from the boundary wall.
export const HOLD_CLEARANCE = 0.3;

// Route curves are centripetal Catmull-Rom splines through ROUTE_WAYPOINTS.
export const ROUTE_CURVE = deepFreeze({ curveType: "centripetal", tension: 0.35 });

// Fraction of each route's arc length at which the drone is drawn when the recorded decision
// applies. Boundary stops are the largest fraction that keeps HOLD_CLEARANCE outside the wall.
export const ROUTE_STOPS = deepFreeze({
  safe: 1,
  civilian: 0.94,
  friendly: 0.86,
  protected: 0.94,
  humanitarian: 0.94,
  surrender: 0.94,
  incapacitated: 0.94,
  identification: 0.94,
  proportionality: 0.94,
  human_authorization: 0.94,
  altitude: 0.57,
  weather: 0.48,
  window: 0.22,
  link: 0.3,
  replay: 0
});

const RAW_BUILDING_SPECS = [
  { x: -11.5, z: -6.7, width: 3.0, depth: 2.7, height: 3.8, colour: "#d7b98d", roof: "#a95f43", name: "Bakery" },
  { x: -7.6, z: -6.6, width: 2.6, depth: 2.8, height: 2.9, colour: "#b9c9b0", roof: "#6f7d67", name: "Townhouse" },
  { x: -3.7, z: -6.6, width: 3.1, depth: 2.8, height: 4.4, colour: "#d2c3ad", roof: "#735f53", name: "Library" },
  { x: 8.0, z: -6.7, width: 3.2, depth: 2.7, height: 3.5, colour: "#c7b1a0", roof: "#805e57", name: "Workshop" },
  { x: 12.2, z: -6.4, width: 2.6, depth: 3.1, height: 4.6, colour: "#aebbc0", roof: "#5f6f75", name: "Civic offices" },
  { x: -11.4, z: -0.3, width: 2.9, depth: 2.9, height: 3.2, colour: "#e0c49d", roof: "#a65b3f", name: "Cafe" },
  { x: -7.2, z: -0.4, width: 3.1, depth: 2.7, height: 4.1, colour: "#b8c4ca", roof: "#66777e", name: "Apartments" },
  { x: 8.9, z: -0.2, width: 2.8, depth: 2.8, height: 2.4, colour: "#e4e8e0", roof: "#b83d26", name: "Protected clinic", protected: true },
  { x: 12.5, z: -0.4, width: 2.5, depth: 3.0, height: 3.7, colour: "#d4b7a4", roof: "#875f4d", name: "Residences" },
  { x: -11.8, z: 7.2, width: 2.7, depth: 2.5, height: 3.6, colour: "#c6b9a7", roof: "#78685d", name: "Corner shop" },
  { x: -8.1, z: 7.3, width: 2.5, depth: 2.5, height: 2.7, colour: "#d7c69d", roof: "#9b6b46", name: "Terrace" },
  { x: -4.5, z: 7.2, width: 2.9, depth: 2.6, height: 4.0, colour: "#b7c6b2", roof: "#61755c", name: "Hotel" },
  { x: 7.6, z: 7.2, width: 3.1, depth: 2.7, height: 3.8, colour: "#d6bdaa", roof: "#945d4c", name: "School" },
  { x: 11.8, z: 7.1, width: 2.6, depth: 2.7, height: 3.0, colour: "#b6c5ca", roof: "#64767b", name: "Community hall" }
];

const FOUNDATION_OVERHANG = 0.55 / 2;
const ROOF_OVERHANG = 0.18;
const ROOF_TOP_OFFSET = 0.12 + 0.72;
const AWNING_FRONT_OVERHANG = 0.24 + Math.cos(0.18) * (0.42 / 2) + Math.sin(0.18) * (0.08 / 2);
const AWNING_HALF_WIDTH = 0.9 / 2;
const CHIMNEY_TOP_OFFSET = 0.55 + 0.75 / 2;

// Buildings front the nearest street. The southern row (z > 5) faces north toward the road
// at z = 3.6; every other row faces south (+z).
export const BUILDING_SPECS = deepFreeze(RAW_BUILDING_SPECS.map((spec, index) => {
  const hasChimney = index % 3 === 0;
  const facing = spec.z > 5 ? -1 : 1;
  const halfVisibleWidth = Math.max(
    spec.width / 2 + FOUNDATION_OVERHANG,
    spec.width / 2 + ROOF_OVERHANG,
    spec.width * 0.24 + AWNING_HALF_WIDTH
  );
  const rearVisibleDepth = spec.depth / 2 + Math.max(FOUNDATION_OVERHANG, ROOF_OVERHANG);
  const frontVisibleDepth = spec.depth / 2 + Math.max(FOUNDATION_OVERHANG, ROOF_OVERHANG, AWNING_FRONT_OVERHANG);
  return {
    ...spec,
    hasChimney,
    facing,
    visibleBounds: {
      minX: spec.x - halfVisibleWidth,
      maxX: spec.x + halfVisibleWidth,
      minY: 0,
      maxY: spec.height + (hasChimney ? CHIMNEY_TOP_OFFSET : ROOF_TOP_OFFSET),
      minZ: spec.z - (facing === 1 ? rearVisibleDepth : frontVisibleDepth),
      maxZ: spec.z + (facing === 1 ? frontVisibleDepth : rearVisibleDepth)
    }
  };
}));

const LOW_ALTITUDE_ROUTE_WAYPOINTS = deepFreeze({
  safe: [[-14, 3.45, -4.2], [-10, 3.55, -4.2], [-4, 3.45, -4.2], [1.2, 3.55, -4.2], [3.6, 3.6, -2.3], [3.6, 3.5, 1.2], [5.8, 3.55, 3.6], [12.8, 3.45, 3.6]],
  civilian: [[-14, 3.35, -4.2], [-7, 3.5, -4.2], [0.5, 3.45, -4.2], [3.6, 3.5, -2.1], [3.6, 3.4, 1.4], [1.4, 3.35, 3.6], [0.0, 3.3, 3.6]],
  friendly: [[-14, 3.4, -4.2], [-12, 3.45, -4.2], [-10.4, 3.4, -4.2], [-8.5, 3.35, -4.2]],
  protected: [[-14, 3.45, 3.6], [-8, 3.5, 3.6], [-1, 3.45, 3.6], [3.6, 3.5, 2.0], [3.6, 3.45, -0.2], [6.8, 3.4, -0.2]],
  humanitarian: [[-14, 3.45, 3.6], [-8, 3.55, 3.6], [-2, 3.45, 3.6], [2.5, 3.5, 3.6], [6.2, 3.4, 3.6]],
  surrender: [[-14, 3.45, -4.2], [-9, 3.5, -4.2], [-4, 3.45, -4.2], [-1.2, 3.4, -4.2]],
  incapacitated: [[-14, 3.45, -4.2], [-8, 3.5, -4.2], [-2, 3.45, -4.2], [3.6, 3.4, -1.2]],
  identification: [[-14, 3.45, 3.6], [-8, 3.5, 3.6], [-2, 3.45, 3.6], [3.6, 3.4, 3.6]],
  proportionality: [[-14, 3.45, 3.6], [-9, 3.5, 3.6], [-4, 3.45, 3.6], [0, 3.4, 3.6]],
  human_authorization: [[-14, 3.45, 3.6], [-9, 3.5, 3.6], [-5.5, 3.45, 3.6], [-3.6, 3.4, 3.6]],
  altitude: [[-14, 3.3, 3.6], [-9, 3.5, 3.6], [-4, 4.2, 3.6], [1, 5.2, 3.6], [6, 6.0, 3.6], [12, 6.3, 3.6]],
  weather: [[-14, 3.4, 3.6], [-9, 3.55, 3.6], [-3, 3.5, 3.6], [2, 3.45, 3.6], [7, 3.4, 3.6]],
  window: [[-14, 3.45, -4.2], [-10, 3.55, -4.2], [-5, 3.45, -4.2], [0, 3.5, -4.2]],
  link: [[-14, 3.45, -4.2], [-10, 3.55, -4.2], [-5, 3.45, -4.2], [0, 3.5, -4.2], [3.6, 3.55, -2.2]],
  replay: [[-14, 3.45, -4.2], [-11.5, 3.5, -4.2], [-9.5, 3.45, -4.2]]
});

export const FLIGHT_ALTITUDE_OFFSET = 2.8;
export const ROUTE_WAYPOINTS = deepFreeze(Object.fromEntries(Object.entries(LOW_ALTITUDE_ROUTE_WAYPOINTS).map(([name, waypoints]) => [
  name,
  waypoints.map(([x, y, z]) => [x, y + FLIGHT_ALTITUDE_OFFSET, z])
])));

const segmentIntersectsExpandedBuilding = (start, end, building, clearance) => {
  const { visibleBounds } = building;
  const minimums = [visibleBounds.minX - clearance, visibleBounds.minY - clearance, visibleBounds.minZ - clearance];
  const maximums = [visibleBounds.maxX + clearance, visibleBounds.maxY + clearance, visibleBounds.maxZ + clearance];
  let minimumTime = 0;
  let maximumTime = 1;

  for (let axis = 0; axis < 3; axis += 1) {
    if ((start[axis] < minimums[axis] && end[axis] < minimums[axis])
      || (start[axis] > maximums[axis] && end[axis] > maximums[axis])) {
      return false;
    }
    const scale = Math.max(1, Math.abs(start[axis]), Math.abs(end[axis]), Math.abs(minimums[axis]), Math.abs(maximums[axis]));
    const scaledStart = start[axis] / scale;
    const scaledEnd = end[axis] / scale;
    const scaledMinimum = minimums[axis] / scale;
    const scaledMaximum = maximums[axis] / scale;
    const delta = scaledEnd - scaledStart;

    if (delta === 0) {
      continue;
    }

    let entryTime = (scaledMinimum - scaledStart) / delta;
    let exitTime = (scaledMaximum - scaledStart) / delta;
    if (entryTime > exitTime) [entryTime, exitTime] = [exitTime, entryTime];
    minimumTime = Math.max(minimumTime, entryTime);
    maximumTime = Math.min(maximumTime, exitTime);
    if (minimumTime > maximumTime) return false;
  }
  return true;
};

const validateCollisionInputs = (waypoints, clearance) => {
  if (typeof clearance !== "number") throw new TypeError("clearance must be a number");
  if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError("clearance must be finite and nonnegative");
  if (!Array.isArray(waypoints)) throw new TypeError("waypoints must be an array");
  const waypointCount = waypoints.length;
  if (waypointCount < 2) throw new RangeError("waypoints must contain at least two points");
  if (waypointCount > MAX_POLYLINE_WAYPOINTS) {
    throw new RangeError(`waypoints must contain at most ${MAX_POLYLINE_WAYPOINTS} points`);
  }

  const snapshot = new Array(waypointCount);
  for (let index = 0; index < waypointCount; index += 1) {
    if (!Object.hasOwn(waypoints, index)) throw new TypeError(`waypoint at index ${index} must be a dense [x, y, z] array`);
    const waypoint = waypoints[index];
    if (!Array.isArray(waypoint) || waypoint.length !== 3 || ![0, 1, 2].every((axis) => Object.hasOwn(waypoint, axis))) {
      throw new TypeError(`waypoint at index ${index} must be a dense [x, y, z] array`);
    }
    const point = [waypoint[0], waypoint[1], waypoint[2]];
    if (!point.every((coordinate) => typeof coordinate === "number")) {
      throw new TypeError(`waypoint at index ${index} coordinates must be numbers`);
    }
    if (!point.every(Number.isFinite)) {
      throw new RangeError(`waypoint at index ${index} coordinates must be finite`);
    }
    snapshot[index] = point;
  }
  return snapshot;
};

export const findPolylineBuildingCollisions = (waypoints, clearance = 0.5) => {
  const snapshot = validateCollisionInputs(waypoints, clearance);
  const collisions = new Set();
  for (let index = 1; index < snapshot.length; index += 1) {
    for (const building of BUILDING_SPECS) {
      if (collisions.has(building.name)) continue;
      if (segmentIntersectsExpandedBuilding(snapshot[index - 1], snapshot[index], building, clearance)) {
        collisions.add(building.name);
      }
    }
  }
  return [...collisions];
};
