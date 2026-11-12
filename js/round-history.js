import { db } from './firebase.js';
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { repairMetrics } from './repair-metrics.js';

export function roundEntries(events, archives, current) {
    const rounds = new Map();
    events.forEach(e => { if (e.roundId != null) rounds.set(String(e.roundId), {id:String(e.roundId), label:e.roundLabel || rounds.get(String(e.roundId))?.label || ''}); });
    archives.forEach(a => rounds.set(String(a.roundId), {id:String(a.roundId), label:a.label || '', saved:true}));
    if (current != null) rounds.set(String(current), rounds.get(String(current)) || {id:String(current), label:''});
    return [...rounds.values()].sort((a,b) => Number(b.id)-Number(a.id));
}

export function createRoundHistory(containerId, changed) {
    const root = document.getElementById(containerId);
    let events = [], current = null, archives = [], selected = null, loadedId = null, results = new Map(), stop = null, loading = false, listSignature = '';
    root.innerHTML = '<button type="button" class="history-current">Partida actual o última</button> <button type="button" class="history-toggle" aria-expanded="false">Historial de partidas</button><div class="history-list" hidden></div><p class="history-status" role="status"></p><button type="button" class="history-repair" hidden>Recalcular métricas guardadas de esta partida</button><small class="history-warning"></small>';
    const list = root.querySelector('.history-list'), status = root.querySelector('.history-status');
    const entries = () => roundEntries(events, archives, current);
    const activeId = () => selected || (current != null ? String(current) : entries()[0]?.id) || null;
    const label = r => new Date(Number(r.id)).toLocaleString('es-CO') + (r.label ? ' — '+r.label : '');
    function render() {
        const id = activeId();
        const archive=archives.find(a=>String(a.roundId)===id),old=archive && (archive.metricsVersion||1)<2;
        root.querySelector('.history-repair').hidden=!old;
        root.querySelector('.history-warning').textContent=old?'Este guardado es anterior a la corrección de ingresos. Puedes recalcularlo usando los eventos conservados. Los datos que nunca se registraron no se pueden recuperar.':'';
        const rounds=entries(),signature=JSON.stringify([id,rounds]);
        if(signature!==listSignature){
        listSignature=signature;list.replaceChildren();
        rounds.forEach(r => {
            const b = document.createElement('button'); b.type='button'; b.textContent=label(r); b.setAttribute('aria-pressed', String(r.id===id));
            b.addEventListener('click', () => { selected=r.id; refresh(); changed(); }); list.appendChild(b);
        });
        }
        status.textContent = id ? label(entries().find(r=>r.id===id) || {id}) + (loading ? ' · Cargando datos guardados…' : '') : 'Sin partidas registradas';
    }
    function refresh() {
        const id = activeId(), archived = archives.some(a=>String(a.roundId)===id);
        const key = id + ':' + archived;
        if (loadedId !== key) {
            loadedId=key; stop?.(); results=new Map(); loading=archived;
            if (archived) stop=onSnapshot(query(collection(db,'config'),where('archiveRoundId','==',id)), snapshot => {
                if (loadedId !== key) return;
                try { results=new Map(snapshot.docs.map(d=>[d.data().metricId,JSON.parse(d.data().resultJson)])); loading=false; render(); changed(); }
                catch { status.textContent='No se pudieron leer las métricas guardadas de esta partida.'; }
            }, error => { loading=false; status.textContent='No se pudo cargar la partida: '+error.message; });
        }
        render();
    }
    root.querySelector('.history-current').onclick=()=>{selected=null;refresh();changed();};
    root.querySelector('.history-toggle').onclick=e=>{list.hidden=!list.hidden;e.target.setAttribute('aria-expanded',String(!list.hidden));};
    root.querySelector('.history-repair').onclick=async e=>{
        e.target.disabled=true;
        try {await repairMetrics(archives.find(a=>String(a.roundId)===activeId()));status.textContent='Métricas recalculadas y guardadas.';}
        catch(error){status.textContent='No se pudieron recalcular: '+error.message;}
        finally{e.target.disabled=false;}
    };
    let archiveStop;
    onAuthStateChanged(auth, user => {
        archiveStop?.(); stop?.(); loadedId=null; results=new Map();
        if (!user || user.isAnonymous) { archives=[]; return; }
        archiveStop=onSnapshot(query(collection(db,'config'),where('kind','==','roundArchive')), snapshot=>{archives=snapshot.docs.map(d=>d.data());refresh();changed();},error=>{status.textContent='No se pudo cargar el historial: '+error.message;});
    });
    return {
        update(ev,id){events=ev;current=id;refresh();},
        events(){const id=activeId();return events.filter(e=>e.roundId!=null && String(e.roundId)===id);},
        result(id){return archives.some(a=>String(a.roundId)===activeId()) ? (results.get(id) || {value:loading?'Cargando…':'Métrica no guardada'}) : undefined;},
        description(){return status.textContent;}
    };
}
