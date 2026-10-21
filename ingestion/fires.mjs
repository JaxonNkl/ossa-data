import {boundedText} from "../worker/http.mjs";
export const firesUrl="https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv";
export function parseFires(raw,now=Date.now()) {
 const lines=raw.trim().split(/\r?\n/);if(lines.length>100001)throw Error("FIRMS file too large");
 const header=lines.shift().split(",");
 for(const key of ["latitude","longitude","acq_date","acq_time","confidence","satellite"])if(!header.includes(key))throw Error("Invalid FIRMS header");
 const detections=new Map();let latest=-Infinity;
 for(const line of lines){if(!line.trim())continue;const values=line.split(",");if(values.length!==header.length)throw Error("Invalid FIRMS row");
  const row=Object.fromEntries(header.map((key,i)=>[key,values[i]]));
  const lat=Number(row.latitude),lon=Number(row.longitude),hhmm=row.acq_time.padStart(4,"0");
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.acq_date)||!/^\d{4}$/.test(hhmm)||Number(hhmm.slice(0,2))>23||Number(hhmm.slice(2))>59||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error("Invalid FIRMS observation");
  const observed_at=`${row.acq_date}T${hhmm.slice(0,2)}:${hhmm.slice(2)}:00.000Z`,at=Date.parse(observed_at);
  if(!Number.isFinite(at)||new Date(at).toISOString()!==observed_at||at>now+300000)throw Error("Invalid FIRMS observation time");
  latest=Math.max(latest,at);
  if(at<now-86400000||lat<48||lat>56||lon<12||lon>32||!["nominal","high","n","h"].includes(row.confidence))continue;
  const id=`${row.satellite}-${row.latitude}-${row.longitude}-${at}`;
  detections.set(id,{id,latitude:lat,longitude:lon,observed_at,confidence:row.confidence,satellite:row.satellite});
 }
 if(!Number.isFinite(latest)||latest<now-86400000)throw Error("FIRMS source is not current");
 const items=[...detections.values()].sort((a,b)=>b.observed_at.localeCompare(a.observed_at)||a.id.localeCompare(b.id));
 return {detections:items.slice(0,500),truncated:items.length>500,latest_data_at:new Date(latest).toISOString()};
}
export async function refreshFires(previous,fetcher=fetch,now=Date.now()){
 const at=new Date(now).toISOString();
 try{const r=await fetcher(firesUrl,{redirect:"error",signal:AbortSignal.timeout(25000)});
  if(!r.ok||!/(?:text\/|application\/octet-stream|csv)/i.test(r.headers.get("content-type")??""))throw Error("FIRMS unavailable");
  return {...parseFires(await boundedText(r,12*1024*1024),now),fetched_at:at,last_attempt_at:at,last_attempt_outcome:"ok"};
 }catch{return {...previous,last_attempt_at:at,last_attempt_outcome:"error"};}
}
