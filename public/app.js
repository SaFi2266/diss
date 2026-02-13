const API = '/api';
const state = { role: 'writer', user: 'web-user', specialists: [], queue: JSON.parse(localStorage.getItem('syncQ') || '[]') };

const fields = ['FirstName','FatherName','GrandFatherName','FourthName','Gender','MotherName','DoB','RegistryType','RegistryNumber','RegistryPage','Specialist','StudentStatus','EnrollYear','LeaveYear','Note'];

function h(name, attrs = {}, children = []) { const e = document.createElement(name); Object.entries(attrs).forEach(([k,v])=>e[k]=v); (Array.isArray(children)?children:[children]).forEach(c=>e.append(c)); return e; }

async function api(path, options={}){
  const headers = { 'Content-Type': 'application/json', 'X-Role': state.role, 'X-User': state.user, ...(options.headers||{}) };
  try{
    const res = await fetch(API + path, { ...options, headers });
    return await res.json();
  }catch{
    return { offline:true };
  }
}

function updateNet(){ document.getElementById('net').textContent = navigator.onLine ? '🟢 متصل' : '🟠 بدون اتصال'; }
window.addEventListener('online', ()=>{updateNet(); flushQueue();}); window.addEventListener('offline', updateNet); updateNet();

function renderForm(){
  const form = document.getElementById('studentForm'); form.innerHTML='';
  fields.forEach(f=>form.append(h('input',{id:'f_'+f,placeholder:f}))); 
}

async function loadMeta(){ const m = await api('/meta'); state.specialists = m.specialists || []; }

async function search(){
  const q = document.getElementById('q').value.trim();
  const res = await api('/students/search?q='+encodeURIComponent(q));
  const box = document.getElementById('results'); box.innerHTML='';
  (res.items||[]).forEach(s=>{
    const name = [s.FirstName,s.FatherName,s.GrandFatherName,s.FourthName].filter(Boolean).join(' ');
    const card = h('div',{className:'card'},[
      h('div',{textContent:name}),
      h('div',{className:'key',textContent:`سجل: ${s.RegistryNumber} | صفحة: ${s.RegistryPage}`}),
      h('div',{textContent:`المعرف: ${s.RollNumberID}`}),
      h('button',{textContent:'✏️ تعديل',onclick:()=>openEditor(s)})
    ]);
    box.append(card);
  });
}

function openEditor(student){
  const box = document.getElementById('editor'); box.innerHTML='';
  const wrap = h('div',{});
  fields.forEach(f=>wrap.append(h('input',{id:'e_'+f,value:Array.isArray(student[f])?student[f].join('|'):(student[f]||''),placeholder:f})));
  wrap.append(h('button',{textContent:'حفظ التعديل',onclick:async()=>{
    const payload={}; fields.forEach(f=>payload[f]=document.getElementById('e_'+f).value); payload.StudentStatus = payload.StudentStatus?payload.StudentStatus.split('|'):[];
    const res = await api('/students/'+student.id,{method:'PUT',body:JSON.stringify(payload)});
    if(res.offline){queue({type:'update',payload:{...student,...payload}}); alert('تمت اضافته لقائمة المزامنة');}
    else alert('تم حفظ الطلب');
  }}));
  box.append(wrap);
}

function queue(op){ state.queue.push({ opId: crypto.randomUUID(), ...op }); localStorage.setItem('syncQ', JSON.stringify(state.queue)); }
async function flushQueue(){ if(!state.queue.length||!navigator.onLine) return; const res = await api('/sync',{method:'POST',body:JSON.stringify({operations:state.queue})}); if(res.results){ state.queue=[]; localStorage.setItem('syncQ','[]'); } }

async function saveStudent(){
  const payload={}; fields.forEach(f=>payload[f]=document.getElementById('f_'+f).value); payload.StudentStatus = payload.StudentStatus?payload.StudentStatus.split('|'):[];
  const res = await api('/students',{method:'POST',body:JSON.stringify(payload)});
  const msg = document.getElementById('saveMsg');
  if(res.offline){ queue({type:'create',payload}); msg.textContent='بدون اتصال: حفظ محلي بانتظار المزامنة'; return; }
  msg.textContent = res.message || 'تمت الاضافة';
}

async function runImport(){ const csv = document.getElementById('csvIn').value; const res = await api('/import',{method:'POST',body:JSON.stringify({csv})}); alert(JSON.stringify(res)); }
async function runExport(){ const res = await api('/export'); document.getElementById('csvOut').textContent = res.csv || ''; }

function bindTabs(){
  document.querySelectorAll('nav button[data-tab]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.getElementById(b.dataset.tab).classList.add('active');
  });
}

document.getElementById('q').addEventListener('input', search);
document.getElementById('saveBtn').addEventListener('click', saveStudent);
document.getElementById('importBtn').addEventListener('click', runImport);
document.getElementById('exportBtn').addEventListener('click', runExport);
document.getElementById('roleSel').addEventListener('change', (e)=>state.role=e.target.value);

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
renderForm(); bindTabs(); loadMeta(); flushQueue();
