import { pathToFileURL } from "node:url";
import { CloudflareKV } from "./cloudflare-kv.mjs";
import { refreshRoads } from "./roads.mjs";
import { refreshAir } from "./air.mjs";
import { refreshKnf } from "./knf.mjs";
import { refresh, refreshImgw, refreshNews } from "./source.mjs";

export async function run(store, now = Date.now(), fetcher = fetch) {
  const result = {};
  for (const [kind, interval] of [
    // Intervals are sized for the Workers KV Free plan (1,000 writes/day).
    ["weather", 300000],
    ["cert", 7200000],
    ["news", 1800000],
    ["air", 3600000],
    ["roads", 900000],
    ["knf", 86400000],
  ]) {
    const previous = await store.get(kind);
    if (
      (kind !== "weather" || previous?.operations?.schema_version === 1) &&
      (kind !== "air" || previous?.schema_version === 2) &&
      (kind !== "news" || previous?.bundle_schema_version === 5) &&
      (previous?.bundle_attempt_at || previous?.last_attempt_at) &&
      now - Date.parse(previous.bundle_attempt_at || previous.last_attempt_at) <
        interval
    ) {
      result[kind] = "skipped";
      continue;
    }
    result[kind] = (await (kind === "weather"
      ? refreshImgw(store, fetcher, now)
      : kind === "knf"
        ? refreshKnf(store, fetcher, now)
        : kind === "roads"
          ? refreshRoads(store, fetcher, now)
          : kind === "news"
            ? refreshNews(store, fetcher, now)
            : kind === "air"
              ? refreshAir(store, fetcher, now)
              : refresh(kind, { SOURCES: store }, fetcher, now)))
      ? "ok"
      : "error";
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const store = new CloudflareKV({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    const result = await run(store);
    console.log(JSON.stringify(result));
    // A single failed source fetch is routine (the previous copy is kept and
    // the site marks it as outdated). It is reported as a warning; prolonged
    // staleness is alerted by the Cloudflare Worker (worker/alerts.mjs).
    // The run fails only on configuration or integrator errors (catch below).
    for (const [kind, outcome] of Object.entries(result))
      if (outcome === "error")
        console.log(`::warning title=OSSA source::${kind} refresh failed; previous copy kept`);
  } catch (error) {
    // Config errors deliberately carry no raw provider responses or secrets.
    console.error(error.message);
    process.exitCode = 1;
  }
}
