import { parse } from "parse5";
import { boundedText } from "../worker/http.mjs";
import { normalizeCompany } from "../worker/knf.mjs";
export const knfUrl =
  "https://www.knf.gov.pl/dla_konsumenta/ostrzezenia_publiczne";
function nodes(n, tag) {
  return [
    ...(n.nodeName === tag ? [n] : []),
    ...(n.childNodes ?? []).flatMap((c) => nodes(c, tag)),
  ];
}
function text(n) {
  if (["script", "style", "template"].includes(n.nodeName)) return "";
  if (n.nodeName === "#text") return n.value;
  if (n.nodeName === "br") return "\n";
  return (n.childNodes ?? [])
    .map(text)
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}
export function parseKnf(html) {
  const doc = parse(html),
    entries = [];
  const tables = nodes(doc, "table").filter((t) =>
    t.attrs?.some(
      (a) =>
        a.name === "class" &&
        a.value.split(/\s+/).includes("warning-list-table"),
    ),
  );
  if (!tables.length) throw Error("KNF table layout changed");
  for (const [category, table] of tables.entries()) {
    const headers = nodes(table, "th").map(text);
    if (
      headers.length !== 6 ||
      !headers[1].includes("Nazwa podmiotu") ||
      !headers[4].includes("orzeczeniach")
    )
      throw Error("KNF columns changed");
    for (const row of nodes(table, "tbody").flatMap((b) => nodes(b, "tr"))) {
      const cells = (row.childNodes ?? [])
        .filter((n) => n.nodeName === "td")
        .map(text);
      if (
        cells.length !== 6 ||
        !cells[1] ||
        cells.some((v) => v.length > 30000)
      )
        throw Error("Incomplete KNF entry");
      const [number, name, identifiers, prosecutor, judgments, notes] = cells;
      entries.push({
        id: `${category + 1}-${number.replace(/\D/g, "")}`,
        name,
        identifiers,
        prosecutor,
        judgments,
        notes,
        search: normalizeCompany(name),
        identifiers_search: [
          ...identifiers.matchAll(
            /\b(?:KRS|NIP|REGON)\s*[:\-]?\s*(\d[\d -]{7,17}\d)/g,
          ),
        ].map((m) => m[1].replace(/\D/g, "")),
      });
    }
  }
  const countText = nodes(doc, "p")
    .map(text)
    .find((t) => /^Liczba znalezionych ostrzeżeń\s*:/.test(t));
  const declared = Number(countText?.match(/:\s*(\d+)\s*$/)?.[1]);
  if (
    !declared ||
    entries.length !== declared ||
    entries.length < 100 ||
    entries.length > 10000
  )
    throw Error("Incomplete KNF list");
  return entries;
}
export async function refreshKnf(store, fetcher = fetch, now = Date.now()) {
  const previous = await store.get("knf"),
    at = new Date(now).toISOString();
  try {
    const response = await fetcher(knfUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/html")
    )
      throw Error("KNF unavailable");
    const entries = parseKnf(await boundedText(response, 4 * 1024 * 1024));
    await store.put(
      "knf",
      JSON.stringify({
        entries,
        fetched_at: at,
        last_attempt_at: at,
        last_attempt_outcome: "ok",
      }),
    );
    return true;
  } catch {
    await store.put(
      "knf",
      JSON.stringify({
        ...previous,
        last_attempt_at: at,
        last_attempt_outcome: "error",
      }),
    );
    return false;
  }
}
