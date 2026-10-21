import {boundedText} from "../worker/http.mjs";
export const aviationUrl="https://api.adsb.lol/v2/point/52.05/19.4/250";
export const sourceAgent="OSSA/0.8 (+https://ossa.watch; https://github.com/JaxonNkl/ossa-data)";
export function parseAviation(body,now=Date.now()) {
 if(!Array.isArray(body?.ac)||body.ac.length>10000||!Number.isFinite(body.now)||Math.abs(body.now-now)>120000)throw Error("Invalid ADS-B snapshot time or shape");
 const aircraft=new Map();
 for(const item of body.ac){
  const {lat,lon,seen_pos}=item;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(seen_pos)||seen_pos<0||seen_pos>120||lat<48||lat>56||lon<12||lon>27)continue;
  if(!/^[a-f0-9]{6}$/i.test(item.hex??""))continue;
  const observed_at=new Date(body.now-seen_pos*1000).toISOString();
  const row={id:item.hex.toLowerCase(),latitude:lat,longitude:lon,observed_at,callsign:typeof item.flight==="string"?item.flight.trim().slice(0,20):null,aircraft_type:typeof item.t==="string"?item.t.slice(0,12):null,registration:typeof item.r==="string"?item.r.slice(0,20):null,altitude_ft:Number.isFinite(item.alt_baro)?item.alt_baro:null,speed_knots:Number.isFinite(item.gs)?item.gs:null,track:Number.isFinite(item.track)?item.track:null};
  aircraft.set(row.id,row);
 }
 const rows=[...aircraft.values()].sort((a,b)=>a.id.localeCompare(b.id));
 return {aircraft:rows.slice(0,600),truncated:rows.length>600,observed_at:new Date(body.now).toISOString()};
}
export async function refreshAviation(previous,fetcher=fetch,now=Date.now()) {
 const at=new Date(now).toISOString();
 try{
  const r=await fetcher(aviationUrl,{headers:{"User-Agent":sourceAgent},redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!r.ok||!r.headers.get("content-type")?.includes("application/json"))throw Error("ADS-B unavailable");
  return {...parseAviation(JSON.parse(await boundedText(r,4*1024*1024)),now),fetched_at:at,last_attempt_at:at,last_attempt_outcome:"ok"};
 }catch{return {...previous,last_attempt_at:at,last_attempt_outcome:"error"};}
}
