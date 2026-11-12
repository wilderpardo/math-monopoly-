export function validateHint(input) {
    if (!input || typeof input !== 'object') throw new Error('La pista debe contener pasos.');
    const steps=Array.isArray(input.steps)?input.steps.map(s=>typeof s==='string'?s.trim():''):[];
    if(!steps.length || steps.length>6 || steps.some(s=>!s || s.length>200))throw new Error('Cada pista necesita de 1 a 6 pasos de hasta 200 caracteres.');
    // Compatibility marker for the existing document format; never a question.
    return {qid:'general',steps,authorName:String(input.authorName||'Administrador').slice(0,20)};
}
export function parseHintFile(text,filename,authorName) {
    const raw=filename.toLowerCase().endsWith('.json')?JSON.parse(text):[{authorName,steps:text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}];
    const list=Array.isArray(raw)?raw:[raw];
    if(!list.length || list.length>100)throw new Error('El archivo debe contener de 1 a 100 pistas.');
    return list.map(validateHint);
}
