import type { CanvasElement } from "../types";
import {
  STREAM_H,
  STREAM_OFFSET_X,
  STREAM_OFFSET_Y,
  STREAM_W,
} from "./config";

export function getDvdPosition(element: CanvasElement, now = Date.now()) {
  if (
    !element.dvdEnabled ||
    element.dvdStartedAt === undefined ||
    element.dvdStartX === undefined ||
    element.dvdStartY === undefined ||
    element.dvdVelocityX === undefined ||
    element.dvdVelocityY === undefined
  ) {
    return { x: element.x, y: element.y };
  }

  const minX = STREAM_OFFSET_X;
  const minY = STREAM_OFFSET_Y;
  const maxX = STREAM_OFFSET_X + Math.max(0, STREAM_W - element.width);
  const maxY = STREAM_OFFSET_Y + Math.max(0, STREAM_H - element.height);
  const elapsed = Math.max(0, now - element.dvdStartedAt) / 1000;

  return {
    x: reflect(element.dvdStartX + element.dvdVelocityX * elapsed, minX, maxX),
    y: reflect(element.dvdStartY + element.dvdVelocityY * elapsed, minY, maxY),
  };
}

export function createDvdMotion(element: CanvasElement, now = Date.now()) {
  const minX = STREAM_OFFSET_X;
  const minY = STREAM_OFFSET_Y;
  const maxX = STREAM_OFFSET_X + Math.max(0, STREAM_W - element.width);
  const maxY = STREAM_OFFSET_Y + Math.max(0, STREAM_H - element.height);
  const angle = ((25 + Math.random() * 40) * Math.PI) / 180;
  const speed = 110 + Math.random() * 100;
  const signX = Math.random() < 0.5 ? -1 : 1;
  const signY = Math.random() < 0.5 ? -1 : 1;
  const startX = randomBetween(minX, maxX);
  const startY = randomBetween(minY, maxY);

  return {
    dvdEnabled: true,
    dvdStartedAt: now,
    dvdStartX: startX,
    dvdStartY: startY,
    dvdVelocityX: Math.cos(angle) * speed * signX,
    dvdVelocityY: Math.sin(angle) * speed * signY,
    x: startX,
    y: startY,
    rotation: 0,
  } satisfies Partial<CanvasElement>;
}

function reflect(value: number, min: number, max: number) {
  const range = max - min;
  if (range <= 0) return min;
  const period = range * 2;
  const wrapped = ((value - min) % period + period) % period;
  return min + (wrapped <= range ? wrapped : period - wrapped);
}

function randomBetween(min: number, max: number) {
  return max <= min ? min : min + Math.random() * (max - min);
}
