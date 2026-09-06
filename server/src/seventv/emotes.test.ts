import assert from "node:assert/strict";
import test from "node:test";
import { resolveSevenTvEmotes } from "./emotes.js";

test("resolves ordered 7TV emotes and identifies zero-width overlays", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => new Response(JSON.stringify(
    String(input).endsWith("/emote-sets/global")
      ? { emotes: [{ id: "global-piano", name: "PianoTime" }] }
      : { emote_set: { emotes: [
          { id: "emote-one", name: "FoxDance" },
          { id: "emote-overlay", name: "RainTime", flags: 1 },
          { id: "emote-two", name: "AINTNOWAY" },
        ] } },
  ));
  try {
    const matches = await resolveSevenTvEmotes("test-room", "FoxDance RainTime PianoTime AINTNOWAY");
    assert.deepEqual(matches.map((item) => item.name), ["FoxDance", "RainTime", "PianoTime", "AINTNOWAY"]);
    assert.equal(matches[0]?.imageUrl, "https://cdn.7tv.app/emote/emote-one/2x.webp");
    assert.equal(matches[1]?.isZeroWidth, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
