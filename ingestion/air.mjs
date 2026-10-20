import { stamp } from "../worker/data.mjs";
import { regions } from "../worker/regions.mjs";
import { boundedText } from "../worker/http.mjs";
const base = "https://api.gios.gov.pl/pjp-api/v1/rest/";
export function latestMeasurement(rows, now) {
  if (!Array.isArray(rows)) throw Error("Invalid GIOS measurements");
  return (
    rows
      .flatMap((row) => {
        if (
          typeof row["Wartość"] !== "number" ||
          !Number.isFinite(row["Wartość"]) ||
          row["Wartość"] < 0
        )
          return [];
        const at = stamp(row.Data);
        return Date.parse(at) <= now
          ? [{ value: row["Wartość"], measured_at: at }]
          : [];
      })
      .sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0] ?? null
  );
}
export function indexReading(data, now) {
  const x = data?.AqIndex;
  if (
    !x ||
    !Number.isInteger(x["Wartość indeksu"]) ||
    x["Wartość indeksu"] < 0 ||
    x["Wartość indeksu"] > 5 ||
    typeof x["Nazwa kategorii indeksu"] !== "string" ||
    x["Status indeksu ogólnego dla stacji pomiarowej"] !== true
  )
    return null;
  const at = stamp(
    x[
      "Data danych źródłowych, z których policzono wartość indeksu dla wskaźnika st"
    ],
  );
  return Date.parse(at) <= now
    ? {
        level: x["Wartość indeksu"],
        label: x["Nazwa kategorii indeksu"],
        measured_at: at,
      }
    : null;
}
export async function refreshAir(store, fetcher = fetch, now = Date.now()) {
  const budget = AbortSignal.timeout(150000);
  const previous = await store.get("air"),
    at = new Date(now).toISOString();
  async function get(path) {
    const response = await fetcher(base + path, {
      signal: AbortSignal.any([budget, AbortSignal.timeout(12000)]),
      redirect: "error",
    });
    if (
      !response.ok ||
      !/application\/(?:ld\+)?json/.test(
        response.headers.get("content-type") || "",
      )
    )
      throw Error("Invalid GIOS response");
    return JSON.parse(await boundedText(response, 4 * 1024 * 1024));
  }
  try {
    const metadata = await get("station/findAll?size=500");
    const list = metadata["Lista stacji pomiarowych"];
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.length > 500 ||
      metadata.totalPages !== 1
    )
      throw Error("Incomplete GIOS station list");
    const stations = new Array(list.length);
    let cursor = 0,
      successful = 0,
      failures = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (cursor < list.length) {
            const i = cursor++,
            raw = list[i],
            id = raw["Identyfikator stacji"];
          const region = Object.values(regions).find(
            ([name]) =>
              name.toLocaleLowerCase("pl") ===
              String(raw["Województwo"]).toLocaleLowerCase("pl"),
          )?.[0];
          if (
            !Number.isInteger(id) ||
            !region ||
            typeof raw["Nazwa stacji"] !== "string"
          )
            throw Error("Invalid GIOS station");
          const station = {
            id,
            name: raw["Nazwa stacji"],
            region,
            city: raw["Nazwa miasta"],
            index: null,
            pm10: null,
            pm25: null,
            failed: false,
          };
          try {
            station.index = indexReading(
              await get(`aqindex/getIndex/${id}`),
              now,
            );
            const sensors = (await get(`station/sensors/${id}?size=100`))[
              "Lista stanowisk pomiarowych dla podanej stacji"
            ];
            if (!Array.isArray(sensors)) throw Error("Invalid GIOS sensors");
            for (const [code, key] of [
              ["PM10", "pm10"],
              ["PM2.5", "pm25"],
            ]) {
              const sensor = sensors.find((x) => x["Wskaźnik - kod"] === code);
              if (
                sensor &&
                Number.isInteger(sensor["Identyfikator stanowiska"])
              ) {
                const data = await get(
                  `data/getData/${sensor["Identyfikator stanowiska"]}?size=100`,
                );
                station[key] = latestMeasurement(
                  data["Lista danych pomiarowych"],
                  now,
                );
              }
            }
            successful++;
          } catch {
            failures++;
            const old = previous?.stations?.find((x) => x.id === id);
            if (old)
              Object.assign(station, {
                index: old.index,
                pm10: old.pm10,
                pm25: old.pm25,
              });
            station.failed = true;
          }
          stations[i] = station;
        }
      }),
    );
    if (!successful) throw Error("All GIOS stations unavailable");
    await store.put(
      "air",
      JSON.stringify({
        stations,
        fetched_at: at,
        last_attempt_at: at,
        last_attempt_outcome: failures ? "error" : "ok",
        failed_stations: failures,
      }),
    );
    return true;
  } catch {
    await store.put(
      "air",
      JSON.stringify({
        ...previous,
        last_attempt_at: at,
        last_attempt_outcome: "error",
      }),
    );
    console.error("GIOS update failed; retaining previous snapshot");
    return false;
  }
}
