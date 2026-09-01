import assert from "node:assert/strict";
import test from "node:test";
import { resolveSevenTvEmotes } from "./emotes.js";

test("resolves only the first exact 7TV emote token to a trusted CDN URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    emote_set: {
      emotes: [
        { id: "emote-one", name: "FoxDance" },
        { id: "emote-two", name: "AINTNOWAY" },
      ],
    },
  }));
  try {
    const matches = await resolveSevenTvEmotes("test-room", "FoxDance hello AINTNOWAY");
    assert.deepEqual(matches.map((item) => item.name), ["FoxDance"]);
    assert.equal(matches[0]?.imageUrl, "https://cdn.7tv.app/emote/emote-one/2x.webp");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
