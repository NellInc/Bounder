import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  BUILDING_SPECS,
  FLIGHT_ALTITUDE_OFFSET,
  MAX_POLYLINE_WAYPOINTS,
  ROUTE_WAYPOINTS,
  WORLD_BOUNDS,
  findPolylineBuildingCollisions
} from "../simulator-world.js";

const buildingNamed = (name) => {
  const building = BUILDING_SPECS.find((candidate) => candidate.name === name);
  assert.ok(building, `missing ${name} fixture`);
  return building;
};

const repeatedPoint = (point) => [point.slice(), point.slice()];

const adjacentFloatBuffer = new ArrayBuffer(8);
const adjacentFloat = new Float64Array(adjacentFloatBuffer);
const adjacentBits = new BigUint64Array(adjacentFloatBuffer);
const nextUp = (value) => {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
  if (Object.is(value, -0)) return Number.MIN_VALUE;
  adjacentFloat[0] = value;
  adjacentBits[0] += value >= 0 ? 1n : -1n;
  return adjacentFloat[0];
};
const nextDown = (value) => -nextUp(-value);

const assertDeepFrozen = (value, path = "value", visited = new WeakSet()) => {
  if (value === null || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(value[key], `${path}.${String(key)}`, visited);
};

const assertApproxEqual = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= 1e-12, `${message}: expected ${expected}, received ${actual}`);
};

test("world model is finite, immutable, visible, bounded, and non-overlapping", () => {
  assertDeepFrozen(WORLD_BOUNDS, "WORLD_BOUNDS");
  assertDeepFrozen(BUILDING_SPECS, "BUILDING_SPECS");
  assertDeepFrozen(ROUTE_WAYPOINTS, "ROUTE_WAYPOINTS");
  assert.ok(Number.isFinite(WORLD_BOUNDS.width) && WORLD_BOUNDS.width > 0);
  assert.ok(Number.isFinite(WORLD_BOUNDS.depth) && WORLD_BOUNDS.depth > 0);
  assert.ok(Number.isFinite(FLIGHT_ALTITUDE_OFFSET) && FLIGHT_ALTITUDE_OFFSET > 0);

  const names = new Set();
  const awningFrontOverhang = 0.24 + Math.cos(0.18) * (0.42 / 2) + Math.sin(0.18) * (0.08 / 2);
  for (const [index, building] of BUILDING_SPECS.entries()) {
    assert.match(building.name, /\S/, `building ${index} has no name`);
    assert.equal(names.has(building.name), false, `duplicate building name ${building.name}`);
    names.add(building.name);
    assert.match(building.colour, /^#[0-9a-f]{6}$/i, `${building.name} has an invalid colour`);
    assert.match(building.roof, /^#[0-9a-f]{6}$/i, `${building.name} has an invalid roof colour`);
    for (const field of ["x", "z", "width", "depth", "height"]) {
      assert.equal(Number.isFinite(building[field]), true, `${building.name}.${field} is not finite`);
    }
    assert.ok(building.width > 0 && building.depth > 0 && building.height > 0, `${building.name} has nonpositive dimensions`);
    if (Object.hasOwn(building, "protected")) assert.equal(typeof building.protected, "boolean");

    assert.equal(building.hasChimney, index % 3 === 0, `${building.name} chimney state drifted from rendered geometry`);
    const expectedHalfWidth = Math.max(building.width / 2 + 0.275, building.width / 2 + 0.18, building.width * 0.24 + 0.45);
    const expectedTop = building.height + (building.hasChimney ? 0.925 : 0.84);
    assertApproxEqual(building.visibleBounds.minX, building.x - expectedHalfWidth, `${building.name} minimum x envelope`);
    assertApproxEqual(building.visibleBounds.maxX, building.x + expectedHalfWidth, `${building.name} maximum x envelope`);
    assert.equal(building.visibleBounds.minY, 0, `${building.name} must begin at ground level`);
    assertApproxEqual(building.visibleBounds.maxY, expectedTop, `${building.name} top envelope`);
    assertApproxEqual(building.visibleBounds.minZ, building.z - building.depth / 2 - 0.275, `${building.name} rear envelope`);
    assertApproxEqual(building.visibleBounds.maxZ, building.z + building.depth / 2 + awningFrontOverhang, `${building.name} front envelope`);
    for (const [field, value] of Object.entries(building.visibleBounds)) {
      assert.equal(Number.isFinite(value), true, `${building.name}.visibleBounds.${field} is not finite`);
    }
    assert.ok(building.visibleBounds.minX < building.visibleBounds.maxX);
    assert.ok(building.visibleBounds.minY < building.visibleBounds.maxY);
    assert.ok(building.visibleBounds.minZ < building.visibleBounds.maxZ);
    assert.ok(building.visibleBounds.minX >= -WORLD_BOUNDS.width / 2, `${building.name} exceeds western world bounds`);
    assert.ok(building.visibleBounds.maxX <= WORLD_BOUNDS.width / 2, `${building.name} exceeds eastern world bounds`);
    assert.ok(building.visibleBounds.minZ >= -WORLD_BOUNDS.depth / 2, `${building.name} exceeds northern world bounds`);
    assert.ok(building.visibleBounds.maxZ <= WORLD_BOUNDS.depth / 2, `${building.name} exceeds southern world bounds`);
  }

  for (let leftIndex = 0; leftIndex < BUILDING_SPECS.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < BUILDING_SPECS.length; rightIndex += 1) {
      const left = BUILDING_SPECS[leftIndex];
      const right = BUILDING_SPECS[rightIndex];
      const separated = left.visibleBounds.maxX <= right.visibleBounds.minX
        || right.visibleBounds.maxX <= left.visibleBounds.minX
        || left.visibleBounds.maxZ <= right.visibleBounds.minZ
        || right.visibleBounds.maxZ <= left.visibleBounds.minZ;
      assert.equal(separated, true, `${left.name} and ${right.name} visible footprints overlap`);
    }
  }
});

test("canonical route waypoints are finite, bounded, visibly elevated, and collision-free", () => {
  const tallestVisiblePoint = Math.max(...BUILDING_SPECS.map(({ visibleBounds }) => visibleBounds.maxY));
  for (const [name, waypoints] of Object.entries(ROUTE_WAYPOINTS)) {
    assert.ok(waypoints.length >= 2, `${name} has too few waypoints`);
    for (const [index, waypoint] of waypoints.entries()) {
      assert.equal(waypoint.length, 3, `${name}[${index}] is not a triple`);
      assert.equal(waypoint.every(Number.isFinite), true, `${name}[${index}] is not finite`);
      const [x, , z] = waypoint;
      assert.ok(Math.abs(x) <= WORLD_BOUNDS.width / 2, `${name}[${index}] exceeds x bounds`);
      assert.ok(Math.abs(z) <= WORLD_BOUNDS.depth / 2, `${name}[${index}] exceeds z bounds`);
    }
    const minimumWaypointAltitude = Math.min(...waypoints.map(([, y]) => y));
    assert.ok(minimumWaypointAltitude >= tallestVisiblePoint + 0.5, `${name} waypoints lack visible vertical clearance`);
    assert.deepEqual(findPolylineBuildingCollisions(waypoints), [], `${name} route intersects a visible building prism`);
  }
});

test("exact collision clipping includes tangencies and excludes adjacent outside points", () => {
  const cafe = buildingNamed("Cafe");
  const clearance = 0.5;
  const { visibleBounds } = cafe;
  const insideY = 1;
  const epsilon = 1e-9;
  const cases = [
    {
      name: "direct crossing",
      waypoints: [[visibleBounds.minX - clearance - 1, insideY, cafe.z], [cafe.x, insideY, cafe.z]],
      collides: true
    },
    {
      name: "reverse crossing",
      waypoints: [[cafe.x, insideY, cafe.z], [visibleBounds.minX - clearance - 1, insideY, cafe.z]],
      collides: true
    },
    {
      name: "minimum x tangent",
      waypoints: repeatedPoint([visibleBounds.minX - clearance, insideY, cafe.z]),
      collides: true
    },
    {
      name: "just outside minimum x",
      waypoints: repeatedPoint([visibleBounds.minX - clearance - epsilon, insideY, cafe.z]),
      collides: false
    },
    {
      name: "maximum x tangent",
      waypoints: repeatedPoint([visibleBounds.maxX + clearance, insideY, cafe.z]),
      collides: true
    },
    {
      name: "just outside maximum x",
      waypoints: repeatedPoint([visibleBounds.maxX + clearance + epsilon, insideY, cafe.z]),
      collides: false
    },
    {
      name: "top tangent",
      waypoints: repeatedPoint([cafe.x, visibleBounds.maxY + clearance, cafe.z]),
      collides: true
    },
    {
      name: "just above top",
      waypoints: repeatedPoint([cafe.x, visibleBounds.maxY + clearance + epsilon, cafe.z]),
      collides: false
    },
    {
      name: "bottom tangent",
      waypoints: repeatedPoint([cafe.x, visibleBounds.minY - clearance, cafe.z]),
      collides: true
    },
    {
      name: "just below bottom",
      waypoints: repeatedPoint([cafe.x, visibleBounds.minY - clearance - epsilon, cafe.z]),
      collides: false
    },
    {
      name: "minimum z tangent",
      waypoints: repeatedPoint([cafe.x, insideY, visibleBounds.minZ - clearance]),
      collides: true
    },
    {
      name: "just outside minimum z",
      waypoints: repeatedPoint([cafe.x, insideY, visibleBounds.minZ - clearance - epsilon]),
      collides: false
    },
    {
      name: "maximum z tangent",
      waypoints: repeatedPoint([cafe.x, insideY, visibleBounds.maxZ + clearance]),
      collides: true
    },
    {
      name: "just outside maximum z",
      waypoints: repeatedPoint([cafe.x, insideY, visibleBounds.maxZ + clearance + epsilon]),
      collides: false
    }
  ];

  for (const fixture of cases) {
    const collisions = findPolylineBuildingCollisions(fixture.waypoints, clearance);
    assert.equal(collisions.includes(cafe.name), fixture.collides, fixture.name);
  }
});

test("clearance is configurable and repeated segment collisions are deduplicated", () => {
  const cafe = buildingNamed("Cafe");
  const bufferPoint = [cafe.visibleBounds.minX - 0.25, 1, cafe.z];
  assert.equal(findPolylineBuildingCollisions(repeatedPoint(bufferPoint)).includes(cafe.name), true);
  assert.equal(findPolylineBuildingCollisions(repeatedPoint(bufferPoint), 0).includes(cafe.name), false);

  const outside = [cafe.visibleBounds.minX - 1, 1, cafe.z];
  const inside = [cafe.x, 1, cafe.z];
  assert.deepEqual(findPolylineBuildingCollisions([outside, inside, outside, inside]), [cafe.name]);
});

test("exact clipping detects a short corner intersection between former sample points", () => {
  const cafe = buildingNamed("Cafe");
  const expandedMinimumX = cafe.visibleBounds.minX - 0.5;
  const expandedMaximumZ = cafe.visibleBounds.maxZ + 0.5;
  const intersectionWidth = 0.01;
  const intercept = expandedMaximumZ - expandedMinimumX - intersectionWidth;
  const startX = expandedMinimumX - 1;
  const endX = expandedMinimumX + 1;
  const waypoints = [[startX, 1, startX + intercept], [endX, 1, endX + intercept]];
  assert.equal(findPolylineBuildingCollisions(waypoints).includes(cafe.name), true);
});

test("the immediately representable point outside a face is not rounded into collision", () => {
  const workshop = buildingNamed("Workshop");
  const tangentX = workshop.visibleBounds.minX - 0.5;
  const outsideX = nextDown(tangentX);
  assert.equal(findPolylineBuildingCollisions(repeatedPoint([tangentX, 1, workshop.z])).includes(workshop.name), true);
  assert.equal(findPolylineBuildingCollisions(repeatedPoint([outsideX, 1, workshop.z])).includes(workshop.name), false);
});

test("collision checks snapshot each coordinate once before using it", () => {
  let reads = 0;
  const changingPoint = [0, 1, 0];
  Object.defineProperty(changingPoint, 0, {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? 0 : Number.POSITIVE_INFINITY;
    }
  });
  assert.deepEqual(findPolylineBuildingCollisions([[0, 1, 0], changingPoint]), []);
  assert.equal(reads, 1);
});

test("malformed polylines and clearances fail explicitly", () => {
  const sparseWaypoints = Array(2);
  sparseWaypoints[0] = [0, 0, 0];
  const sparsePoint = Array(3);
  sparsePoint[0] = 0;
  sparsePoint[2] = 0;
  const valid = [[0, 0, 0], [1, 1, 1]];
  const excessiveWaypoints = [];
  excessiveWaypoints.length = MAX_POLYLINE_WAYPOINTS + 1;
  const waypointCases = [
    ["nonarray", null, TypeError, /waypoints must be an array/],
    ["empty", [], RangeError, /at least two points/],
    ["single", [[0, 0, 0]], RangeError, /at least two points/],
    ["excessive waypoint count", excessiveWaypoints, RangeError, /at most 4096 points/],
    ["sparse waypoint list", sparseWaypoints, TypeError, /dense \[x, y, z\] array/],
    ["nonarray point", [[0, 0, 0], { 0: 1, 1: 1, 2: 1, length: 3 }], TypeError, /dense \[x, y, z\] array/],
    ["short point", [[0, 0, 0], [1, 1]], TypeError, /dense \[x, y, z\] array/],
    ["long point", [[0, 0, 0], [1, 1, 1, 1]], TypeError, /dense \[x, y, z\] array/],
    ["sparse point", [[0, 0, 0], sparsePoint], TypeError, /dense \[x, y, z\] array/],
    ["string coordinate", [[0, 0, 0], [1, "1", 1]], TypeError, /coordinates must be numbers/],
    ["NaN coordinate", [[0, 0, 0], [1, Number.NaN, 1]], RangeError, /coordinates must be finite/],
    ["infinite vertical coordinate", [[0, 0, 0], [1, Infinity, 1]], RangeError, /coordinates must be finite/]
  ];
  const clearanceCases = [
    ["string clearance", "0.5", TypeError, /clearance must be a number/],
    ["null clearance", null, TypeError, /clearance must be a number/],
    ["NaN clearance", Number.NaN, RangeError, /finite and nonnegative/],
    ["infinite clearance", Infinity, RangeError, /finite and nonnegative/],
    ["negative clearance", -0.01, RangeError, /finite and nonnegative/]
  ];

  for (const [name, waypoints, ErrorType, message] of waypointCases) {
    assert.throws(() => findPolylineBuildingCollisions(waypoints), (error) => {
      assert.equal(error.constructor, ErrorType);
      assert.match(error.message, message);
      return true;
    }, name);
  }
  for (const [name, clearance, ErrorType, message] of clearanceCases) {
    assert.throws(() => findPolylineBuildingCollisions(valid, clearance), (error) => {
      assert.equal(error.constructor, ErrorType);
      assert.match(error.message, message);
      return true;
    }, name);
  }
});

test("collision input work is bounded and snapshots the outer length once", () => {
  const exactBoundary = Array.from({ length: MAX_POLYLINE_WAYPOINTS }, () => [0, 10, 0]);
  assert.deepEqual(findPolylineBuildingCollisions(exactBoundary), []);

  const shrinking = [[0, 10, 0], [1, 10, 0]];
  Object.defineProperty(shrinking, 0, {
    configurable: true,
    enumerable: true,
    get() {
      shrinking.length = 1;
      return [0, 10, 0];
    }
  });
  assert.throws(
    () => findPolylineBuildingCollisions(shrinking),
    /waypoint at index 1 must be a dense \[x, y, z\] array/,
    "a hostile element cannot shrink the remaining validation work"
  );
});

test("far finite geometry is constant-work and nonfinite horizontal geometry is rejected", () => {
  const moduleURL = new URL("../simulator-world.js", import.meta.url).href;
  const script = `
    import { findPolylineBuildingCollisions } from ${JSON.stringify(moduleURL)};
    const far = findPolylineBuildingCollisions([[-Number.MAX_VALUE, 1, -6.6], [Number.MAX_VALUE, 1, -6.6]]);
    let nonfinite;
    try {
      findPolylineBuildingCollisions([[0, 0, 0], [Infinity, 0, 0]]);
    } catch (error) {
      nonfinite = { name: error.name, message: error.message };
    }
    console.log(JSON.stringify({ far, nonfinite }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.deepEqual(result.far, ["Bakery", "Townhouse", "Library", "Workshop", "Civic offices"]);
  assert.deepEqual(result.nonfinite, {
    name: "RangeError",
    message: "waypoint at index 1 coordinates must be finite"
  });
});
