import {refreshAviation} from "./aviation.mjs";
import {refreshFires} from "./fires.mjs";
import {refreshDefence} from "./defence.mjs";
// ADS-B is refreshed on every second run (about 10 minutes) to keep KV writes within the Free plan.
export const AVIATION_INTERVAL=540000;
const due=(snapshot,interval,now)=>{const at=Date.parse(snapshot?.last_attempt_at);return !Number.isFinite(at)||now<at||now-at>=interval;};
export async function refreshOperations(previous={},fetcher=fetch,now=Date.now()) {
 const [aviation,fires,defence]=await Promise.all([
  due(previous.aviation,AVIATION_INTERVAL,now)?refreshAviation(previous.aviation,fetcher,now):previous.aviation,
  due(previous.fires,3600000,now)?refreshFires(previous.fires,fetcher,now):previous.fires,
  due(previous.defence,3600000,now)?refreshDefence(previous.defence,fetcher,now):previous.defence,
 ]);
 return {schema_version:1,aviation,fires,defence};
}
