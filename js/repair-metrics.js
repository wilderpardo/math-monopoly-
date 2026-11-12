import { db, auth } from './firebase.js';
import { collection, query, where, getDocsFromServer, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { metricSnapshot, METRICS_VERSION } from './metric-snapshot.js';
export async function repairMetrics(archive) {
    if(!auth.currentUser || auth.currentUser.isAnonymous)throw new Error('Inicia sesión como administrador.');
    const id=String(archive.roundId);
    const es=await getDocsFromServer(query(collection(db,'interacciones'),where('roundId','==',archive.roundId)));
    const events=es.docs.map(d=>({...d.data(),eventId:d.id}));
    const snapshot=metricSnapshot(events,[],[],[],archive.endedAt||Number(archive.roundId));
    // The old application never recorded the size of the general hint bank.
    snapshot.find(m=>m.metricId==='hintPub').resultJson=JSON.stringify({value:'No registrado en esta versión antigua'});
    await runTransaction(db,async tx=>{
        const ref=doc(db,'config','round_'+id),current=(await tx.get(ref)).data();
        if(!current || (current.metricsVersion||1)>=METRICS_VERSION)throw new Error('El archivo ya fue actualizado. Recarga el historial.');
        for(const metric of snapshot)tx.set(doc(db,'config','round_'+id+'_'+metric.metricId),{...metric,archiveRoundId:id});
        tx.set(ref,{...current,metricsVersion:METRICS_VERSION,metricCount:snapshot.length,eventCount:events.length,recalculatedAt:Date.now(),legacyHintCountUnknown:true});
    });
}
