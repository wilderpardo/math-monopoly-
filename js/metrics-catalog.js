// Catálogo de métricas GENERALES (del grupo / de la partida). No hay métricas por
// pregunta, por estudiante ni por tema: así se protege la privacidad y se mide lo importante.
// Cada una: [id, categoría, nombre, fn(ctx) -> {value} | {headers, rows}]
export const qLabel=a=>{const n="#"+(a.order??"?"),t=String(a.qtext||"").trim();return t?`${n} ${t}`:`${n} (pregunta eliminada ${String(a.qid||"").slice(-4)})`;};
const validTime=v=>typeof v==='number' && Number.isFinite(v) && v>=0;
const questionKey=e=>JSON.stringify([e.playerId,e.roundId,e.qid]);
function participations(ev){return Object.values(grp(ev.filter(e=>e.playerId && e.roundId!=null && !['visit','join'].includes(e.type)),e=>JSON.stringify([e.playerId,e.roundId])));}
export const CATS = ["Participación", "Finalización", "Tiempos", "Respuestas", "Juego", "Pistas (ayudas)", "Fondos y dados", "Partidas", "Calidad de datos"];

const nums = a => a.filter(validTime);
const sum = a => nums(a).reduce((x, y) => x + y, 0), avg = a => { const n = nums(a); return n.length ? sum(n) / n.length : 0; };
const med = a => { const n = nums(a); if (!n.length) return 0; const s = [...n].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pc = (n, d) => d ? Math.round(1000 * n / d) / 10 + "%" : "—";
const sec = ms => Number.isFinite(ms) && ms > 0 ? (ms / 1000).toFixed(1) + " s" : "—";
const uniq = a => [...new Set(a)];
export const grp = (a, f) => a.reduce((m, x) => ((m[f(x)] ??= []).push(x), m), Object.create(null));
const V = value => ({ value }), T = (headers, rows) => ({ headers, rows });
const ok = l => l.filter(a => a.correct).length;
const sorted = (rows, f, dir = 1) => rows.slice().sort((a, b) => dir * (f(a) - f(b)));
const first = (rows, txt) => rows.length ? V(txt(rows[0])) : V("—");
const joiners=c=>uniq(c.ev.filter(e=>e.playerId&&e.roundId!=null).map(e=>e.playerId)).length;
const THEME_NAMES = { classic: "Clásico (d6)", volcano: "Volcán (d8)", nature: "Naturaleza (d4)" };
const themeOf = e => THEME_NAMES[e.theme || "classic"] || String(e.theme);
const roundName = (id, l) => { const lab = (l.find(e => e.roundLabel) || {}).roundLabel; const d = new Date(Number(id)).toLocaleString("es-CO"); return lab ? `${d} — ${lab}` : d; };

export function buildCtx(ev, players, questions, { now=Date.now(), hints=[] } = {}) {
    ev=[...ev].sort((a,b)=>a.ts-b.ts);
    // Última casilla observada por participación (jugador–partida): solo se usa para promedios del grupo
    const historical=new Map();ev.filter(e=>e.playerId&&e.roundId!=null).forEach(e=>{const k=JSON.stringify([e.playerId,e.roundId]),p=historical.get(k)||{id:e.playerId,position:0};if(Number.isFinite(e.pos))p.position=e.correct===false?e.pos-(e.lost||0):e.pos;historical.set(k,p);});players=[...historical.values()];
    const by=t=>ev.filter(e=>e.type===t);
    const entryKey=e=>JSON.stringify([e.roundId,e.playerId,e.sessionId]);
    const roundJoins=by('round_join'), joinKeys=new Set(roundJoins.map(entryKey));
    const joins=[...roundJoins,...by('join').filter(e=>!joinKeys.has(entryKey(e)))];
    const roundVisits=by('round_visit'), visitKeys=new Set(roundVisits.map(entryKey));
    const visits=[...roundVisits,...by('visit').filter(e=>!visitKeys.has(entryKey(e))),...roundJoins.filter(e=>!visitKeys.has(entryKey(e)) && !by('visit').some(v=>entryKey(v)===entryKey(e)))];
    return { ev, players, questions, now, hints, A: by("answer"), V: visits, J: joins, R: by("roll"), S: by("surprise"),
        F: by("finish"), G: by("reached_goal"), HU: by("hint_used"), HN: by("hint_none"), HP: by("hint_published") };
}

export const METRICS = [
    // ---- Participación ----
    ["visitas", 0, "Visitas de jugadores en la partida", c => V(c.V.length)],
    ["ingresos", 0, "Ingresos efectivos a la partida", c => V(c.J.length)],
    ["unicos", 0, "Jugadores únicos", c => V(joiners(c))],
    ["ingXjug", 0, "Ingresos promedio por jugador", c => V((c.J.length / (joiners(c) || 1)).toFixed(2))],
    ["vuelven", 0, "Jugadores que volvieron a ingresar (más de 1 visita)", c => V(Object.values(grp(c.V, e => e.playerId)).filter(l => l.length > 1).length)],
    ["porDia", 0, "Visitas por día", c => T(["Día", "Visitas", "Jugadores únicos"], Object.entries(grp(c.V, e => new Date(e.ts).toLocaleDateString())).map(([d, l]) => [d, l.length, uniq(l.map(e => e.playerId)).length]))],
    ["horaPico", 0, "Hora pico de actividad", c => first(sorted(Object.entries(grp(c.ev, e => new Date(e.ts).getHours())), r => r[1].length, -1), r => r[0] + ":00 (" + r[1].length + " eventos)")],
    ["activos5", 0, "Jugadores activos en los últimos 5 min", c => V(uniq(c.ev.filter(e => c.now - e.ts >= 0 && c.now - e.ts < 3e5).map(e => e.playerId)).length)],
    // ---- Finalización ----
    ["terminaron", 1, "Jugadores que terminaron", c => V(uniq(c.F.map(e => e.playerId)).length)],
    ["tasaFin", 1, "Finalización por participación jugador–partida", c => V(pc(participations(c.ev).filter(l => l.some(e => e.type === 'finish')).length, participations(c.ev).length))],
    ["abandonan", 1, "Jugadores sin finalización registrada (no implica abandono)", c => V(Math.max(0, joiners(c) - uniq(c.F.map(e => e.playerId)).length))],
    ["casillaProm", 1, "Última casilla promedio observada por participación", c => V(avg(c.players.map(p => p.position || 0)).toFixed(1))],
    ["metaVeces", 1, "Veces que se llegó a la meta", c => V(c.G.length)],
    ["aciertoFinal", 1, "% de acierto en la pregunta final", c => { const f = c.A.filter(a => a.isFinal); return V(pc(ok(f), f.length)); }],
    // ---- Tiempos ----
    ["tProm", 2, "Tiempo promedio de respuesta", c => V(sec(avg(c.A.map(a => a.timeMs))))],
    ["tMed", 2, "Tiempo mediano de respuesta", c => V(sec(med(c.A.map(a => a.timeMs))))],
    ["tOk", 2, "Tiempo promedio en respuestas correctas", c => V(sec(avg(c.A.filter(a => a.correct).map(a => a.timeMs))))],
    ["tBad", 2, "Tiempo promedio en respuestas incorrectas", c => V(sec(avg(c.A.filter(a => !a.correct).map(a => a.timeMs))))],
    ["tPartida", 2, "Duración promedio de una partida completa (por jugador)", c => V(sec(avg(c.F.map(e => e.totalTimeMs))))],
    ["tSesion", 2, "Duración promedio de sesión", c => V(sec(avg(Object.values(grp(c.ev, e => e.sessionId)).map(l => Math.max(...l.map(e => e.ts)) - Math.min(...l.map(e => e.ts))))))],
    ["tRapidas", 2, "Respuestas en menos de 2 s (señal descriptiva)", c => { const n = c.A.filter(a => validTime(a.timeMs) && a.timeMs < 2000).length; return V(n + " (" + pc(n, c.A.length) + ")"); }],
    // ---- Respuestas ----
    ["total", 3, "Total de respuestas", c => V(c.A.length)],
    ["correctas", 3, "Respuestas correctas", c => V(ok(c.A))],
    ["incorrectas", 3, "Respuestas incorrectas", c => V(c.A.length - ok(c.A))],
    ["tasa", 3, "Tasa de acierto global", c => V(pc(ok(c.A), c.A.length))],
    ["primerInt", 3, "Acierto al primer intento", c => { const f = c.A.filter(a => a.attempt === 1); return V(pc(ok(f), f.length)); }],
    ["reintentos", 3, "Intentos promedio por pregunta y jugador", c => V((c.A.length / (uniq(c.A.map(questionKey)).length || 1)).toFixed(2))],
    // ---- Juego ----
    ["rolls", 4, "Lanzamientos de dado", c => V(c.R.length)],
    ["turnos", 4, "Lanzamientos promedio por jugador", c => V((c.R.length / (uniq(c.R.map(e => e.playerId)).length || 1)).toFixed(1))],
    ["sorpresas", 4, "Cartas sorpresa activadas", c => V(c.S.length)],
    ["retroceso", 4, "Casillas retrocedidas por errores", c => V(sum(c.A.map(a => a.lost || 0)))],
    // ---- Pistas (ayudas) ----
    ["hintUsed", 5, "Veces que se pidió ayuda (pista o paso de pista)", c => V(c.HU.length)],
    ["hintPlayers", 5, "Estudiantes distintos que pidieron ayuda", c => V(uniq(c.HU.map(e => e.playerId)).length)],
    ["hintRate", 5, "% de respuestas dadas después de pedir ayuda", c => V(pc(c.A.filter(a => a.hintCount > 0).length, c.A.length))],
    ["hintAcc", 5, "Acierto con ayuda vs. sin ayuda", c => { const w = c.A.filter(a => a.hintCount > 0), n = c.A.filter(a => !(a.hintCount > 0)); return T(["Grupo", "Respuestas", "% acierto", "Tiempo prom."], [["Con pista", w.length, pc(ok(w), w.length), sec(avg(w.map(a => a.timeMs)))], ["Sin pista", n.length, pc(ok(n), n.length), sec(avg(n.map(a => a.timeMs)))]]); }],
    ["hintNone", 5, "Veces que pidieron ayuda y no había pista escrita", c => V(c.HN.length)],
    ["hintPub", 5, "Pistas generales disponibles", c => V(c.hints===null?'Sin acceso confirmado a las pistas':c.hints.length)],
    ["hintRound", 5, "Ayudas pedidas por partida", c => T(["Partida", "Ayudas pedidas", "Respuestas", "% con ayuda"], Object.entries(grp(c.ev.filter(e => e.roundId != null), e => e.roundId)).sort((a, b) => Number(b[0]) - Number(a[0])).map(([id, l]) => { const a = l.filter(e => e.type === 'answer'); return [roundName(id, l), l.filter(e => e.type === 'hint_used').length, a.length, pc(a.filter(e => e.hintCount > 0).length, a.length)]; }))],
    // ---- Fondos y dados ----
    ["eligen", 6, "Fondo elegido al unirse", c => T(["Fondo", "Ingresos", "% del total"], Object.entries(grp(c.J, themeOf)).map(([k, l]) => [k, l.length, pc(l.length, c.J.length)]))],
    ["porFondo", 6, "Comparación por fondo (dado)", c => T(["Fondo", "Jugadores", "Lanzamientos", "Respuestas", "% acierto", "Tiempo prom.", "Ayudas pedidas"], Object.entries(grp(c.ev.filter(e => e.playerId && e.roundId != null), themeOf)).map(([k, l]) => { const a = l.filter(e => e.type === 'answer'); return [k, uniq(l.map(e => e.playerId)).length, l.filter(e => e.type === 'roll').length, a.length, pc(ok(a), a.length), sec(avg(a.map(e => e.timeMs))), l.filter(e => e.type === 'hint_used').length]; }))],
    ["avanceFondo", 6, "Avance promedio por lanzamiento según el dado", c => T(["Fondo", "Lanzamientos", "Casillas promedio"], Object.entries(grp(c.R, themeOf)).map(([k, l]) => [k, l.length, (avg(l.map(e => e.roll)) || 0).toFixed(2)]))],
    // ---- Partidas ----
    ["porPartida", 7, "Resumen cronológico por partida", c => T(["Partida", "Participantes", "Finalizaron", "Intentos", "% acierto", "Ayudas pedidas"], Object.entries(grp(c.ev.filter(e => e.roundId != null), e => e.roundId)).sort((a, b) => Number(b[0]) - Number(a[0])).map(([id, l]) => { const a = l.filter(e => e.type === 'answer'); return [roundName(id, l), uniq(l.map(e => e.playerId).filter(Boolean)).length, uniq(l.filter(e => e.type === 'finish').map(e => e.playerId)).length, a.length, pc(ok(a), a.length), l.filter(e => e.type === 'hint_used').length]; }))],
    ["participaciones", 7, "Participaciones jugador–partida observadas", c => V(participations(c.ev).length)],
    ["pausas", 7, "Cambios de pestaña durante la partida", c => V(c.ev.filter(e => e.type === 'visibility' && e.state === 'hidden').length)],
    // ---- Calidad de datos ----
    ["erroresTecnicos", 8, "Errores técnicos registrados", c => T(["Código", "Eventos"], Object.entries(grp(c.ev.filter(e => e.type === 'technical_error'), e => e.code)).map(([k, l]) => [k, l.length]))],
    ["sinPartida", 8, "Eventos sin partida (incluye visitas e ingresos al lobby)", c => V(c.ev.filter(e => e.roundId == null).length)],
    ["sinIdentidad", 8, "Eventos de juego sin estudiante", c => V(c.ev.filter(e => !e.playerId && !['round_start', 'round_reset'].includes(e.type)).length)],
    ["tiempoInvalido", 8, "Respuestas sin tiempo válido", c => V(c.A.filter(e => !validTime(e.timeMs)).length)],
    ["duplicados", 8, "Respuestas duplicadas por presentación", c => { const ids = c.A.map(e => e.presentationId).filter(Boolean); return V(ids.length - uniq(ids).length); }],
    ["versiones", 8, "Eventos por versión de telemetría", c => T(["Versión", "Eventos"], Object.entries(grp(c.ev, e => e.schemaVersion || 'Histórico v1')).map(([k, l]) => [k, l.length]))]
].map(([id, cat, name, fn]) => ({ id, cat: CATS[cat], name, fn }));
