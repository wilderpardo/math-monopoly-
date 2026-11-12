// Failed writes remain available for retry with the same document identifier.
export function createEventOutbox({write, storage, key, onChange = () => {}}) {
    const queue = new Map(), running = new Map();
    let storageError = false;
    try { for (const item of JSON.parse(storage?.getItem(key) || '[]')) if (item?.id && item?.event) queue.set(item.id, item.event); } catch { storageError = true; }
    const persist = () => { try { storage?.setItem(key, JSON.stringify([...queue].map(([id,event])=>({id,event})))); storageError=false; } catch { storageError=true; } onChange({pending:queue.size,storageError}); };
    function send(id) {
        if (running.has(id)) return running.get(id);
        const job = Promise.resolve().then(()=>write(id,queue.get(id))).then(()=>{queue.delete(id);persist();}).finally(()=>running.delete(id));
        running.set(id,job);job.catch(()=>{onChange({pending:queue.size,failed:true,storageError});});
        return job;
    }
    return {
        enqueue(id,event){queue.set(id,event);persist();return send(id);},
        async flush(){while(queue.size){const result=await Promise.allSettled([...queue.keys()].map(send));if(result.some(r=>r.status==='rejected'))throw new Error('Hay eventos pendientes de guardar. Revisa tu conexión y vuelve a intentarlo.');}},
        count(){return queue.size;}
    };
}
