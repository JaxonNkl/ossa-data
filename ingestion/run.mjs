import { pathToFileURL } from "node:url";
import { CloudflareKV } from "./cloudflare-kv.mjs";
import { refreshAir } from "./air.mjs";
import { refresh, refreshImgw, refreshNews } from "./source.mjs";

export async function run(store, now = Date.now(), fetcher = fetch) {
  const result = {};
  for (const [kind, interval] of [
    ["weather", 240000],
    ["cert", 1800000],
    ["news", 900000],
    ["air", 3600000],
  ]) {
    const previous = await store.get(kind);
    if (
      (kind !== "air" || previous?.schema_version === 2) &&
      (kind !== "news" || previous?.bundle_schema_version === 2) &&
      (previous?.bundle_attempt_at || previous?.last_attempt_at) &&
      now - Date.parse(previous.bundle_attempt_at || previous.last_attempt_at) <
        interval
    ) {
      result[kind] = "skipped";
      continue;
    }
    result[kind] = (await (kind === "weather"
      ? refreshImgw(store, fetcher, now)
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
    if (Object.values(result).includes("error")) process.exitCode = 1;
  } catch (error) {
    // Config errors deliberately carry no raw provider responses or secrets.
    console.error(error.message);
    process.exitCode = 1;
  }
}
