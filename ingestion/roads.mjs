import { XMLParser, XMLValidator } from "fast-xml-parser";
import { hash, stamp } from "../worker/data.mjs";
import { regions } from "../worker/regions.mjs";
import { boundedText } from "../worker/http.mjs";
export const roadsUrl =
  "https://www.archiwum.gddkia.gov.pl/dane/zima_html/utrdane.xml";
const timestamp = (value) =>
  stamp(String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
export async function parseRoads(raw, now = Date.now()) {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true)
    throw Error("Invalid GDDKiA XML");
  const root = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    // DTD/entity declarations are rejected above; decode ordinary XML escapes.
    processEntities: true,
  }).parse(raw).utrudnienia;
  if (!root || !root["@_gen"])
    throw Error("Missing GDDKiA generation timestamp");
  const generated_at = timestamp(root["@_gen"]);
  if (
    Date.parse(generated_at) > now + 300000 ||
    now - Date.parse(generated_at) > 3600000
  )
    throw Error("GDDKiA source is not current");
  const list = root.utr
    ? Array.isArray(root.utr)
      ? root.utr
      : [root.utr]
    : [];
  if (list.length > 10000) throw Error("Too many road records");
  const events = [],
    ids = new Set();
  for (const x of list) {
    const region = Object.values(regions).find(
      ([name]) =>
        name.toLocaleLowerCase("pl") ===
        String(x.woj)
          .replace(/^woj\.\s*/, "")
          .trim()
          .toLocaleLowerCase("pl"),
    )?.[0];
    if (
      !region ||
      !["U", "W", "I", "K"].includes(x.typ) ||
      typeof x.nr_drogi !== "string" ||
      !x.nr_drogi ||
      typeof x.nazwa_odcinka !== "string"
    )
      throw Error("Invalid road record");
    const from = timestamp(x.data_powstania),
      planned = String(x.data_likwidacji || "").trim()
        ? timestamp(x.data_likwidacji)
        : null;
    const lng = Number(x.geo_long),
      lat = Number(x.geo_lat),
      coords =
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        lng >= 14 &&
        lng <= 24.5 &&
        lat >= 49 &&
        lat <= 55.2
          ? [lng, lat]
          : null;
    const closed = x.droga_zamknieta === "true";
    const type = closed
      ? "Zamknięcie drogi"
      : x.typ === "W"
        ? "Wypadek"
        : x.typ === "U"
          ? "Roboty drogowe"
          : x.typ === "K"
            ? "Zdarzenie drogowe"
            : "Utrudnienie";
    const id =
      "gddkia-" +
      (
        await hash(
          JSON.stringify([
            x.nr_drogi,
            x.woj,
            x.km,
            from,
            x.typ,
            x.nazwa_odcinka,
            x.objazd,
            x.geo_lat,
            x.geo_long,
          ]),
        )
      ).slice(0, 24);
    if (ids.has(id)) continue;
    ids.add(id);
    events.push({
      id,
      title: `${type} · ${x.nr_drogi} · ${x.nazwa_odcinka}`,
      category: "Infrastruktura",
      region,
      regions: [region],
      coords,
      locations: coords ? [{ region, coords }] : [],
      source: "GDDKiA",
      sourceId: "gddkia-roads",
      sourceUrl: "https://www.gov.pl/web/gddkia/dane-xml",
      summary: [x.nazwa_odcinka, String(x.objazd || "").trim()]
        .filter(Boolean)
        .join("\n\n"),
      status: closed ? "Droga zamknięta wg źródła" : type,
      action:
        "Sprawdź aktualny komunikat GDDKiA i oznakowanie na drodze. Planowana data zakończenia nie potwierdza przywrócenia przejazdu.",
      tone: "blue",
      isDemo: false,
      validFrom: from,
      plannedUntil: planned,
      revision: 1,
      severity: closed ? 3 : x.typ === "W" ? 2 : 1,
      time: "—",
      scope: `Droga ${x.nr_drogi}, km ${x.km}; ${x.nazwa_odcinka}. Punkt na mapie pochodzi ze źródła i nie wyznacza całego utrudnionego odcinka.`,
      generatedAt: generated_at,
    });
  }
  return { events, generated_at };
}
export async function refreshRoads(store, fetcher = fetch, now = Date.now()) {
  const previous = await store.get("roads"),
    at = new Date(now).toISOString();
  try {
    const r = await fetcher(roadsUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Error();
    const raw = await boundedText(r, 8 * 1024 * 1024);
    const parsed = await parseRoads(raw, now);
    await store.put(
      "roads",
      JSON.stringify({
        ...parsed,
        fetched_at: at,
        last_attempt_at: at,
        last_attempt_outcome: "ok",
      }),
    );
    return true;
  } catch {
    await store.put(
      "roads",
      JSON.stringify({
        ...previous,
        last_attempt_at: at,
        last_attempt_outcome: "error",
      }),
    );
    return false;
  }
}
