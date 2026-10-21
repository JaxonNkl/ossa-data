import {boundedText} from "../worker/http.mjs";
import {sourceAgent} from "./aviation.mjs";
export const defenceUrl="https://www.wojsko-polskie.pl/dorsz/";
// Checking availability must never turn an anti-bot page into "no alerts".
export async function refreshDefence(previous,fetcher=fetch,now=Date.now()) {
 const at=new Date(now).toISOString();
 try{
  const r=await fetcher(defenceUrl,{headers:{"User-Agent":sourceAgent},redirect:"error",signal:AbortSignal.timeout(15000)});
  const html=await boundedText(r,2*1024*1024);
  const blocked=!r.ok||/_Incapsula_Resource|captcha|support ID|ruch nie jest zautomatyzowany/i.test(html);
  return {last_attempt_at:at,last_attempt_outcome:"error",reason:blocked?"automated_access_blocked":"manual_verification_required",url:defenceUrl};
 }catch{return {...previous,last_attempt_at:at,last_attempt_outcome:"error",reason:"source_unavailable",url:defenceUrl};}
}
