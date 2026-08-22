import assert from "node:assert/strict";
import test from "node:test";
import { signToken } from "./jwt.js";

process.env.SESSION_SECRET = "authorization-test-secret";
process.env.OWNER_TWITCH_USERNAME = "vicksy";

const { getUserFromToken } = await import("./routes.js");

test("derives owner privileges instead of trusting token role claims", () => {
  const token = signToken({
    id: "1", login: "vicksy", displayName: "Vicksy", avatar: "", color: "#fff",
    isOwner: false, isAdmin: false,
  }, process.env.SESSION_SECRET!);
  const user = getUserFromToken(token);
  assert.equal(user?.isOwner, true);
  assert.equal(user?.isAdmin, true);
});

test("rejects a valid token when its user is not whitelisted", () => {
  const token = signToken({
    id: "2", login: "definitely-not-whitelisted", displayName: "Removed User",
    avatar: "", color: "#fff", isOwner: false, isAdmin: true,
  }, process.env.SESSION_SECRET!);
  assert.equal(getUserFromToken(token), null);
});
