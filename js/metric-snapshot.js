import { METRICS, buildCtx } from './metrics-catalog.js';
export const METRICS_VERSION=2;
export function metricSnapshot(events,players,questions,hints,endedAt) {
    const context=buildCtx(events,players,questions,{hints,now:endedAt});
    return METRICS.map(metric=>{
        const result=metric.fn(context);
        const resultJson=JSON.stringify(result,(_key,value)=>{
            if(typeof value==='number' && !Number.isFinite(value))throw new Error('Resultado inválido en '+metric.name);
            if(value===undefined)throw new Error('Resultado vacío en '+metric.name);
            return value;
        });
        if(!result || (!Object.hasOwn(result,'value') && (!Array.isArray(result.rows) || !Array.isArray(result.headers))))throw new Error('Métrica incompleta: '+metric.name);
        if(new TextEncoder().encode(resultJson).length>850000)throw new Error('La métrica supera el tamaño admitido: '+metric.name);
        return {metricId:metric.id,resultJson,metricsVersion:METRICS_VERSION};
    });
}
