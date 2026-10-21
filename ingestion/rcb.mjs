import { parse } from "parse5";
import { boundedText } from "../worker/http.mjs";
const origin = "https://www.gov.pl",
  listUrl = origin + "/web/rcb/komunikaty";
const attr = (node, key) => node.attrs?.find((x) => x.name === key)?.value;
const hasClass = (node, name) =>
  (attr(node, "class") ?? "").split(/\s+/).includes(name);
function nodes(root, predicate) {
  const out = [];
  function walk(x) {
    if (predicate(x)) out.push(x);
    for (const child of x.childNodes ?? []) walk(child);
  }
  walk(root);
  return out;
}
function text(node) {
  if (["script", "style", "noscript", "template"].includes(node.nodeName))
    return "";
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? [])
    .map(text)
    .join(["p", "div", "li", "br"].includes(node.nodeName) ? "\n" : " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
function date(value) {
  const m = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw Error("Invalid RCB date");
  const out = `${m[3]}-${m[2]}-${m[1]}`;
  if (new Date(out + "T12:00:00Z").toISOString().slice(0, 10) !== out)
    throw Error("Invalid RCB date");
  return out;
}
export function rcbLinks(html, now = Date.now()) {
  const doc = parse(html),
    result = new Map();
  for (const li of nodes(doc, (x) => x.nodeName === "li")) {
    const anchor = nodes(
      li,
      (x) =>
        x.nodeName === "a" &&
        /^\/web\/rcb\/alert-rcb-/.test(attr(x, "href") ?? ""),
    )[0];
    const when = nodes(li, (x) => hasClass(x, "date"))[0];
    if (!anchor || !when) continue;
    const published_date = date(text(when)),
      at = Date.parse(published_date + "T00:00:00Z");
    if (at > now || now - at > 7 * 86400000) continue;
    const url = new URL(attr(anchor, "href"), origin);
    if (url.origin !== origin || url.search || url.hash)
      throw Error("Invalid RCB URL");
    result.set(url.href, {
      url: url.href,
      title: text(anchor),
      published_date,
    });
  }
  if (!result.size) throw Error("No recent RCB publications found");
  return [...result.values()].slice(0, 10);
}
export function rcbArticle(html, item) {
  const doc = parse(html),
    article = nodes(
      doc,
      (x) => x.nodeName === "article" && attr(x, "id") === "main-content",
    )[0];
  if (!article) throw Error("RCB article layout changed");
  const titleNode = nodes(article, (x) => x.nodeName === "h2")[0],
    dateNode = nodes(article, (x) => hasClass(x, "event-date"))[0],
    bodyNode = nodes(article, (x) => hasClass(x, "editor-content"))[0];
  if (
    !titleNode ||
    !dateNode ||
    !bodyNode ||
    date(text(dateNode)) !== item.published_date
  )
    throw Error("Incomplete RCB article");
  const title = text(titleNode),
    body = text(bodyNode);
  if (!body || body.length > 100000 || !/^Alert RCB/i.test(title))
    throw Error("Invalid RCB article");
  return {
    ...item,
    title,
    excerpt: body.slice(0, 1400),
    kind: /ćwicze|trening/i.test(title)
      ? "exercise"
      : /odwołan|zakończył|brak zagrożenia/i.test(body)
        ? "updated"
        : "publication",
    validity: "unconfirmed",
  };
}
export async function refreshRcb(previous, fetcher = fetch, now = Date.now()) {
  const budget = AbortSignal.timeout(60000);
  async function html(url) {
    const r = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.any([budget, AbortSignal.timeout(15000)]),
    });
    if (!r.ok || !r.headers.get("content-type")?.includes("text/html"))
      throw Error("RCB source unavailable");
    return boundedText(r, 3 * 1024 * 1024);
  }
  const at = new Date(now).toISOString();
  try {
    const items = rcbLinks(await html(listUrl), now),
      publications = [];
    let unavailable_count = 0;
    for (const item of items) {
      try {
        publications.push(rcbArticle(await html(item.url), item));
      } catch {
        unavailable_count++;
      }
    }
    // Never let one broken source link discard the other verified articles.
    // If nothing was readable, preserve the previous snapshot and its timestamp.
    if (!publications.length) throw Error("All RCB articles unavailable");
    return {
      unavailable_count,
      publications,
      fetched_at: at,
      last_attempt_at: at,
      last_attempt_outcome: "ok",
    };
  } catch {
    return { ...previous, last_attempt_at: at, last_attempt_outcome: "error" };
  }
}
export { listUrl as rcbUrl };
