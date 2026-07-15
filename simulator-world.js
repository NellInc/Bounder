export const WORLD_BOUNDS = { width: 34, depth: 26 };

export const BUILDING_SPECS = [
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

const LOW_ALTITUDE_ROUTE_WAYPOINTS = {
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
};

export const FLIGHT_ALTITUDE_OFFSET = 2.8;
export const ROUTE_WAYPOINTS = Object.fromEntries(Object.entries(LOW_ALTITUDE_ROUTE_WAYPOINTS).map(([name, waypoints]) => [
  name,
  waypoints.map(([x, y, z]) => [x, y + FLIGHT_ALTITUDE_OFFSET, z])
]));

const segmentIntersectsExpandedBuilding = (start, end, building, clearance) => {
  const minX = building.x - building.width / 2 - clearance;
  const maxX = building.x + building.width / 2 + clearance;
  const minZ = building.z - building.depth / 2 - clearance;
  const maxZ = building.z + building.depth / 2 + clearance;
  const steps = Math.max(2, Math.ceil(Math.hypot(end[0] - start[0], end[2] - start[2]) * 8));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = start[0] + (end[0] - start[0]) * t;
    const y = start[1] + (end[1] - start[1]) * t;
    const z = start[2] + (end[2] - start[2]) * t;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && y <= building.height + 0.8 + clearance) return true;
  }
  return false;
};

export const findPolylineBuildingCollisions = (waypoints, clearance = 0.5) => {
  const collisions = [];
  for (let index = 1; index < waypoints.length; index += 1) {
    for (const building of BUILDING_SPECS) {
      if (segmentIntersectsExpandedBuilding(waypoints[index - 1], waypoints[index], building, clearance)) {
        collisions.push(building.name);
      }
    }
  }
  return [...new Set(collisions)];
};
