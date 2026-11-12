import { renderOverview } from './dashboard-view.js';
import { createRoundHistory } from './round-history.js';
import { db, auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { METRICS, CATS, buildCtx } from "./metrics-catalog.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["#408e79", "#7cb3c3", "#c9ab67", "#c77770", "#9c9bbc", "#aec6a5"];

// Qué gráfica(s) se dibuja para cada métrica de tipo tabla/ranking.
// cols = columnas numéricas a graficar; labelCols = columnas que forman la etiqueta (por defecto la 0).
// Las métricas de un solo número y las listas sin valores numéricos no se grafican.
const CHARTS = {
 porDia:[{type:'bar',cols:[1,2],title:'Visitas y participantes',description:'Las visitas incluyen los reingresos. Los participantes son personas distintas.'}],
 hintAcc:[{type:'bar',cols:[2],unit:'%',max:100,title:'Acierto con y sin ayuda',description:'Compara las respuestas dadas después de pedir una pista con las respuestas sin ayuda.'}],
 hintRound:[{type:'bar',cols:[1,2],title:'Ayudas durante el recorrido',description:'Cada paso de pista consultado cuenta como una ayuda. Se compara con los intentos de respuesta.'}],
 eligen:[{type:'doughnut',cols:[1],title:'Los mundos elegidos',description:'Distribución de los ingresos por mundo. Un reingreso cuenta de nuevo.'}],
 porFondo:[{type:'bar',cols:[2,3],title:'Actividad en cada mundo',description:'Lanzamientos e intentos de respuesta registrados en cada ambiente.'},{type:'bar',cols:[4],unit:'%',max:100,title:'Precisión en cada mundo',description:'Proporción de respuestas correctas dentro de cada ambiente. No indica por sí sola su dificultad.'}],
 avanceFondo:[{type:'bar',cols:[2],title:'El ritmo de los dados',description:'Casillas obtenidas por lanzamiento, antes de los retrocesos por errores.'}],
 porPartida:[{type:'bar',cols:[1,2],title:'Del inicio a la meta',description:'Personas que participaron y personas que completaron la pregunta final.'}],
 erroresTecnicos:[{type:'bar',cols:[1],title:'Incidencias registradas',description:'Errores técnicos detectados durante la partida. Una gráfica vacía significa que no hay incidencias registradas.'}],
 versiones:[{type:'doughnut',cols:[1],title:'Origen de los registros',description:'Versiones del registro de actividad presentes en esta partida.'}]
};
const reducedMotion=()=>typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function answerSpec(ctx) {
 const read=id=>(roundHistory.result(id)??METRICS.find(m=>m.id===id).fn(ctx)).value;
 const correct=num(read('correctas')),incorrect=num(read('incorrectas'));
 const m={id:'answerBalance',name:'Cada intento también enseña',cat:'Respuestas'};
 return buildSpec(m,{type:'doughnut',cols:[1],description:'Respuestas correctas e incorrectas de la partida seleccionada. Cada intento cuenta.',colors:['#408e79','#c77770']},0,{headers:['Respuesta','Intentos'],rows:correct===null||incorrect===null||correct+incorrect===0?[]:[['Correctas',correct],['Incorrectas',incorrect]]});
}
function scalarSpec(ctx,id,name,cat,description,items,options={}) {
 const rows=items.map(([key,label])=>[label,num((roundHistory.result(key)??METRICS.find(m=>m.id===key).fn(ctx)).value)]);
 return buildSpec({id,name,cat},{type:'bar',cols:[1],description,...options},0,{headers:['Indicador',options.unit==='s'?'Segundos':'Cantidad'],rows:rows.some(r=>r[1]!==null)?rows:[]});
}
function chartInsight(spec){
 if(spec.empty)return 'Los datos aparecerán cuando haya actividad registrada para este indicador.';
 if(spec.m.id==='answerBalance'){const correct=spec.datasets[0].data[0],incorrect=spec.datasets[0].data[1],total=correct+incorrect;return correct+' '+(correct===1?'respuesta correcta':'respuestas correctas')+' de '+total+' '+(total===1?'intento':'intentos')+'. Los errores también forman parte del aprendizaje.';}
 return spec.d.unit==='%'?'Escala de 0 a 100 %. Pasa sobre los datos para ver los valores exactos.':'Pasa sobre los datos o consulta las tablas del panel para ver los valores exactos.';
}

let events = [], players = [], questions = [], hints = null, enabled = new Set(METRICS.map(m => m.id)), roundId = null;
let started = false, timer, charts = [], lastSignature = "";

onAuthStateChanged(auth, user => {
    if (!user || user.isAnonymous) {
        $("gGateMsg").textContent = "Necesitas iniciar sesión como administrador en el panel para ver las gráficas.";
        $("gGate").classList.add("active");
        $("gPage").classList.remove("active");
        return;
    }
    $("gGate").classList.remove("active");
    $("gPage").classList.add("active");
    if (started) return;
    started = true;
    start();
});

function start() {
    if (typeof Chart === "undefined") {
        $("gCharts").innerHTML = "<p class=\"g-empty\">No se pudo cargar la librería de gráficas (Chart.js). Revisa tu conexión a internet y recarga la página.</p>";
        return;
    }
    $("gCategory").innerHTML = `<option value="all">Todas las categorias</option>` + CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    ["gCategory"].forEach(id => $(id).addEventListener("change", schedule));

    // Mismas fuentes de datos que el panel de métricas
    onSnapshot(collection(db, "interacciones"), s => { events = s.docs.map(d => ({ ...d.data(), eventId: d.id })); schedule(); },
        e => { $("gCount").textContent = "No se pudo cargar el historial: " + e.message; });
    onSnapshot(collection(db, "players"), s => { players = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule(); });
    onSnapshot(collection(db,'hints'), s=>{hints=s.docs.map(d=>({id:d.id,...d.data()}));schedule();},()=>{hints=null;schedule();});
    onSnapshot(collection(db, "questions"), s => { questions = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule(); });
    onSnapshot(doc(db, "gameState", "main"), s => { roundId = s.data()?.roundId || null; schedule(); });
    // Métricas activas elegidas en el panel (si no hay selección guardada, todas)
    onSnapshot(doc(db, "config", "metrics"), s => {
        enabled = new Set(s.exists() ? (s.data().enabled || []) : METRICS.map(m => m.id));
        schedule();
    });
}



const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 300); };

const roundHistory = createRoundHistory('gHistory', schedule);
function filteredEvents() { roundHistory.update(events, roundId); return roundHistory.events(); }
// "85.5%" -> 85.5 | "12.3 s" -> 12.3 | "—" -> null
const num = v => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const m = String(v ?? "").replace(",", ".").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
};
const fmtLabel = v => {
    if (typeof v === "number" && v > 1e12) return new Date(v).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    if (/^\d{13}$/.test(String(v))) return fmtLabel(Number(v));
    const t = String(v ?? "").replace(/\[(.+)\]$/, (_, id) => `[${id.slice(-4)}]`);
    return t.length > 48 ? t.slice(0, 47) + "…" : t;
};

function buildSpec(m, d, i, r) {
    const base = d.reverse ? r.rows.slice().reverse() : r.rows.slice();
    const rows = d.limit ? base.slice(0, d.limit) : base;
    let labels, datasets;
    if (d.transpose) {
        const row = r.rows[0] || [];
        labels = d.cols.map(c => r.headers[c]);
        datasets = [{ label: m.name, data: d.cols.map(c => num(row[c])) }];
    } else {
        const cols = d.cols === "rest" ? r.headers.map((_, k) => k).slice(1) : d.cols;
        labels = rows.map(row => (d.labelCols || [0]).map(c => fmtLabel(row[c])).join(" · "));
        datasets = cols.map(c => ({ label: r.headers[c], data: rows.map(row => num(row[c])) }));
    }
    const hasData = labels.length > 0 && datasets.some(ds => ds.data.some(v => v !== null));
    return { key: `${m.id}:${i}`, m, d, labels, datasets, empty: !hasData, total: base.length, shown: rows.length };
}

function draw() {
    const ev = filteredEvents().sort((a, b) => a.ts - b.ts);
    const ctx = buildCtx(ev, players, questions, {hints});
    renderOverview("gOverview",ctx,id=>roundHistory.result(id));
    const cat = $("gCategory").value;
    const specs = [];
    if ((cat==='all' || cat==='Respuestas') && enabled.has('correctas') && enabled.has('incorrectas')) specs.push(answerSpec(ctx));
    if ((cat==='all' || cat==='Finalización') && enabled.has('unicos') && enabled.has('terminaron')) specs.push(scalarSpec(ctx,'finishOverview','Personas que llegaron a la meta','Finalización','El total de participantes frente a quienes completaron la pregunta final. No terminar no implica abandono.',[['unicos','Participantes'],['terminaron','Completaron']]));
    if ((cat==='all' || cat==='Tiempos') && enabled.has('tOk') && enabled.has('tBad')) specs.push(scalarSpec(ctx,'responseTimes','El tiempo para responder','Tiempos','Tiempo medio de respuesta, según el resultado. Una barra ausente indica que no hay respuestas de ese grupo.',[['tOk','Correctas'],['tBad','Incorrectas']],{unit:'s'}));
    if ((cat==='all' || cat==='Juego') && enabled.has('rolls') && enabled.has('sorpresas')) specs.push(scalarSpec(ctx,'gameActivity','Lo que ocurrió en el tablero','Juego','Lanzamientos de dado y cartas sorpresa activadas en esta partida.',[['rolls','Lanzamientos'],['sorpresas','Sorpresas']]));
    METRICS.forEach(m => {
        if (!enabled.has(m.id)) return;
        if (cat !== "all" && m.cat !== cat) return;
        const defs = CHARTS[m.id];
        if (!defs) return;
        let r;
        try { r = (roundHistory.result(m.id) ?? m.fn(ctx)); } catch (e) { console.error(m.id, e); return; }
        if (!r || !Array.isArray(r.rows)) return;
        defs.forEach((d, i) => specs.push(buildSpec(m, d, i, r)));
    });

    $('gCount').textContent = specs.length + (specs.length===1?' gráfica · ':' gráficas · ') + ev.length + ' eventos · ' + roundHistory.description();
    render(specs);
}

function chartHeight(spec) {
    if (spec.d.type === "doughnut") return 280;
    return spec.d.horizontal ? Math.max(240, spec.labels.length * 28 + 70) : 300;
}

function render(specs) {
    const signature = specs.map(s => `${s.key}:${s.empty ? 0 : s.labels.length}:${s.datasets.length}`).join("|") + "|" + $("gCategory").value;

    if (signature === lastSignature) { // misma estructura: solo se actualizan los datos
        charts.forEach(({ chart, spec }) => {
            const fresh = specs.find(s => s.key === spec.key);
            if (!fresh || fresh.empty) return;
            chart.data.labels = fresh.labels;
            fresh.datasets.forEach((ds, k) => { if (chart.data.datasets[k]) chart.data.datasets[k].data = ds.data; });
            chart.update('none');
            const insight=document.querySelector('[data-insight="'+CSS.escape(fresh.key)+'"]');if(insight)insight.textContent=chartInsight(fresh);
        });
        return;
    }
    lastSignature = signature;
    charts.forEach(({ chart }) => chart.destroy());
    charts = [];

    if (!specs.length) {
        $("gCharts").innerHTML = `<p class="g-empty">No hay gráficas para mostrar. Activa métricas en el panel o cambia la categoría.</p>`;
        return;
    }

    const cats = [...new Set(specs.map(s => s.m.cat))];
    $("gCharts").innerHTML = cats.map(cat => {
        const cards = specs.filter(s => s.m.cat === cat).map(s => {
            const title = s.d.title || s.m.name;
            const note = s.shown < s.total ? `<small>Se muestran los primeros ${s.shown} de ${s.total} registros.</small>` : "";
            const body = s.empty
                ? `<div class="g-empty"><div><strong>Sin datos para este indicador</strong><br>Cuando se registre actividad, podrás verla aquí.</div></div>`
                : `<div class="g-chart-box" style="height:${chartHeight(s)}px"><canvas role="img" aria-label="${esc(title)}" data-key="${esc(s.key)}"></canvas></div>${note}`;
            return `<article class="g-chart-card"><p class="chart-key">${esc(s.m.cat)}</p><h4>${esc(title)}</h4><p class="chart-description">${esc(s.d.description||'Actividad de la partida seleccionada.')}</p>${body}<p class="chart-insight" data-insight="${esc(s.key)}">${esc(chartInsight(s))}</p></article>`;
        }).join("");
        return `<section class="g-cat"><h2>${esc(cat)}</h2><div class="g-grid">${cards}</div></section>`;
    }).join("");

    specs.filter(s => !s.empty).forEach(spec => {
        const canvas = document.querySelector(`canvas[data-key="${CSS.escape(spec.key)}"]`);
        if (!canvas) return;
        charts.push({ spec, chart: makeChart(canvas, spec) });
    });
}

function makeChart(canvas, spec) {
    const { d } = spec;
    const unit = d.unit === "%" ? "%" : d.unit === "s" ? " s" : "";
    const isDoughnut = d.type === "doughnut";
    const datasets = spec.datasets.map((ds, k) => {
        const color = (d.colors||COLORS)[k % (d.colors||COLORS).length];
        if (isDoughnut) return { ...ds, backgroundColor: spec.labels.map((_, j) => (d.colors||COLORS)[j % (d.colors||COLORS).length]), borderColor:"#fff", borderWidth:4, hoverOffset:5 };
        return d.type === "line"
            ? { ...ds, borderColor: color, backgroundColor: color + "33", tension: 0.3, pointRadius: 4, pointHoverRadius:6, fill: false }
            : { ...ds, backgroundColor: color, borderRadius: 6, maxBarThickness:34 };
    });
    const valueAxis = { grid:{color:"#edf1ef",drawBorder:false}, border:{display:false}, ticks:{color:"#8a9991",font:{size:10},precision:d.unit?undefined:0}, beginAtZero: true, ...(d.max ? { max: d.max } : {}), ...(d.unit ? { title: { display: true, text: d.unit === "%" ? "%" : "segundos" } } : {}) };
    return new Chart(canvas, {
        type: d.type,
        data: { labels: spec.labels, datasets },
        options: {
            indexAxis: d.horizontal ? "y" : "x",
            responsive: true,
            maintainAspectRatio: false,
            animation: reducedMotion()?false:{duration:380,easing:'easeOutQuart'},
            cutout:isDoughnut?'72%':undefined,
            layout:{padding:8},
            plugins: {
                legend: { display: isDoughnut || spec.datasets.length > 1, position: "bottom", labels:{usePointStyle:true,pointStyle:"circle",boxWidth:7,boxHeight:7,padding:20,color:"#6f8278",font:{size:11,family:"Segoe UI, Arial, sans-serif"}} },
                tooltip: { backgroundColor:"#243f34",padding:12,cornerRadius:9,titleFont:{size:11},bodyFont:{size:11},displayColors:true, callbacks: { label: c => ` ${c.dataset.label || ""}: ${isDoughnut ? c.parsed : (d.horizontal ? c.parsed.x : c.parsed.y)}${unit}` } }
            },
            ...(isDoughnut ? {} : { scales: d.horizontal ? { x: valueAxis, y: {grid:{display:false},border:{display:false}, ticks: { color:"#778d80",font:{size:10},autoSkip: false } } } : { y: valueAxis, x: {grid:{display:false},border:{display:false}, ticks: { color:"#778d80",font:{size:10},autoSkip: true,maxTicksLimit:8,maxRotation:25 } } } })
        }
    });
}
