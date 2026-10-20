export function normalizeCompany(value) {
  return value
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function searchKnf(query, snapshot, now = Date.now()) {
  if (typeof query !== "string" || query.length > 160)
    throw Error("Invalid query");
  const q = normalizeCompany(query),
    digits = query.replace(/\D/g, "");
  const isIdentifier = /^(?:(?:KRS|NIP|REGON)\s*[:\-]?\s*)?[\d -]+$/i.test(
    query.trim(),
  );
  const identifierType = query.trim().match(/^(KRS|NIP|REGON)\b/i)?.[1].toUpperCase();
  if (
    (isIdentifier && ![9, 10, 14].includes(digits.length)) ||
    (isIdentifier && identifierType && !(identifierType === "REGON" ? [9,14] : [10]).includes(digits.length)) ||
    (!isIdentifier && (q.length < 4 || !/[a-z]/.test(q)))
  )
    throw Error("Invalid query");
  const age = now - Date.parse(snapshot?.fetched_at),
    fresh =
      Number.isFinite(age) &&
      age >= -300000 &&
      age < 36 * 3600000 &&
      snapshot?.last_attempt_outcome === "ok";
  const source = {
    name: "Komisja Nadzoru Finansowego",
    url: "https://www.knf.gov.pl/dla_konsumenta/ostrzezenia_publiczne",
    status: !snapshot?.fetched_at ? "unavailable" : fresh ? "fresh" : "stale",
    fetched_at: snapshot?.fetched_at ?? null,
    entry_count: snapshot?.entries?.length ?? 0,
  };
  const found = (snapshot?.entries ?? []).filter((e) => {
    if (!isIdentifier) return e.search.includes(q);
    if (!e.identifiers_search.includes(digits)) return false;
    if (!identifierType) return true;
    return [...e.identifiers.matchAll(/\b(KRS|NIP|REGON)\s*[:\-]?\s*(\d[\d -]{7,17}\d)/gi)].some(m => m[1].toUpperCase() === identifierType && m[2].replace(/\D/g, "") === digits);
  });
  return {
    verdict: !fresh ? "unknown" : found.length ? "matches" : "not_found",
    match_type: isIdentifier ? "identifier" : "text",
    total_matches: found.length,
    matches: found
      .slice(0, 10)
      .map(({ search, identifiers_search, ...entry }) => entry),
    source,
  };
}
