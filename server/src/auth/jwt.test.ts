import assert from "node:assert/strict";
import test from "node:test";
import { signToken, verifyToken } from "./jwt.js";

test("round trips a signed token", () => {
  const token = signToken({ login: "vicksy" }, "test-secret");
  assert.equal(verifyToken(token, "test-secret").login, "vicksy");
});

test("rejects tampered tokens and wrong secrets", () => {
  const token = signToken({ login: "vicksy" }, "test-secret");
  assert.throws(() => verifyToken(`${token.slice(0, -1)}x`, "test-secret"));
  assert.throws(() => verifyToken(token, "wrong-secret"));
});

test("rejects malformed and excessively large tokens", () => {
  assert.throws(() => verifyToken("not-a-jwt", "test-secret"));
  assert.throws(() => verifyToken("x".repeat(16_385), "test-secret"));
});
