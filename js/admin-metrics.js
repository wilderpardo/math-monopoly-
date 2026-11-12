import { renderOverview } from './dashboard-view.js';
import { createRoundHistory } from './round-history.js';
import { db, auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { collection, doc, onSnapshot, getDoc, setDoc, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { METRICS, CATS, buildCtx } from "./metrics-catalog.js";

// Versión del catálogo de métricas: si cambia, se activan todas las métricas nuevas una vez.
const CATALOG_VERSION = 3;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let events = [], players = [], questions = [], hints = null, enabled = new Set(), roundId = null, started = false, timer, stopEvents = null;

onAuthStateChanged(auth, async user => {
    if (!user || user.isAnonymous || started) return;
    started = true;

    const cfg = await getDoc(doc(db, "config", "metrics"));
    const fresh = cfg.exists() && cfg.data().v === CATALOG_VERSION;
    enabled=new Set(fresh?cfg.data().enabled||[]:METRICS.map(m=>m.id));
    if (!fresh) save();

    drawFilters();
    drawSelector();

    listenEvents();
    onSnapshot(collection(db, "players"), s => { players = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule(); });
    onSnapshot(collection(db,'hints'), s=>{hints=s.docs.map(d=>({id:d.id,...d.data()}));schedule();},()=>{hints=null;schedule();});
    onSnapshot(collection(db, "questions"), s => { questions = s.docs.map(d => ({ id: d.id, ...d.data() })); schedule(); });
    onSnapshot(doc(db, "gameState", "main"), s => { roundId = s.data()?.roundId || null; schedule(); });

    ["mCategory", "mMetric", "mView"].forEach(id => $(id)?.addEventListener("change", () => {
        if(id==='mView' && $('mView').value==='collapsed')document.querySelectorAll('details[data-section]').forEach(el=>el.open=false);
        if (id === "mCategory") drawMetricOptions();
        schedule();
    }));
});

const save = () => setDoc(doc(db, "config", "metrics"), { enabled: [...enabled], v: CATALOG_VERSION });
const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 250); };

function drawFilters() {
    $("mCategory").innerHTML = `<option value="all">Todas las categorias</option>` +
        CATS.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join("");
    drawMetricOptions();
}

function drawMetricOptions() {
    const current = $("mMetric")?.value || "all";
    const cat = $("mCategory")?.value || "all";
    const list = METRICS.filter(m => cat === "all" || m.cat === cat);
    $("mMetric").innerHTML = `<option value="all">Todas las metricas activas</option>` +
        list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
    $("mMetric").value = list.some(m => m.id === current) ? current : "all";
}

function syncCatBoxes() {
    CATS.forEach(cat => {
        const box = document.querySelector(`input[data-cat="${CSS.escape(cat)}"]`);
        if (!box) return;
        const ms = METRICS.filter(m => m.cat === cat), n = ms.filter(m => enabled.has(m.id)).length;
        box.checked = n === ms.length;
        box.indeterminate = n > 0 && n < ms.length;
    });
}

function drawSelector() {
    $("mSelector").innerHTML = CATS.map(cat => {
        const ms = METRICS.filter(m => m.cat === cat);
        return `<details class="m-cat"><summary><label><input type="checkbox" data-cat="${esc(cat)}"> <strong>${esc(cat)}</strong> (${ms.length})</label></summary>` +
            ms.map(m => `<label class="m-opt"><input type="checkbox" data-id="${esc(m.id)}" ${enabled.has(m.id) ? "checked" : ""}> ${esc(m.name)}</label>`).join("") + `</details>`;
    }).join("");
    syncCatBoxes();

    $("mSelector").onchange = e => {
        const t = e.target;
        if (t.dataset.cat) METRICS.filter(m => m.cat === t.dataset.cat).forEach(m => setOne(m.id, t.checked));
        else setOne(t.dataset.id, t.checked);
        syncCatBoxes();
        save();
        schedule();
    };

    $("mAll").onclick = () => { METRICS.forEach(m => enabled.add(m.id)); sync(); };
    $("mNone").onclick = () => { enabled.clear(); sync(); };

    const sync = () => { document.querySelectorAll('#mSelector [data-id]').forEach(b => { b.checked = enabled.has(b.dataset.id); }); syncCatBoxes(); save(); schedule(); };
    const setOne = (id, on) => {
        if (!id) return;
        on ? enabled.add(id) : enabled.delete(id);
        const b = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (b) b.checked = on;
    };
}

function listenEvents() {
    stopEvents = onSnapshot(collection(db, 'interacciones'), snapshot => { events = snapshot.docs.map(d => ({...d.data(), eventId:d.id})); schedule(); }, error => { $('mCount').textContent = error.message; });
}
const roundHistory = createRoundHistory('mHistory', schedule);
function filteredEvents() { roundHistory.update(events, roundId); return roundHistory.events(); }
function card(m,r){
 const heading=`<h4>${esc(m.name)}</h4>`;
 if(r.value!==undefined)return `<article data-metric="${esc(m.id||m.name)}" class="m-card">${heading}<div class="m-val">${esc(r.value)}</div></article>`;
 const body=r.rows.length?`<table class="m-table"><tr>${r.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr>${r.rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`:'<em>Sin datos aún</em>';
 return `<article data-metric="${esc(m.id||m.name)}" class="m-card m-wide">${heading}<div class="m-scroll">${body}</div></article>`;
}
function metricSection(name,content,count){
 const open=$('mView').value==='open'?' open':'';
 return `<details class="metric-section m-wide" data-section="${esc(name)}"${open}><summary><strong>${esc(name)}</strong><small>${count} métricas</small></summary><div class="m-grid metric-section-body">${content}</div></details>`;
}
function metricSections(metrics,ctx, saved = () => undefined){
 return [...new Set(metrics.map(m=>m.cat))].map(cat=>{const list=metrics.filter(m=>m.cat===cat);return metricSection(cat,list.map(m=>{try{return card(m,(saved(m.id) ?? m.fn(ctx)));}catch(e){console.error(m.id,e);return card(m,{value:'--'});}}).join(''),list.length);}).join('');
}

function selectedMetrics() {
    const cat = $("mCategory")?.value || "all";
    const metric = $("mMetric")?.value || "all";
    return METRICS.filter(m => {
        if (metric !== "all") return m.id === metric;
        if (cat !== "all" && m.cat !== cat) return false;
        return enabled.has(m.id);
    });
}

function draw() {
    const ev=filteredEvents().sort((a,b)=>a.ts-b.ts);
    const ctx = buildCtx(ev, players, questions, {hints});
    renderOverview('mOverview',ctx,id=>roundHistory.result(id));
    const sel = selectedMetrics();

    const opened=[...document.querySelectorAll('details[data-section][open]')].map(el=>[el.parentElement.id,el.dataset.section]);
    $('mDash').innerHTML=metricSections(sel,ctx,id=>roundHistory.result(id))||'<p>Marca las métricas que quieres ver.</p>';

    $('mCount').innerText = sel.length + ' métricas visibles · ' + ev.length + ' eventos · ' + roundHistory.description();
    if($('mView').value==='collapsed')opened.forEach(([parent,name])=>{const el=[...$(parent).querySelectorAll('details[data-section]')].find(el=>el.dataset.section===name);if(el)el.open=true;});
}

