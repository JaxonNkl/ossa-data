import {parse} from "parse5";
import {boundedText} from "../worker/http.mjs";
export const paaUrl="https://www.gov.pl/web/paa/aktualnosci2";
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value;
const nodes=(n,p)=>[...(p(n)?[n]:[]),...(n.childNodes??[]).flatMap(c=>nodes(c,p))];
const text=n=>n.nodeName==="#text"?n.value:["script","style"].includes(n.nodeName)?"":(n.childNodes??[]).map(text).join(" ").replace(/\s+/g," ").trim();
export function paaPublications(html,now=Date.now()) {
 const result=new Map();
 for(const li of nodes(parse(html),n=>n.nodeName==="li")) {
  const dateNode=nodes(li,n=>(attr(n,"class")??"").split(/\s+/).includes("date"))[0];
  const anchor=nodes(li,n=>n.nodeName==="a"&&/^\/web\/paa\/[^/?#]+$/.test(attr(n,"href")??""))[0];
  if(!dateNode||!anchor)continue;
  const m=text(dateNode).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(!m)throw Error("Invalid PAA date");
  const published_date=`${m[3]}-${m[2]}-${m[1]}`,at=Date.parse(published_date+"T00:00:00Z");
  if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==published_date)throw Error("Invalid PAA date");
  const title=text(anchor);
  if(!title||title.length>1000)throw Error("Invalid PAA title");
  if(at>now)continue;
  const url=new URL(attr(anchor,"href"),paaUrl).href;
  result.set(url,{url,title,published_date});
 }
 if(!result.size)throw Error("Unrecognized PAA publication list");
 return [...result.values()].sort((a,b)=>b.published_date.localeCompare(a.published_date)).slice(0,6);
}
export async function refreshPaa(previous,fetcher=fetch,now=Date.now()) {
 const last=Date.parse(previous?.last_attempt_at);
 if(Number.isFinite(last)&&now>=last&&now-last<3600000)return previous;
 const at=new Date(now).toISOString();
 try {
  const response=await fetcher(paaUrl,{redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok||!response.headers.get("content-type")?.includes("text/html"))throw Error("PAA unavailable");
  const publications=paaPublications(await boundedText(response,3*1024*1024),now);
  return {publications,fetched_at:at,last_attempt_at:at,last_attempt_outcome:"ok"};
 }catch {return {...previous,last_attempt_at:at,last_attempt_outcome:"error"};}
}
