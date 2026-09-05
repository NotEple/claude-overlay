import { rateLimit } from "express-rate-limit";

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

// These endpoints perform comparatively expensive or stateful work. Limits are
// intentionally generous for normal dashboard use but constrain automated abuse.
export const loginRateLimit = limiter(
  10 * 60_000,
  30,
  "Too many login attempts. Try again in a few minutes.",
);
export const uploadRateLimit = limiter(
  10 * 60_000,
  60,
  "Too many uploads. Wait a few minutes before trying again.",
);
export const externalLookupRateLimit = limiter(
  10 * 60_000,
  30,
  "Too many external sound lookups. Try again in a few minutes.",
);
