import { urls, hash, certDomains, weatherRecords } from "../worker/data.mjs";
import { boundedText } from "../worker/http.mjs";
export async function refresh(kind, env, fetcher = fetch, now = Date.now()) {
  const previous = await env.SOURCES.get(kind, "json");
  const at = new Date(now).toISOString();
  try {
    const response = await fetcher(urls[kind], {
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "OSSA/0.4 source-integrator" },
    });
    const expected = kind === "weather" ? "application/json" : "text/plain";
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.includes(expected)
    )
      throw Error("Invalid source response");
    const raw = await boundedText(
      response,
      (kind === "weather" ? 8 : 15) * 1024 * 1024,
    );
    const parsed =
      kind === "weather"
        ? { records: await weatherRecords(raw, previous) }
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
