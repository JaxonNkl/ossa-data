import { regions } from "./regions.mjs";
export const urls = {
  weather: "https://danepubliczne.imgw.pl/api/data/warningsmeteo",
  hydro: "https://danepubliczne.imgw.pl/api/data/warningshydro",
  cert: "https://hole.cert.pl/domains/v2/domains.txt",
  news: "https://moje.cert.pl/advisories/feed/",
};
export const attribution =
  "Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy.";
export const processing =
  "Dane Instytutu Meteorologii i Gospodarki Wodnej – Państwowego Instytutu Badawczego zostały przetworzone.";
export async function hash(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export function hostname(value) {
  if (typeof value !== "string") throw Error("Niepoprawny adres.");
  value = value.trim();
  if (!value || value.length > 2048 || /[\s\\\x00-\x1f]/u.test(value))
    throw Error("Niepoprawny adres.");
  if (
    (value.includes("://") ? value.split("://")[1] : value)
      .split(/[/?#]/)[0]
      .includes("@")
  )
    throw Error("Niepoprawny adres.");
  const url = new URL(value.includes("://") ? value : "https://" + value);
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !host.includes(".") ||
    host.length > 253 ||
    /^[\d.]+$/.test(host) ||
    !host
      .split(".")
      .every((x) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))
  )
    throw Error(
      "Podaj domenę lub adres HTTP/HTTPS. Adresy IP nie są obsługiwane.",
    );
  return host;
}
export function certDomains(raw) {
  const domains = new Set();
  for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    if (
      /[/:@?#]/.test(value) ||
      hostname(value) !== value.toLowerCase().replace(/\.$/, "")
    )
      throw Error("Invalid CERT format");
    domains.add(hostname(value));
  }
  if (!domains.size) throw Error("Empty CERT snapshot");
  return {
    domains: "\n" + [...domains].sort().join("\n") + "\n",
    domain_count: domains.size,
  };
}
const polish = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function stamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?$/.test(
      value,
    )
  )
    throw Error("Invalid timestamp");
  const [year, month, day, hour, minute, second = 0] = value
    .split(/\D/)
    .map(Number);
  const calendar = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second),
  );
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    throw Error("Invalid timestamp");
  if (/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    const date = new Date(value);
    if (!Number.isFinite(+date)) throw Error("Invalid timestamp");
    return date.toISOString();
  }
  const local = value.replace(" ", "T");
  const wall = Date.parse(local + "Z");
  let instant = wall;
  for (let i = 0; i < 3; i++) {
    const displayed = Date.parse(
      polish.format(new Date(instant)).replace(" ", "T") + "Z",
    );
    instant += wall - displayed;
  }
  if (
    polish.format(new Date(instant)).replace(" ", "T").slice(0, 16) !==
    local.slice(0, 16)
  )
    throw Error("Invalid local timestamp");
  return new Date(instant).toISOString();
}
export async function weatherRecords(raw, previous = null) {
  const data = JSON.parse(raw);
  if (
    JSON.stringify(data) ===
    JSON.stringify({ message: "Brak ostrzeżeń meteorologicznych" })
  )
    return [];
  if (!Array.isArray(data) || data.length > 10000)
    throw Error("Invalid IMGW response");
  const result = new Map();
  for (const original of data) {
    if (!original || typeof original !== "object")
      throw Error("Invalid warning");
    const {
      nazwa_zdarzenia: title,
      tresc: summary,
      stopien: level,
      teryt,
    } = original;
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 500 ||
      typeof summary !== "string" ||
      !summary.trim() ||
      summary.length > 30000 ||
      !["1", "2", "3"].includes(String(level)) ||
      !Array.isArray(teryt) ||
      !teryt.length ||
      !teryt.every((x) => typeof x === "string" && /^\d{4,7}$/.test(x))
    )
      throw Error("Invalid warning");
    const validFrom = stamp(original.obowiazuje_od),
      validTo = stamp(original.obowiazuje_do);
    if (validTo <= validFrom) throw Error("Invalid warning validity");
    const areaCodes = [...new Set(teryt)].sort();
    const locations = [...new Set(areaCodes.map((x) => x.slice(0, 2)))]
      .sort()
      .filter((x) => regions[x])
      .map((x) => ({ region: regions[x][0], coords: regions[x][1] }));
    const id =
      "imgw-" +
      (
        await hash(
          original.id
            ? String(original.id)
            : JSON.stringify([title.trim(), validFrom, areaCodes]),
        )
      ).slice(0, 24);
    const fingerprint = await hash(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(original).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
    if (result.has(id) && result.get(id).fingerprint !== fingerprint)
      throw Error("Conflicting duplicates");
    const old = previous?.records?.find((x) => x.event.id === id);
    const revision =
      (old?.event.revision || 0) + (old?.fingerprint === fingerprint ? 0 : 1);
    const publishedAt = original.opublikowano
      ? stamp(original.opublikowano)
      : null;
    const event = {
      id,
      title: title.trim(),
      summary: summary.trim(),
      category: "Komunikaty",
      region:
        locations.map((x) => x.region).join(", ") || "Obszar nieprzypisany",
      regions: locations.map((x) => x.region),
      locations,
      coords: locations[0]?.coords || null,
      source: "IMGW-PIB",
      sourceId: "imgw-meteo",
      sourceUrl: urls.weather,
      status: `Stopień ${level} / 3 · IMGW`,
      severity: Number(level),
      tone: "amber",
      isDemo: false,
      validFrom,
      validTo,
      publishedAt,
      areaCodes,
      revision,
      time: publishedAt
        ? new Intl.DateTimeFormat("pl-PL", {
            timeZone: "Europe/Warsaw",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(publishedAt))
        : "—",
      action:
        "Przeczytaj pełną treść ostrzeżenia IMGW-PIB i stosuj się do lokalnych komunikatów służb.",
      scope:
        "Ostrzeżenie dotyczy powiatów wskazanych kodami TERYT: " +
        areaCodes.join(", ") +
        ". Znaczniki na mapie wskazują województwa, nie dokładny obszar ostrzeżenia.",
      evidenceUrl: `/api/backend/v1/events/${id}/evidence`,
    };
    result.set(id, { event, original, fingerprint });
  }
  return [...result.values()];
}
export async function hydroRecords(raw, previous = null) {
  const data = JSON.parse(raw);
  if (
    data?.message === "Brak ostrzeżeń hydrologicznych" &&
    Object.keys(data).length === 1
  )
    return [];
  if (!Array.isArray(data) || data.length > 10000)
    throw Error("Invalid hydro response");
  const result = new Map();
  for (const original of data) {
    const {
      zdarzenie: title,
      przebieg,
      komentarz = "",
      obszary,
      numer,
      biuro,
    } = original ?? {};
    const level = String(original?.["stopień"] ?? original?.stopien);
    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 500 ||
      typeof przebieg !== "string" ||
      !przebieg.trim() ||
      przebieg.length > 30000 ||
      typeof komentarz !== "string" ||
      komentarz.length > 30000 ||
      !["-1", "1", "2", "3"].includes(level) ||
      (level === "-1" && !/susza/i.test(title)) ||
      !Array.isArray(obszary) ||
      !obszary.length ||
      !numer ||
      typeof biuro !== "string"
    )
      throw Error("Invalid hydro warning");
    const locations = [],
      areaCodes = [],
      descriptions = [];
    for (const area of obszary) {
      if (
        typeof area.wojewodztwo !== "string" ||
        typeof area.opis !== "string" ||
        !area.opis.trim() ||
        !Array.isArray(area.kod_zlewni) ||
        !area.kod_zlewni.length ||
        !area.kod_zlewni.every(
          (x) => typeof x === "string" && /^[A-Za-z0-9_]+$/.test(x),
        )
      )
        throw Error("Invalid hydro area");
      const region = Object.values(regions).find(
        ([name]) =>
          name.toLocaleLowerCase("pl") ===
          area.wojewodztwo.trim().toLocaleLowerCase("pl"),
      );
      if (!region) throw Error("Unknown hydro region");
      if (!locations.some((x) => x.region === region[0]))
        locations.push({ region: region[0], coords: region[1] });
      descriptions.push(area.opis.trim());
      areaCodes.push(...area.kod_zlewni);
    }
    const validFrom = stamp(original.data_od);
    const untilRevoked = original.data_do === "9999-12-31 23:59:59";
    const validTo = untilRevoked ? undefined : stamp(original.data_do);
    if (validTo && validTo <= validFrom) throw Error("Invalid hydro validity");
    const publishedAt = stamp(original.opublikowano);
    const id =
      "imgw-hydro-" +
      (
        await hash(
          JSON.stringify([biuro, String(numer), publishedAt.slice(0, 4)]),
        )
      ).slice(0, 24);
    const fingerprint = await hash(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(original).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    );
    if (result.has(id) && result.get(id).fingerprint !== fingerprint)
      throw Error("Conflicting hydro duplicates");
    const old = previous?.records?.find((x) => x.event.id === id);
    const event = {
      id,
      title: title.trim(),
      summary: [przebieg.trim(), komentarz.trim()].filter(Boolean).join("\n\n"),
      category: "Komunikaty",
      source: "IMGW-PIB",
      sourceId: "imgw-hydro",
      sourceUrl: urls.hydro,
      region: locations.map((x) => x.region).join(", "),
      regions: locations.map((x) => x.region),
      locations,
      coords: locations[0].coords,
      status:
        level === "-1"
          ? "Susza hydrologiczna · IMGW"
          : `Stopień ${level} / 3 · IMGW`,
      severity: level === "-1" ? 0 : Number(level),
      tone: "blue",
      isDemo: false,
      validFrom,
      validTo,
      untilRevoked,
      publishedAt,
      areaCodes: [...new Set(areaCodes)].sort(),
      revision:
        (old?.event.revision || 0) + (old?.fingerprint === fingerprint ? 0 : 1),
      time: new Intl.DateTimeFormat("pl-PL", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(publishedAt)),
      action:
        "Przeczytaj pełne ostrzeżenie IMGW-PIB i stosuj się do oficjalnych komunikatów lokalnych służb.",
      scope:
        descriptions.join("; ") +
        ". Znaczniki wskazują województwa, nie granice zlewni ani obszary zalania.",
      evidenceUrl: `/api/backend/v1/events/${id}/evidence`,
    };
    result.set(id, { event, original, fingerprint });
  }
  return [...result.values()];
}
export function status(kind, snapshot, now = Date.now()) {
  if (kind === "roads") {
    const at =
      snapshot?.generated_at && snapshot?.fetched_at
        ? Math.min(
            Date.parse(snapshot.generated_at),
            Date.parse(snapshot.fetched_at),
          )
        : null;
    const age = at === null ? null : (now - at) / 1000;
    return {
      id: "gddkia-roads",
      name: "GDDKiA — utrudnienia drogowe",
      status: age === null ? "unavailable" : age < 1800 ? "fresh" : "stale",
      fetched_at: at === null ? null : new Date(at).toISOString(),
      fresh_for_seconds: 1800,
      last_attempt_outcome: snapshot?.last_attempt_outcome ?? null,
      generated_at: snapshot?.generated_at ?? null,
    };
  }
  if (kind === "paa") {
    const age=snapshot?.fetched_at?(now-Date.parse(snapshot.fetched_at))/1000:null;
    return {id:"paa-publications",name:"Państwowa Agencja Atomistyki",status:age===null?"unavailable":age>=0&&age<7200?"fresh":"stale",fetched_at:snapshot?.fetched_at??null,fresh_for_seconds:7200,last_attempt_outcome:snapshot?.last_attempt_outcome??null};
  }
  if (kind === "rcb") {
    const age = snapshot?.fetched_at
      ? (now - Date.parse(snapshot.fetched_at)) / 1000
      : null;
    return {
      unavailable_count: snapshot?.unavailable_count ?? 0,
      id: "rcb-publications",
      name: "Rządowe Centrum Bezpieczeństwa",
      status: age === null ? "unavailable" : age < 3600 ? "fresh" : "stale",
      fetched_at: snapshot?.fetched_at ?? null,
      fresh_for_seconds: 3600,
      last_attempt_outcome: snapshot?.last_attempt_outcome ?? null,
    };
  }
  if (kind === "air") {
    const age = snapshot?.fetched_at
      ? (now - Date.parse(snapshot.fetched_at)) / 1000
      : null;
    return {
      id: "gios-air",
      name: "GIOŚ — jakość powietrza",
      status: age === null ? "unavailable" : age < 7200 ? "fresh" : "stale",
      fetched_at: snapshot?.fetched_at ?? null,
      fresh_for_seconds: 7200,
      last_attempt_outcome: snapshot?.last_attempt_outcome ?? null,
    };
  }
  if (kind === "news") {
    const age = snapshot?.fetched_at
      ? Math.max(0, Math.floor((now - Date.parse(snapshot.fetched_at)) / 1000))
      : null;
    return {
      id: "cert-pl-notices",
      name: "CERT Polska — komunikaty dla użytkowników",
      url: urls.news,
      status: age === null ? "unavailable" : age < 7200 ? "fresh" : "stale",
      fetched_at: snapshot?.fetched_at || null,
      age_seconds: age,
      fresh_for_seconds: 7200,
      last_attempt_at: snapshot?.last_attempt_at || null,
      last_attempt_outcome: snapshot?.last_attempt_outcome || null,
      sha256: snapshot?.sha256 || null,
      notice_count: snapshot?.notices?.length || 0,
      attribution: "CERT Polska / NASK-PIB",
      license: "CC BY-SA 4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      processing:
        "Skróty z oficjalnego RSS; pominięto formatowanie HTML i załączniki.",
    };
  }
  const fresh = kind === "cert" ? 3600 : 1200;
  const age = snapshot?.fetched_at
    ? Math.max(0, Math.floor((now - Date.parse(snapshot.fetched_at)) / 1000))
    : null;
  return {
    id:
      kind === "cert"
        ? "cert-pl-domains"
        : kind === "hydro"
          ? "imgw-hydro"
          : "imgw-meteo",
    name:
      kind === "cert"
        ? "CERT Polska — Lista Ostrzeżeń"
        : kind === "hydro"
          ? "IMGW-PIB — ostrzeżenia hydrologiczne"
          : "IMGW-PIB — ostrzeżenia meteorologiczne",
    url: urls[kind],
    status: age === null ? "unavailable" : age < fresh ? "fresh" : "stale",
    fetched_at: snapshot?.fetched_at || null,
    sha256: snapshot?.sha256 || null,
    age_seconds: age,
    fresh_for_seconds: fresh,
    last_attempt_at: snapshot?.last_attempt_at || null,
    last_attempt_outcome: snapshot?.last_attempt_outcome || null,
    ...(kind === "cert"
      ? { domain_count: snapshot?.domain_count || 0 }
      : {
          event_count: snapshot?.records?.length || 0,
          attribution,
          processing,
        }),
  };
}
export function checkDomain(domain, snapshot, now = Date.now()) {
  const source = status("cert", snapshot, now);
  const labels = domain.split(".");
  let matched = null;
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = labels.slice(i).join(".");
    if (snapshot?.domains?.includes("\n" + suffix + "\n")) {
      matched = suffix;
      break;
    }
  }
  return {
    domain,
    source,
    verdict:
      source.status !== "fresh" ? "unknown" : matched ? "listed" : "not_listed",
    matched_domain: matched,
    checked_at: new Date(now).toISOString(),
  };
}

// Every possible listed suffix of a hostname shares its last two labels.
// This makes one small KV shard sufficient even for deeply nested subdomains.
export function certBucket(domain) {
  const group = domain.split(".").slice(-2).join(".");
  let value = 2166136261;
  for (let i = 0; i < group.length; i++)
    value = Math.imul(value ^ group.charCodeAt(i), 16777619);
  return (value >>> 0) % 8;
}

export function certShards(domains, version) {
  const values = Array.from({ length: 8 }, () => []);
  for (const domain of domains.trim().split("\n"))
    values[certBucket(domain)].push(domain);
  return values.map((value) => ({
    version,
    domains: "\n" + value.join("\n") + "\n",
  }));
}
