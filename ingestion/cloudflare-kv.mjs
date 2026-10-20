import { certShards } from "../worker/data.mjs";

export class CloudflareKV {
  constructor({ accountId, namespaceId, token, fetcher = fetch }) {
    if (
      !/^[a-f0-9]{32}$/.test(accountId || "") ||
      !/^[a-f0-9]{32}$/.test(namespaceId || "") ||
      !token
    )
      throw Error("Missing Cloudflare configuration");
    this.base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
    this.token = token;
    this.fetcher = fetcher;
  }
  async request(path, options = {}, allowMissing = false) {
    const response = await this.fetcher(this.base + path, {
      ...options,
      signal: AbortSignal.timeout(25000),
      redirect: "error",
      headers: { ...options.headers, Authorization: `Bearer ${this.token}` },
    });
    if (allowMissing && response.status === 404) return null;
    // Never include credentials, API response bodies or headers in logs.
    if (!response.ok)
      throw Error(`Cloudflare KV request failed (HTTP ${response.status})`);
    return response;
  }
  async get(kind) {
    const key =
      kind === "cert"
        ? "ossa:cert:meta"
        : kind === "roads"
          ? "ossa:roads"
          : kind === "air"
            ? "ossa:air"
            : kind === "news"
              ? "ossa:news"
              : "ossa:weather";
    const response = await this.request(
      `/values/${encodeURIComponent(key)}`,
      {},
      true,
    );
    return response ? response.json() : null;
  }
  async put(kind, text) {
    let snapshot = JSON.parse(text);
    if (kind === "cert" && snapshot.domains) {
      const version = crypto.randomUUID();
      const shards = certShards(snapshot.domains, version);
      const items = shards.map((value, index) => ({
        key: `ossa:cert:${version}:${index}`,
        value: JSON.stringify(value),
        expiration_ttl: 14400,
      }));
      if (items.some((x) => Buffer.byteLength(x.value) > 1024 * 1024))
        throw Error("CERT shard exceeds the Free runtime size budget");
      const result = await this.request("/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      const body = await result.json();
      if (
        !body.success ||
        body.unsuccessful_keys?.length ||
        body.result?.unsuccessful_keys?.length
      )
        throw Error("Incomplete CERT shard publication");
      const { domains, ...metadata } = snapshot;
      snapshot = { ...metadata, version, shard_count: 8 };
    }
    const key =
      kind === "cert"
        ? "ossa:cert:meta"
        : kind === "roads"
          ? "ossa:roads"
          : kind === "air"
            ? "ossa:air"
            : kind === "news"
              ? "ossa:news"
              : "ossa:weather";
    const result = await this.request(`/values/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const body = await result.json();
    if (!body.success) throw Error("Snapshot publication failed");
  }
}
