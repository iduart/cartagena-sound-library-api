// Rate limiting for the expensive endpoints.
//
// createSound is unauthenticated and public: every call spawns yt-dlp and
// ffmpeg, and (once a proxy is configured) spends metered proxy bandwidth. A
// single abusive client could otherwise exhaust the instance's CPU credits and
// the proxy balance.
//
// State is in-process, which is the right trade-off for a single instance: no
// Redis to run, no network hop. The consequences are that counters reset when
// the service restarts, and that this would need replacing with a shared store
// if the API is ever scaled beyond one box.

const {
  RATE_LIMIT_DEVICE_PER_MINUTE,
  RATE_LIMIT_DEVICE_PER_HOUR,
  RATE_LIMIT_IP_PER_HOUR,
  MAX_CONCURRENT_EXTRACTIONS,
} = process.env;

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LIMITS = {
  devicePerMinute: num(RATE_LIMIT_DEVICE_PER_MINUTE, 3),
  devicePerHour: num(RATE_LIMIT_DEVICE_PER_HOUR, 20),
  // Higher than the device limit because whole households and mobile carriers
  // share an address via NAT.
  ipPerHour: num(RATE_LIMIT_IP_PER_HOUR, 60),
  // t3.micro has 2 vCPUs and burstable credits; each extraction is a few
  // seconds of ffmpeg. Running many at once exhausts credits and slows
  // everything down, so shed load instead of queueing without bound.
  maxConcurrent: num(MAX_CONCURRENT_EXTRACTIONS, 2),
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// key -> array of request timestamps, newest last
const hits = new Map();

const record = (key, windowMs, limit) => {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (hits.get(key) || []).filter((t) => t > cutoff);

  if (timestamps.length >= limit) {
    const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return { allowed: true };
};

// Without this, every device that ever called the API would be retained.
const pruneEvery = 10 * MINUTE;
setInterval(() => {
  const cutoff = Date.now() - HOUR;
  for (const [key, timestamps] of hits) {
    const live = timestamps.filter((t) => t > cutoff);
    if (live.length) hits.set(key, live);
    else hits.delete(key);
  }
}, pruneEvery).unref(); // unref so the timer never holds the process open

let inFlight = 0;

class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    // Surfaced to Apollo so clients can distinguish this from a real failure.
    this.extensions = { code: "RATE_LIMITED", retryAfter };
  }
}

// Throws RateLimitError when a caller is over budget. Returns a release()
// function that MUST be called in a finally block, or the concurrency slot
// leaks and the API wedges after `maxConcurrent` requests.
function acquireExtractionSlot({ deviceId, ip }) {
  const device = deviceId || "unknown-device";

  const perMinute = record(`d:m:${device}`, MINUTE, LIMITS.devicePerMinute);
  if (!perMinute.allowed) {
    throw new RateLimitError(
      `Too many requests. Try again in ${perMinute.retryAfter}s.`,
      perMinute.retryAfter
    );
  }

  const perHour = record(`d:h:${device}`, HOUR, LIMITS.devicePerHour);
  if (!perHour.allowed) {
    throw new RateLimitError(
      `Hourly limit of ${LIMITS.devicePerHour} sounds reached. ` +
        `Try again in ${Math.ceil(perHour.retryAfter / 60)} minutes.`,
      perHour.retryAfter
    );
  }

  // deviceId comes from the client and is trivially forged, so an address-based
  // limit backs it up. It is deliberately looser to avoid punishing NAT.
  if (ip) {
    const byIp = record(`i:h:${ip}`, HOUR, LIMITS.ipPerHour);
    if (!byIp.allowed) {
      throw new RateLimitError(
        `Too many requests from this network. ` +
          `Try again in ${Math.ceil(byIp.retryAfter / 60)} minutes.`,
        byIp.retryAfter
      );
    }
  }

  if (inFlight >= LIMITS.maxConcurrent) {
    throw new RateLimitError(
      "The server is busy processing other sounds. Try again in a moment.",
      10
    );
  }

  inFlight += 1;
  let released = false;
  return () => {
    if (released) return; // guard against a double release miscounting
    released = true;
    inFlight -= 1;
  };
}

const stats = () => ({ inFlight, trackedKeys: hits.size, limits: LIMITS });

module.exports = { acquireExtractionSlot, RateLimitError, stats, LIMITS };
