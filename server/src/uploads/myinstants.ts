import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const directPath = /^\/media\/sounds\/[a-zA-Z0-9_.%-]+\.mp3$/i;
const pagePath = /^\/(?:[a-z]{2}\/)?instant\/[a-zA-Z0-9_-]+\/?$/;
const maxHtmlBytes = 512 * 1024;

export const myinstantsRouter = Router();

myinstantsRouter.post("/resolve", requireAuth, async (req, res) => {
  try {
    const submitted = new URL(String(req.body?.url ?? ""));
    if (submitted.protocol !== "https:" || !["myinstants.com", "www.myinstants.com"].includes(submitted.hostname)) {
      return res.status(400).json({ error: "Use an HTTPS Myinstants sound-page or MP3 link" });
    }
    if (directPath.test(submitted.pathname)) {
      return res.json({ url: `https://www.myinstants.com${submitted.pathname}` });
    }
    if (!pagePath.test(submitted.pathname)) {
      return res.status(400).json({ error: "This is not a recognized Myinstants sound page" });
    }

    const response = await fetch(`https://www.myinstants.com${submitted.pathname}`, {
      redirect: "error",
      headers: { "User-Agent": "VicksyOverlay/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok || !response.body) throw new Error(`Myinstants returned ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > maxHtmlBytes) throw new Error("Myinstants page was unexpectedly large");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxHtmlBytes) { await reader.cancel(); throw new Error("Myinstants page was unexpectedly large"); }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    const path = html.match(/\/media\/sounds\/[a-zA-Z0-9_.%-]+\.mp3/i)?.[0];
    if (!path || !directPath.test(path)) throw new Error("No direct MP3 was found on that page");
    const title = html.match(/<h1[^>]*>([^<]{1,100})<\/h1>/i)?.[1]?.trim();
    return res.json({ url: `https://www.myinstants.com${path}`, title });
  } catch (error) {
    console.error("Myinstants link resolution failed", error);
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not resolve Myinstants link" });
  }
});
