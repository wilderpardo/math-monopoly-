import { METRICS } from './metrics-catalog.js';
export const escapeText=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const overview=[['unicos','Participantes','Personas que entraron a esta partida','◎'],['ingresos','Ingresos','Incluye los reingresos al juego','↗'],['total','Respuestas','Intentos registrados en la partida','≋'],['tasa','Precisión','Proporción de respuestas correctas','◈'],['terminaron','Llegaron a la meta','Completaron la pregunta final','⚑']];
export function renderOverview(id,ctx,saved=()=>undefined){
 const root=document.getElementById(id);if(!root)return;
 root.innerHTML=overview.map(([key,label,note,icon])=>{const m=METRICS.find(m=>m.id===key),value=(saved(key)??m.fn(ctx)).value;return `<article class="overview-card" data-overview="${key}"><div class="overview-top"><span>${label}</span><i aria-hidden="true">${icon}</i></div><strong class="${String(value).length>9?'long-value':''}">${escapeText(value)}</strong><small>${note}</small></article>`;}).join('');
}
