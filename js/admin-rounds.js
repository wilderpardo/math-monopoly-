import { db, auth } from './firebase.js';
import { doc, getDocFromServer, setDoc, collection, getDocsFromServer, query, where, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { metricSnapshot, METRICS_VERSION } from './metric-snapshot.js';
import { hintAccessMessage } from './hint-access.js';
const $=id=>document.getElementById(id),main=doc(db,'gameState','main');
const admin=()=>{if(!auth.currentUser || auth.currentUser.isAnonymous)throw new Error('Inicia sesión como administrador.');};
let busy=false;
async function action(job){if(busy)return;busy=true;try{admin();await job();}catch(e){$('roundStatus').textContent='No se completó la operación: '+e.message;}finally{busy=false;}}
export function listenRoundState(){return onSnapshot(main,s=>{
    const state=s.data()||{};
    $('btnStartGame').disabled=['playing','closing'].includes(state.status);
    $('btnEndGame').disabled=!['playing','closing'].includes(state.status);
    $('btnResetGame').disabled=['playing','closing'].includes(state.status);
    $('roundStatus').textContent=state.status==='closing'?'Partida detenida. Guardado pendiente de confirmar; pulsa Finalizar para reintentar.':state.status==='ended'?'Partida finalizada y guardada.':state.status==='playing'?'Partida en curso.':'Lista para iniciar.';
});}
$('btnStartGame').onclick=()=>action(async()=>{
    const roundId=Date.now(),label=$('roundLabel').value.trim().slice(0,40);
    await runTransaction(db,async tx=>{
        const state=(await tx.get(main)).data()||{};
        if(['playing','closing'].includes(state.status))throw new Error('Finaliza y guarda la partida actual antes de iniciar otra.');
        tx.set(main,{status:'playing',roundId,label,startedAt:roundId});
    });
});
$('btnEndGame').onclick=()=>action(async()=>{
    let state;
    await runTransaction(db,async tx=>{
        state=(await tx.get(main)).data();
        if(!state?.roundId || !['playing','closing'].includes(state.status))throw new Error('No hay una partida activa.');
        state={...state,status:'closing',endedAt:state.endedAt||Date.now()};
        tx.set(main,state);
    });
    $('roundStatus').textContent='Esperando la confirmación de guardado de los jugadores…';
    const deadline=Date.now()+8000;let ps,es,acknowledged;
    do{
        ps=await getDocsFromServer(query(collection(db,'players'),where('roundId','==',state.roundId)));
        es=await getDocsFromServer(query(collection(db,'interacciones'),where('roundId','==',state.roundId)));
        acknowledged=new Set(es.docs.map(d=>d.data()).filter(e=>e.type==='visibility' && e.state==='round_closed').map(e=>e.playerId));
        if(ps.docs.every(d=>acknowledged.has(d.id)))break;
        await new Promise(resolve=>setTimeout(resolve,300));
    }while(Date.now()<deadline);
    const missing=ps.docs.filter(d=>!acknowledged.has(d.id));
    if(missing.length)throw new Error('Aún falta confirmar el guardado de '+missing.map(d=>d.data().name||d.id).join(', ')+'. Mantén abiertas sus pantallas o reconéctalas y vuelve a pulsar Finalizar. No se ha guardado un resumen incompleto.');
    const [qs,hs]=await Promise.all([
        getDocsFromServer(collection(db,'questions')),getDocsFromServer(collection(db,'hints')).catch(error=>{throw new Error(hintAccessMessage(error));})
    ]);
    const events=es.docs.map(d=>({...d.data(),eventId:d.id})),players=ps.docs.map(d=>({id:d.id,...d.data()})),questions=qs.docs.map(d=>({id:d.id,...d.data()})),hints=hs.docs.map(d=>({id:d.id,...d.data()}));
    const snapshot=metricSnapshot(events,players,questions,hints,state.endedAt),id=String(state.roundId);
    await runTransaction(db,async tx=>{
        const latest=(await tx.get(main)).data();
        if(latest?.roundId!==state.roundId || latest.status!=='closing')throw new Error('El estado de la partida cambió. Recarga el panel.');
        for(const metric of snapshot)tx.set(doc(db,'config','round_'+id+'_'+metric.metricId),{...metric,archiveRoundId:id});
        tx.set(doc(db,'config','round_'+id),{kind:'roundArchive',roundId:state.roundId,label:state.label||'',endedAt:state.endedAt,eventCount:events.length,playerCount:players.length,metricCount:snapshot.length,metricsVersion:METRICS_VERSION,complete:true});
        tx.set(main,{...state,status:'ended'});
    });
    // Confirm the archived values from the server before displaying success.
    const saved=await getDocsFromServer(query(collection(db,'config'),where('archiveRoundId','==',id)));
    const values=new Map(saved.docs.map(d=>[d.data().metricId,d.data().resultJson]));
    if(snapshot.some(m=>values.get(m.metricId)!==m.resultJson))throw new Error('La comprobación del archivo no coincide. Revisa la conexión y recarga el historial.');
    $('roundStatus').textContent='Partida finalizada: '+snapshot.length+' métricas verificadas, '+players.length+' jugadores y '+events.length+' eventos.';
});
$('btnResetGame').onclick=()=>action(async()=>{
    const state=(await getDocFromServer(main)).data()||{};
    if(['playing','closing'].includes(state.status))throw new Error('Primero finaliza y guarda la partida.');
    if(confirm('¿Preparar otra partida conservando el historial?'))await setDoc(main,{...state,status:'waiting'});
});
