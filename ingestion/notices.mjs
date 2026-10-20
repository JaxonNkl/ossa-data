import { XMLParser, XMLValidator } from "fast-xml-parser";
import { hash } from "../worker/data.mjs";

function plain(value) {
  if (typeof value !== "string" || value.length > 200000)
    throw Error("Invalid RSS text");
  return value
    .replace(/<(script|style|table)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export async function parseNotices(raw, now = Date.now()) {
  if (
    !raw ||
    Buffer.byteLength(raw) > 5 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(raw) ||
    XMLValidator.validate(raw) !== true
  )
    throw Error("Invalid RSS document");
  const data = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === "item" || name === "category",
  }).parse(raw);
  const channel = data?.rss?.channel;
  if (
    !channel ||
    typeof channel.title !== "string" ||
    !Array.isArray(channel.item) ||
    channel.item.length > 1000
  )
    throw Error("Unrecognized CERT RSS");
  const notices = new Map();
  for (const item of channel.item) {
    if (!item.category?.includes("Dla użytkowników")) continue;
    const title = plain(item.title);
    if (!title || title.length > 500 || typeof item.link !== "string")
      throw Error("Invalid CERT notice");
    const link = new URL(item.link);
    if (
      link.protocol !== "https:" ||
      link.hostname !== "moje.cert.pl" ||
      link.username ||
      link.password ||
      link.port ||
      !link.pathname.startsWith("/komunikaty/")
    )
      throw Error("Untrusted notice URL");
    if (
      typeof item.pubDate !== "string" ||
      !/(?:GMT|[+-]\d{4})$/.test(item.pubDate)
    )
      throw Error("Missing publication timezone");
    const at = Date.parse(item.pubDate);
    if (!Number.isFinite(at) || at > now + 300000)
      throw Error("Invalid publication date");
    if (now - at > 30 * 86400000) continue;
    const original = plain(item.description);
    const summary =
      original.length > 260 ? original.slice(0, 257).trimEnd() + "…" : original;
    const id = "cert-notice-" + (await hash(link.href)).slice(0, 24);
    const notice = {
      id,
      title,
      summary,
      url: link.href,
      published_at: new Date(at).toISOString(),
      source: "CERT Polska",
      category: "Dla użytkowników",
    };
    if (
      notices.has(id) &&
      JSON.stringify(notices.get(id)) !== JSON.stringify(notice)
    )
      throw Error("Conflicting notices");
    notices.set(id, notice);
  }
  return [...notices.values()]
    .sort(
      (a, b) =>
        b.published_at.localeCompare(a.published_at) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 12);
}
