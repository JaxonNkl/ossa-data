import {
  urls,
  hash,
  certDomains,
  weatherRecords,
  hydroRecords,
} from "../worker/data.mjs";
import { boundedText } from "../worker/http.mjs";
import { parseNotices } from "./notices.mjs";
export async function refresh(kind, env, fetcher = fetch, now = Date.now()) {
  const previous = await env.SOURCES.get(kind, "json");
  const at = new Date(now).toISOString();
  try {
    const response = await fetcher(urls[kind], {
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "OSSA/0.8 source-integrator" },
    });
    const type = response.headers.get("content-type") || "";
    const validType = ["weather", "hydro"].includes(kind)
      ? type.includes("application/json")
      : kind === "news"
        ? /(?:application\/(?:rss\+xml|xml)|text\/xml)/i.test(type)
        : type.includes("text/plain");
    if (response.status !== 200 || !validType)
      throw Error("Invalid source response");
    const raw = await boundedText(
      response,
      (["weather", "hydro"].includes(kind) ? 8 : kind === "news" ? 5 : 15) *
        1024 *
        1024,
    );
    const parsed =
      kind === "hydro"
        ? { records: await hydroRecords(raw, previous) }
        : kind === "weather"
          ? { records: await weatherRecords(raw, previous) }
          : kind === "news"
            ? { notices: await parseNotices(raw, now) }
            : certDomains(raw);
    const snapshot = {
      ...parsed,
      fetched_at: at,
      sha256: await hash(raw),
      last_attempt_at: at,
      last_attempt_outcome: "ok",
    };
    const encoded = JSON.stringify(snapshot);
    if (new TextEncoder().encode(encoded).byteLength > 24 * 1024 * 1024)
      throw Error("Snapshot too large");
    await env.SOURCES.put(kind, encoded);
    return true;
  } catch (error) {
    await env.SOURCES.put(
      kind,
      JSON.stringify({
        ...previous,
        last_attempt_at: at,
        last_attempt_outcome: "error",
      }),
    );
    console.error(
      JSON.stringify({
        source: kind,
        status: "refresh_failed",
        reason:
          error instanceof Error ? error.message.slice(0, 200) : "source_error",
      }),
    );
    return false;
  }
}

// Timestamps change on every run; they alone do not justify a KV write.
const volatile = new Set(["fetched_at", "last_attempt_at", "bundle_attempt_at", "written_at"]);
export function withoutTimestamps(value) {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !volatile.has(key))
      .map(([key, item]) => [key, withoutTimestamps(item)]),
  );
}
// The weather bundle is read as current for 20 minutes. When nothing but
// timestamps changed, a write is still made at least this often so the copy
// never looks stale; ADS-B updates (about every 10 minutes) also force a write.
export const WEATHER_HEARTBEAT = 540000;
export function weatherWriteNeeded(previous, next, now) {
  const written = Date.parse(previous?.written_at ?? "");
  return (
    !previous ||
    !Number.isFinite(written) ||
    now < written ||
    now - written >= WEATHER_HEARTBEAT ||
    JSON.stringify(withoutTimestamps(previous)) !==
      JSON.stringify(withoutTimestamps(next))
  );
}

// Publish both independent IMGW snapshots in one KV write; a failed source
// retains its own previous copy and timestamps without affecting the other.
// Unchanged bundles are not rewritten until the heartbeat is due.
export async function refreshImgw(store, fetcher = fetch, now = Date.now()) {
  const {refreshOperations}=await import("./operations.mjs");
  const previous = await store.get("weather");
  const operations=await refreshOperations(previous?.operations,fetcher,now);
  const copies = { weather: previous, hydro: previous?.hydro ?? null };
  const memory = {
    get: async (kind) => copies[kind],
    put: async (kind, value) => {
      copies[kind] = JSON.parse(value);
    },
  };
  const results = await Promise.all(
    ["weather", "hydro"].map((kind) =>
      refresh(kind, { SOURCES: memory }, fetcher, now),
    ),
  );
  const next = {
    ...copies.weather,
    hydro: copies.hydro,
    operations,
    bundle_attempt_at: new Date(now).toISOString(),
    written_at: new Date(now).toISOString(),
  };
  if (weatherWriteNeeded(previous, next, now))
    await store.put("weather", JSON.stringify(next));
  return results.every(Boolean);
}

export async function refreshNews(store, fetcher = fetch, now = Date.now()) {
  const { refreshRcb } = await import("./rcb.mjs");
  const { refreshPaa } = await import("./paa.mjs");
  const previous = await store.get("news");
  let news = previous;
  const memory = {
    get: async () => previous,
    put: async (_, value) => {
      news = JSON.parse(value);
    },
  };
  const [ok, rcb, paa] = await Promise.all([
    refresh("news", { SOURCES: memory }, fetcher, now),
    refreshRcb(previous?.rcb, fetcher, now),
    refreshPaa(previous?.paa, fetcher, now),
  ]);
  await store.put(
    "news",
    JSON.stringify({
      ...news,
      bundle_schema_version: 5,
      rcb,
      paa,
      bundle_attempt_at: new Date(now).toISOString(),
    }),
  );
  return ok && rcb.last_attempt_outcome === "ok" && paa.last_attempt_outcome === "ok";
}
