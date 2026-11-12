import { db } from './firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { createEventOutbox } from './event-outbox.js';

export const ctxInfo = { playerId:null, name:'', roundId:null, roundLabel:'', theme:'classic', sides:6, sessionId:crypto.randomUUID() };
let outbox, owner;
function getOutbox() {
    if (!ctxInfo.playerId) return null;
    if (owner!==ctxInfo.playerId) {
        owner=ctxInfo.playerId;
        outbox=createEventOutbox({
            storage:localStorage,key:'math-monopoly-events:'+owner,
            write:(id,event)=>setDoc(doc(db,'interacciones',id),event),
            onChange:state=>{
                const el=document.getElementById('trackingStatus');
                if(el)el.textContent=state.failed ? 'Hay datos pendientes de guardar. Se reintentará al recuperar la conexión.' : state.pending ? 'Guardando actividad…' : state.storageError ? 'No se pudo guardar una copia local de la actividad.' : '';
            }
        });
    }
    return outbox;
}
export async function flushTracking(){await getOutbox()?.flush();}
export function track(type,data={}) {
    if(!ctxInfo.playerId)return Promise.resolve();
    const ev={schemaVersion:3,type,playerId:ctxInfo.playerId,playerName:ctxInfo.name,roundId:ctxInfo.roundId,roundLabel:ctxInfo.roundLabel,theme:ctxInfo.theme,sides:ctxInfo.sides,sessionId:ctxInfo.sessionId,ts:Date.now(),...data};
    Object.keys(ev).forEach(k=>{if(ev[k]===undefined)delete ev[k];});
    const job=getOutbox().enqueue(crypto.randomUUID(),ev);
    job.catch(()=>{});return job;
}
window.addEventListener('online',()=>flushTracking().catch(()=>{}));
