import assert from "node:assert/strict";
import test from "node:test";
import { BUILDING_SPECS, ROUTE_WAYPOINTS, findPolylineBuildingCollisions } from "../simulator-world.js";

test("every route maintains building clearance", () => {
  for (const [name, waypoints] of Object.entries(ROUTE_WAYPOINTS)) {
    assert.deepEqual(findPolylineBuildingCollisions(waypoints), [], `${name} route intersects a building`);
  }
});

test("flight paths remain visibly above the tallest roof", () => {
  const tallestRoof = Math.max(...BUILDING_SPECS.map(({ height }) => height + 0.8));
  for (const [name, waypoints] of Object.entries(ROUTE_WAYPOINTS)) {
    const minimumAltitude = Math.min(...waypoints.map(([, y]) => y));
    assert.ok(minimumAltitude >= tallestRoof + 0.5, `${name} route lacks vertical roof clearance`);
  }
});

test("building names and footprints are unique", () => {
  assert.equal(new Set(BUILDING_SPECS.map(({ name }) => name)).size, BUILDING_SPECS.length);
  assert.equal(new Set(BUILDING_SPECS.map(({ x, z }) => `${x}:${z}`)).size, BUILDING_SPECS.length);
});
