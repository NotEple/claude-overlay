import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasElement, DrawStroke } from "../types.js";
import { validElement, validElementUpdate, validMediaControl, validStroke } from "./validation.js";

const element: CanvasElement = {
  id: "element-1",
  type: "image",
  src: "https://example.test/image.png",
  x: 0,
  y: 0,
  width: 400,
  height: 225,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  visible: true,
  zIndex: 1,
};

test("accepts a valid canvas element", () => assert.equal(validElement(element), true));
test("rejects invalid or oversized elements", () => {
  assert.equal(validElement({ ...element, width: -1 }), false);
  assert.equal(validElement({ ...element, src: "x".repeat(10_001) }), false);
});
test("only allows supported update fields and values", () => {
  assert.equal(validElementUpdate({ x: 12, mediaVolume: 0.5 }), true);
  assert.equal(validElementUpdate({ autoVisibility: true }), true);
  assert.equal(
    validElementUpdate({
      dvdEnabled: true,
      dvdStartedAt: Date.now(),
      dvdStartX: 100,
      dvdStartY: 200,
      dvdVelocityX: 150,
      dvdVelocityY: -120,
    }),
    true,
  );
  assert.equal(validElementUpdate({ id: "replacement" }), false);
  assert.equal(validElementUpdate({ autoVisibility: "yes" } as never), false);
  assert.equal(validElementUpdate({ mediaVolume: 2 }), false);
});
test("bounds stored drawing data", () => {
  const stroke: DrawStroke = { id: "stroke-1", points: [[1, 2]], color: "#fff", size: 4, eraser: false };
  assert.equal(validStroke(stroke), true);
  assert.equal(validStroke({ ...stroke, points: [[Number.NaN, 2]] }), false);
  assert.equal(validStroke({ ...stroke, size: 201 }), false);
});
test("validates media control commands", () => {
  assert.equal(validMediaControl({ id: "video-1", action: "seek", currentTime: 12 }), true);
  assert.equal(validMediaControl({ id: "video-1", action: "seek", currentTime: -1 }), false);
});
