import { db, auth } from './firebase.js';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { validateHint, parseHintFile } from './hint-data.js';
import { hintAccessMessage } from './hint-access.js';
const $ = id=>document.getElementById(id);
let editing = null;
const requireAdmin=()=>{if(!auth.currentUser || auth.currentUser.isAnonymous)throw new Error('Inicia sesión como administrador.');return auth.currentUser;};
const report=async job=>{try{requireAdmin();await job();}catch(e){$('hintAdminStatus').textContent=hintAccessMessage(e,'gestionar');}};
function clear(){editing=null;$('adminHintSteps').value='';$('adminHintAuthor').value='';$('btnSaveHint').textContent='Guardar pista';}
export async function loadAdminHints() {
    $('btnSaveHint').disabled=true;$('btnUploadHints').disabled=true;
    try {
    requireAdmin();
    const hs=await getDocs(collection(db,'hints'));
    const list=$('hintsList');list.replaceChildren();
    hs.docs.sort((a,b)=>(b.data().ts||0)-(a.data().ts||0)).forEach(d=>{
        const h=d.data(),li=document.createElement('li'),text=document.createElement('span');
        text.textContent='💡 ['+(h.authorName||'Administrador')+'] '+(h.steps||[]).join(' → ');
        const edit=document.createElement('button');edit.type='button';edit.textContent='Editar';
        edit.onclick=()=>{requireAdmin();editing=d.id;$('adminHintAuthor').value=h.authorName||'';$('adminHintSteps').value=(h.steps||[]).join('\n');$('btnSaveHint').textContent='Guardar cambios';$('adminHintSteps').focus();};
        const del=document.createElement('button');del.type='button';del.textContent='Borrar';del.className='btn-delete';
        del.onclick=()=>report(async()=>{if(!confirm('¿Eliminar esta pista?'))return;await deleteDoc(doc(db,'hints',d.id));if(editing===d.id)clear();await loadAdminHints();});
        li.append(text,edit,del);list.append(li);
    });
    if(!hs.size)list.textContent='Aún no hay pistas publicadas.';
    $('btnSaveHint').disabled=false;$('btnUploadHints').disabled=false;
    $('hintAdminStatus').textContent='';
    } catch(error) {
        $('hintsList').replaceChildren();
        $('hintAdminStatus').textContent=hintAccessMessage(error);
        throw error;
    }
}
$('btnNewHint').onclick=clear;
$('btnReloadHints').onclick=()=>report(loadAdminHints);
$('btnSaveHint').onclick=()=>report(async()=>{
    const user=requireAdmin(),h=validateHint({steps:$('adminHintSteps').value.split(/\r?\n/).filter(s=>s.trim()),authorName:$('adminHintAuthor').value});
    await setDoc(doc(db,'hints',editing||crypto.randomUUID()),{...h,authorId:user.uid,ts:Date.now()});
    clear();await loadAdminHints();$('hintAdminStatus').textContent='Pista guardada.';
});
$('btnUploadHints').onclick=()=>report(async()=>{
    const user=requireAdmin(),file=$('hintFile').files[0];
    if(!file || !/\.(txt|json)$/i.test(file.name))throw new Error('Selecciona un archivo .txt o .json.');
    if(file.size>300000)throw new Error('El archivo supera 300 KB.');
    const hints=parseHintFile(await file.text(),file.name,$('adminHintAuthor').value);
    const batch=writeBatch(db);
    hints.forEach(h=>batch.set(doc(db,'hints',crypto.randomUUID()),{...h,authorId:user.uid,ts:Date.now()}));
    await batch.commit();$('hintFile').value='';await loadAdminHints();$('hintAdminStatus').textContent=hints.length+' pistas subidas.';
});
