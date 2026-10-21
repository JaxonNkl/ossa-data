import {regions} from "../worker/regions.mjs";
// Correlate only explicit delivery-area statements, never place names in headlines.
export function rcbScope(body) {
 const evidence=body.split(/\n+/).map(s=>s.trim()).filter(s=>/Alert RCB[^.!?]{0,100}(?:wysłan|wyslan)/iu.test(s)&&/(?:woj\.|województw)/iu.test(s));
 const matches=Object.values(regions).map(([name])=>name).filter(name=>{
  const stem=name.toLocaleLowerCase("pl").replace(/ie$/u,"");
  const pattern=new RegExp(`(?<![\\p{L}-])${stem}(?:ie|im|iego|ich|iemu|i)?(?![\\p{L}-])`,"iu");
  return evidence.some(s=>pattern.test(s));
 });
 return {regions:matches.sort((a,b)=>a.localeCompare(b,"pl")),geographic_scope:matches.length?"region_reference":"unmapped",region_evidence:evidence.filter(s=>matches.length).join("\n").slice(0,1800)};
}
