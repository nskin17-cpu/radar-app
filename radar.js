const API_URL='https://script.google.com/macros/s/AKfycbyfZW_xGihRzBcgOs6YLFkqtvrs4Oag3NgT4RiUqPG0gHXgoQXnU1m_FuXTjxTDqkA2/exec';
let currentUser=null,competitors=[],myCompany=null,history=[],historyLog=[],charts={},cityFilter='all';
let isLoggingIn=false;
let isSupabaseSyncRunning=false;
let historyLogField='loren',historyLogCompany='all',historyLogPeriod='90d';
const NUM='nepal,loren,modern,plasticChair,woodChair,metalChair,plateSnack,plateDinner,plateSub,glassWine,glassFlute,glassMartini,glassRocks,cutlerySet,delivery,deliveryKm,setupPlates,setupGlasses,setupCutlery,setupMetalChair,setupPlasticChair,setupCushionChair,proDiscount'.split(',');
const STR='name,city,website,instagram,phone,notes'.split(',');
const ALL=[...STR,...NUM];
const HISTORY_FIELD_LABELS={
  nepal:'Стул Непал',
  loren:'Стул Лорен',
  modern:'Стул Модерн',
  plasticChair:'Стул пластик',
  woodChair:'Стул дерево',
  metalChair:'Стул металл',
  plateSnack:'Тарелка закусочная',
  plateDinner:'Тарелка обеденная',
  plateSub:'Тарелка подстановочная',
  glassWine:'Бокал вино',
  glassFlute:'Бокал флюте',
  glassMartini:'Бокал мартинка',
  glassRocks:'Бокал рокс',
  cutlerySet:'Комплект приборов',
  delivery:'Доставка по городу',
  deliveryKm:'Доставка за км',
  setupPlates:'Сетап тарелки',
  setupGlasses:'Сетап бокалы',
  setupCutlery:'Сетап приборы',
  setupMetalChair:'Сетап стулья металл',
  setupPlasticChair:'Сетап стулья пластик/дерево',
  setupCushionChair:'Сетап стулья с подушкой',
  proDiscount:'Проф. скидка'
};
function normalizeCompetitorRecord(raw){
  const src=raw||{};
  const out={id:String(src.id||'')};
  STR.forEach(k=>{
    out[k]=src[k]==null?'':String(src[k]);
  });
  NUM.forEach(k=>{
    const n=Number(src[k]);
    out[k]=Number.isFinite(n)?n:0;
  });
  return out;
}

async function api(action,data={}){
  try{const r=await fetch(API_URL,{method:'POST',mode:'cors',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...data,action})});return await r.json()}
  catch(e){try{const p=new URLSearchParams({payload:JSON.stringify({...data,action})});const r2=await fetch(API_URL+'?'+p.toString(),{method:'GET',redirect:'follow'});return await r2.json()}catch(e2){showToast('Ошибка сети','error');return{success:false}}}
}

// Дублирование данных в Supabase (резервное хранилище, fire-and-forget)
function sbBackup(action,payload){
  if(typeof window.supabaseWrite==='function'){
    window.supabaseWrite(action,payload).catch(()=>{});
  }
}

// AUTH
async function handleLogin(){
  if(isLoggingIn)return;
  const u=document.getElementById('loginUser').value.trim(),p=document.getElementById('loginPass').value;
  const err=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  if(!u||!p){err.textContent='Заполните все поля';return}
  isLoggingIn=true;err.textContent='';
  if(btn){btn.disabled=true;btn.textContent='Вход...'}
  try{
    const r=await api('login',{username:u,password:p});
    if(r.success){currentUser=r.user;showApp()}
    else err.textContent=r.error||'Ошибка'
  }finally{
    isLoggingIn=false;
    if(btn){btn.disabled=false;btn.textContent='Войти'}
  }
}
function showApp(){document.getElementById('loginScreen').style.display='none';document.getElementById('app').classList.add('active');document.getElementById('userName').textContent=currentUser.username;document.getElementById('userRole').textContent=currentUser.role==='admin'?'Администратор':'Сотрудник';document.getElementById('userAvatar').textContent=currentUser.username[0].toUpperCase();switchPage('crm');loadAll()}
function logout(){currentUser=null;document.getElementById('app').classList.remove('active');document.getElementById('loginScreen').style.display='flex';document.getElementById('loginUser').value='';document.getElementById('loginPass').value='';document.getElementById('loginError').textContent=''}
document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')handleLogin()});
document.getElementById('loginUser').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginPass').focus()});
document.getElementById('loginUser').addEventListener('input',()=>{document.getElementById('loginError').textContent=''});
document.getElementById('loginPass').addEventListener('input',()=>{document.getElementById('loginError').textContent=''});

async function loadAll(){await loadCompetitors();await loadMyCompanyData();await loadHistory();await loadHistoryLog();loadDashboard();loadCompareSelects()}

async function syncAllToSupabase(){
  const st=document.getElementById('settingsStatus');
  const btn=document.getElementById('settingsSyncBtn');
  if(isSupabaseSyncRunning)return;
  if(!window.supabaseWrite){
    if(st){st.style.color='var(--red)';st.textContent='Supabase не настроен. Сохраните URL и ключ.'}
    showToast('Supabase не настроен','error');
    return;
  }
  isSupabaseSyncRunning=true;
  if(btn){btn.disabled=true;btn.textContent='⏳ Синхронизация...';}
  if(st){st.style.color='var(--text2)';st.textContent='Идет полная синхронизация Google Sheets -> Supabase. Не нажимайте кнопку повторно.'}
  showToast('Синхронизация...','info');
  if(typeof window.migrateGoogleToSupabase==='function'){
    const res=await window.migrateGoogleToSupabase((action,data)=>api(action,data));
    if(res?.success){
      let pruned=0;
      let prunedClients=0;
      let prunedStock=0;
      if(typeof window.pruneDeletedOrdersFromSupabase==='function'){
        const pruneRes=await window.pruneDeletedOrdersFromSupabase((action,data)=>api(action,data));
        if(pruneRes?.success)pruned=pruneRes.deleted||0;
      }
      if(typeof window.pruneDeletedClientsFromSupabase==='function'){
        const pruneClientsRes=await window.pruneDeletedClientsFromSupabase((action,data)=>api(action,data));
        if(pruneClientsRes?.success)prunedClients=pruneClientsRes.deleted||0;
      }
      if(typeof window.pruneDeletedStockFromSupabase==='function'){
        const pruneStockRes=await window.pruneDeletedStockFromSupabase((action,data)=>api(action,data));
        if(pruneStockRes?.success)prunedStock=pruneStockRes.deleted||0;
      }
      const r=res.results||{};
      const parts=[
        `заказы: ${r.orders||0}`,
        `клиенты: ${r.clients||0}`,
        `склад: ${r.stock||0}`,
        `категории: ${r.categories||0}`,
        `конкуренты: ${r.competitors||0}`,
        `история: ${r.history||0}`,
        `pricing: ${r.pricing||0}`,
        `моя компания: ${r.myCompany?'1':'0'}`,
        `удалено заказов: ${pruned}`,
        `удалено клиентов: ${prunedClients}`,
        `удалено склад: ${prunedStock}`
      ];
      if(st){st.style.color='var(--green)';st.textContent=`Синхронизация завершена: ${parts.join(', ')}`;}
      if(btn){btn.disabled=false;btn.textContent='🔄 Синхронизировать в Supabase';}
      isSupabaseSyncRunning=false;
      showToast(`Синхронизировано — ${parts.join(', ')}`,'success');
      return;
    }
    if(st){st.style.color='var(--red)';st.textContent=`Ошибка синхронизации: ${res?.error||'неизвестно'}`;}
    if(btn){btn.disabled=false;btn.textContent='🔄 Синхронизировать в Supabase';}
    isSupabaseSyncRunning=false;
    showToast(`Ошибка синхронизации: ${res?.error||'неизвестно'}`,'error');
    return;
  }
  let ok=0,fail=0;
  const ro=await api('getOrders');
  if(ro.success&&Array.isArray(ro.orders)){
    for(const o of ro.orders){
      try{await window.supabaseWrite('upsertOrder',o);ok++}catch(e){fail++}
    }
  }
  const rc=await api('getClients');
  if(rc.success&&Array.isArray(rc.clients)){
    for(const c of rc.clients){
      try{await window.supabaseWrite('upsertClient',c);ok++}catch(e){fail++}
    }
  }
  const rs=await api('getStock');
  if(rs.success&&Array.isArray(rs.stock)){
    for(const s of rs.stock){
      try{await window.supabaseWrite('upsertStockItem',s);ok++}catch(e){fail++}
    }
  }
  if(competitors.length){
    try{await window.supabaseWrite('upsertCompetitors',competitors);ok++}catch(e){fail++}
  }
  if(myCompany){
    try{await window.supabaseWrite('upsertMyCompany',myCompany);ok++}catch(e){fail++}
  }
  if(st){st.style.color=fail?'var(--red)':'var(--green)';st.textContent=`Синхронизация завершена: синхронизировано ${ok} объектов${fail?', ошибок: '+fail:''}`;}
  if(btn){btn.disabled=false;btn.textContent='🔄 Синхронизировать в Supabase';}
  isSupabaseSyncRunning=false;
  showToast(`Синхронизировано: ${ok} объектов${fail?', ошибок: '+fail:''}`, fail?'error':'success');
}

// NAV
function switchPage(p){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.nav-item[data-page]').forEach(x=>x.classList.remove('active'));document.getElementById('page-'+p).classList.add('active');const n=document.querySelector(`.nav-item[data-page="${p}"]`);if(n)n.classList.add('active');if(window.innerWidth<=768)toggleSidebar(false);if(p==='dashboard')loadDashboard();if(p==='compare'){loadCompareSelects();runCompare()}if(p==='mycompany')fillMyForm()}
function toggleSidebar(forceState){
  const s=document.getElementById('sidebar');
  const o=document.getElementById('mobileOverlay');
  const open=typeof forceState==='boolean'?forceState:!s.classList.contains('open');
  s.classList.toggle('open',open);
  o.classList.toggle('active',open);
}

// CITY FILTER
function setFilter(city,btn){cityFilter=city;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');loadDashboard()}
function filtered(){if(cityFilter==='all')return competitors;return competitors.filter(c=>c.city===cityFilter)}

// COMPETITORS
async function loadCompetitors(){
  const r=await api('getCompetitors');
  if(r.success){
    competitors=(r.entries||r.competitors||[]).map(normalizeCompetitorRecord);
    renderCompetitors();
    sbBackup('upsertCompetitors',competitors);
  }
}
function renderCompetitors(){
  const t=document.getElementById('compTable');
  if(!competitors.length){t.innerHTML='<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-text">Добавьте первого конкурента</div></div></td></tr>';return}
  t.innerHTML=competitors.map(c=>`<tr>
    <td><strong>${esc(c.name)}</strong></td><td><span class="badge badge-blue">${esc(c.city||'—')}</span></td>
    <td class="mono">${v(c.nepal)}</td><td class="mono">${v(c.loren)}</td><td class="mono">${v(c.modern)}</td>
    <td class="mono">${v(c.glassWine)}</td><td class="mono">${v(c.plateDinner)}</td><td class="mono">${v(c.delivery)}</td>
    <td class="mono">${v(c.setupGlasses)}</td><td style="color:var(--text2);font-size:11px">${esc(c.phone||'—')}</td>
    <td><button class="btn btn-sm btn-secondary" onclick="editComp('${c.id}')" style="padding:4px 8px;font-size:11px">✎</button> <button class="btn btn-sm btn-danger" onclick="deleteComp('${c.id}')" style="padding:4px 8px;font-size:11px">✕</button></td>
  </tr>`).join('')}

function openAddComp(){document.getElementById('modalCompTitle').textContent='Добавить конкурента';ALL.forEach(f=>{const el=document.getElementById('c'+cap(f));if(el){if(el.tagName==='SELECT')el.selectedIndex=0;else el.value=''}});document.getElementById('cId').value='';openModal('modalComp')}
function editComp(id){const c=competitors.find(x=>x.id===id);if(!c)return;document.getElementById('modalCompTitle').textContent='Редактировать';document.getElementById('cId').value=c.id;ALL.forEach(f=>{const el=document.getElementById('c'+cap(f));if(el)el.value=c[f]||''});openModal('modalComp')}
function getCompForm(){const o={};ALL.forEach(f=>{const el=document.getElementById('c'+cap(f));if(el)o[f]=NUM.includes(f)?Number(el.value)||0:el.value.trim()});return o}
function makeHistoryLogId(){
  return `HL${Date.now()}${Math.floor(Math.random()*100000)}`;
}
function collectPriceChanges(prev,next,companyId,companyName){
  if(!prev||!next)return [];
  const now=new Date().toISOString();
  return NUM.reduce((acc,key)=>{
    const oldValue=Number(prev[key]||0);
    const newValue=Number(next[key]||0);
    if(oldValue===newValue)return acc;
    acc.push({
      id:makeHistoryLogId(),
      createdAt:now,
      companyId:companyId,
      companyName:companyName,
      fieldKey:key,
      fieldLabel:HISTORY_FIELD_LABELS[key]||key,
      oldValue:oldValue,
      newValue:newValue,
      delta:newValue-oldValue,
      source:'manual'
    });
    return acc;
  },[]);
}
async function persistHistoryLogEntries(entries){
  if(!Array.isArray(entries)||!entries.length)return;
  historyLog=[...entries,...historyLog].sort((a,b)=>new Date(b.createdAt||b.created_at||0)-new Date(a.createdAt||a.created_at||0));
  entries.forEach(entry=>{
    sbBackup('insertHistoryLog',entry);
    api('addHistoryLog',{entry}).catch(()=>{});
  });
}
async function deleteHistoryLogEntry(id){
  if(!id)return;
  if(!confirm('Удалить это изменение цены?'))return;
  historyLog=historyLog.filter(entry=>entry.id!==id);
  loadDashboard();
  sbBackup('deleteHistoryLog',{id});
  try{
    await api('deleteHistoryLog',{id});
    showToast('Изменение удалено','success');
  }catch(e){
    showToast('Изменение удалено локально, но не подтверждено в Google','error');
  }
}
async function saveComp(){
  const id=document.getElementById('cId').value;
  const prev=id?competitors.find(x=>x.id===id):null;
  const comp=getCompForm();
  if(!comp.name){showToast('Укажите название','error');return}
  let r;
  if(id){
    comp.id=id;
    r=await api('updateCompetitor',{competitor:comp});
  }else{
    r=await api('addCompetitor',{competitor:comp});
    if(r?.id)comp.id=r.id;
  }
  if(!r?.success){showToast('Ошибка сохранения','error');return}
  if(prev){
    await persistHistoryLogEntries(collectPriceChanges(prev,comp,comp.id,comp.name));
  }
  showToast(id?'Обновлено':'Добавлено','success');
  closeModal('modalComp');
  await loadAll();
}
async function deleteComp(id){if(!confirm('Удалить?'))return;await api('deleteCompetitor',{id});sbBackup('deleteCompetitor',{id});showToast('Удалено','success');await loadAll()}

// MY COMPANY (Google Sheets)
async function loadMyCompanyData(){
  const r=await api('getMyCompany');
  if(r.success&&r.company)myCompany=normalizeCompetitorRecord({...r.company,id:r.company.id||'MY'});
  fillMyForm();
}
function fillMyForm(){if(!myCompany)return;ALL.forEach(f=>{const el=document.getElementById('my'+cap(f));if(el)el.value=myCompany[f]||''})}
async function saveMyCompany(){
  const prev=myCompany?{...myCompany}:null;
  const o={};ALL.forEach(f=>{const el=document.getElementById('my'+cap(f));if(el)o[f]=NUM.includes(f)?Number(el.value)||0:el.value.trim()});
  const r=await api('saveMyCompany',{company:o});
  if(r.success){
    myCompany={...o,id:'MY'};
    sbBackup('upsertMyCompany',myCompany);
    if(prev)await persistHistoryLogEntries(collectPriceChanges(prev,myCompany,'MY',myCompany.name||'Моя компания'));
    showToast('Сохранено','success');
    loadDashboard();loadCompareSelects()
  }else showToast('Ошибка сохранения','error')
}

// HISTORY
async function loadHistory(){const r=await api('getHistory');if(r.success)history=r.history||[]}
async function loadHistoryLog(){
  const sb=typeof window.getSupabase==='function'?window.getSupabase():null;
  if(!sb){historyLog=[];return}
  try{
    const res=await sb.from('history_log').select('*').order('created_at',{ascending:false}).limit(500);
    if(res.error)throw res.error;
    historyLog=(res.data||[]).map(row=>({
      id:row.id,
      createdAt:row.created_at,
      companyId:row.company_id,
      companyName:row.company_name,
      fieldKey:row.field_key,
      fieldLabel:row.field_label,
      oldValue:row.old_value,
      newValue:row.new_value,
      delta:row.delta,
      source:row.source
    }));
  }catch(e){
    historyLog=[];
  }
}

// DASHBOARD
function avg(arr){if(!arr.length)return 0;return arr.reduce((a,b)=>a+b,0)/arr.length}
function getAllWithMy(){const list=[...competitors];if(myCompany&&myCompany.name)list.unshift({...myCompany,id:'MY'});return list}

function loadDashboard(){
  const f=filtered();
  document.getElementById('statTotal').textContent=f.length;
  const sa=k=>f.map(c=>Number(c[k])).filter(x=>x>0);
  document.getElementById('statNepal').textContent=sa('nepal').length?Math.round(avg(sa('nepal')))+'₽':'—';
  document.getElementById('statLoren').textContent=sa('loren').length?Math.round(avg(sa('loren')))+'₽':'—';
  document.getElementById('statDelivery').textContent=sa('delivery').length?Math.round(avg(sa('delivery')))+'₽':'—';
  document.getElementById('statSetupGlasses').textContent=sa('setupGlasses').length?Math.round(avg(sa('setupGlasses')))+'₽':'—';
  document.getElementById('statSetupPlates').textContent=sa('setupPlates').length?Math.round(avg(sa('setupPlates')))+'₽':'—';
  const all=getAllWithMy().filter(c=>cityFilter==='all'||c.city===cityFilter);
  renderCharts(all);
}
async function refreshDashboard(){await loadAll();showToast('Обновлено','success')}

function renderCharts(comps){
  const defs={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#f2f2f5',borderColor:'rgba(0,0,0,0.1)',borderWidth:1,titleColor:'#1a1a1f',bodyColor:'#6e6e78',padding:10,cornerRadius:6}},scales:{x:{grid:{display:false},ticks:{color:'#9d9da8',font:{family:'Inter',size:9}}},y:{grid:{color:'rgba(0,0,0,0.04)',drawBorder:false},ticks:{color:'#9d9da8',font:{family:'JetBrains Mono',size:9},callback:v=>v+'₽'}}}};
  Object.values(charts).forEach(c=>c.destroy());charts={};
  const names=comps.map(c=>(c.id==='MY'?'⭐ ':'')+c.name);
  const bg=comps.map(c=>c.id==='MY'?'rgba(42,157,82,0.7)':'rgba(52,120,246,0.5)');
  const bd=comps.map(c=>c.id==='MY'?'#2a9d52':'#3478f6');

  charts.nepal=new Chart(document.getElementById('chartNepal'),{type:'bar',data:{labels:names,datasets:[{data:comps.map(c=>Number(c.nepal)||0),backgroundColor:bg,borderColor:bd,borderWidth:1,borderRadius:4,borderSkipped:false}]},options:defs});
  charts.loren=new Chart(document.getElementById('chartLoren'),{type:'bar',data:{labels:names,datasets:[{data:comps.map(c=>Number(c.loren)||0),backgroundColor:comps.map(c=>c.id==='MY'?'rgba(42,157,82,0.7)':'rgba(137,68,214,0.5)'),borderColor:comps.map(c=>c.id==='MY'?'#2a9d52':'#8944d6'),borderWidth:1,borderRadius:4,borderSkipped:false}]},options:defs});
  charts.delivery=new Chart(document.getElementById('chartDelivery'),{type:'bar',data:{labels:names,datasets:[{data:comps.map(c=>Number(c.delivery)||0),backgroundColor:comps.map(c=>c.id==='MY'?'rgba(42,157,82,0.7)':'rgba(212,136,6,0.5)'),borderColor:comps.map(c=>c.id==='MY'?'#2a9d52':'#d48806'),borderWidth:1,borderRadius:4,borderSkipped:false}]},options:defs});
  charts.setup=new Chart(document.getElementById('chartSetup'),{type:'bar',data:{labels:names,datasets:[
    {label:'Бокалы',data:comps.map(c=>Number(c.setupGlasses)||0),backgroundColor:'rgba(52,120,246,0.5)',borderColor:'#3478f6',borderWidth:1,borderRadius:4,borderSkipped:false},
    {label:'Тарелки',data:comps.map(c=>Number(c.setupPlates)||0),backgroundColor:'rgba(42,157,82,0.5)',borderColor:'#2a9d52',borderWidth:1,borderRadius:4,borderSkipped:false},
    {label:'Стулья',data:comps.map(c=>Number(c.setupMetalChair)||0),backgroundColor:'rgba(212,136,6,0.5)',borderColor:'#d48806',borderWidth:1,borderRadius:4,borderSkipped:false}
  ]},options:{...defs,plugins:{...defs.plugins,legend:{display:true,labels:{color:'#6e6e78',font:{family:'Inter',size:9},boxWidth:8,padding:8}}}}});

  renderHistoryLogControls(comps);
  renderHistoryChart(comps,defs);
}
function renderHistoryLogControls(comps){
  const fieldSel=document.getElementById('historyFieldFilter');
  const companySel=document.getElementById('historyCompanyFilter');
  if(fieldSel){
    fieldSel.innerHTML=Object.keys(HISTORY_FIELD_LABELS).map(key=>`<option value="${key}" ${historyLogField===key?'selected':''}>${HISTORY_FIELD_LABELS[key]}</option>`).join('');
  }
  if(companySel){
    const opts=['<option value="all">Все компании</option>'].concat(
      comps.map(c=>`<option value="${c.id}" ${historyLogCompany===c.id?'selected':''}>${esc(c.name)}${c.id==='MY'?' ⭐':''}</option>`)
    );
    companySel.innerHTML=opts.join('');
    if(historyLogCompany!=='all'&&!comps.some(c=>c.id===historyLogCompany))historyLogCompany='all';
    companySel.value=historyLogCompany;
  }
}
function formatHistoryDate(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value||'—');
  return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}).format(d);
}
function getHistoryPeriodCutoff(period){
  if(period==='all')return null;
  const days=period==='30d'?30:period==='365d'?365:90;
  const dt=new Date();
  dt.setDate(dt.getDate()-days);
  return dt;
}
function getFilteredHistoryRows(){
  const cutoff=getHistoryPeriodCutoff(historyLogPeriod);
  return historyLog
    .filter(h=>h.fieldKey===historyLogField)
    .filter(h=>historyLogCompany==='all'||h.companyId===historyLogCompany)
    .filter(h=>{
      if(!cutoff)return true;
      const dt=new Date(h.createdAt);
      return !Number.isNaN(dt.getTime())&&dt>=cutoff;
    });
}
function renderHistoryChart(comps,defs){
  const canvas=document.getElementById('chartHistory');
  const recentEl=document.getElementById('historyRecentChanges');
  const periodSel=document.getElementById('historyPeriodFilter');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  if(charts.history){charts.history.destroy();delete charts.history}
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);

  if(periodSel)periodSel.value=historyLogPeriod;

  const rows=getFilteredHistoryRows()
    .slice()
    .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));

  const labels=[...new Set(rows.map(r=>formatHistoryDate(r.createdAt)))];
  const ids=historyLogCompany==='all'?[...new Set(rows.map(r=>r.companyId))]:[historyLogCompany];
  const clrs=['#3478f6','#8944d6','#d48806','#e5352b','#2a9d52','#5ac8fa'];
  const datasets=ids.filter(Boolean).map((cid,i)=>{
    const companyRows=rows.filter(r=>r.companyId===cid);
    const pointColors=labels.map(lbl=>{
      const sameDay=companyRows.filter(r=>formatHistoryDate(r.createdAt)===lbl);
      const last=sameDay[sameDay.length-1];
      return last&&Number(last.delta)<0?'#e5352b':'#2a9d52';
    });
    return{
      label:companyRows[0]?.companyName||cid,
      data:labels.map(lbl=>{
        const sameDay=companyRows.filter(r=>formatHistoryDate(r.createdAt)===lbl);
        const last=sameDay[sameDay.length-1];
        return last?Number(last.newValue)||0:null;
      }),
      borderColor:clrs[i%clrs.length],
      pointBackgroundColor:pointColors,
      pointBorderColor:pointColors,
      tension:.25,
      pointRadius:4,
      pointHoverRadius:5,
      fill:false,
      spanGaps:true
    };
  });

  if(labels.length&&datasets.length){
    charts.history=new Chart(canvas,{
      type:'line',
      data:{labels:labels,datasets:datasets},
      options:{
        ...defs,
        plugins:{
          ...defs.plugins,
          legend:{display:true,labels:{color:'#6e6e78',font:{family:'Inter',size:9},boxWidth:8}},
          tooltip:{
            ...defs.plugins.tooltip,
            callbacks:{
              title:function(items){
                return items[0]?.label||'';
              },
              label:function(ctx){
                return `${ctx.dataset.label}: ${fN(ctx.raw)}₽`;
              },
              afterLabel:function(ctx){
                const label=ctx.label;
                const row=rows
                  .filter(r=>r.companyId===ids[ctx.datasetIndex])
                  .filter(r=>formatHistoryDate(r.createdAt)===label)
                  .slice(-1)[0];
                if(!row)return '';
                const sign=Number(row.delta)>=0?'+':'';
                return `Изменение: ${sign}${fN(row.delta)}₽`;
              }
            }
          }
        }
      }
    });
  }else{
    ctx.font='13px Inter';
    ctx.fillStyle='#9d9da8';
    ctx.textAlign='center';
    ctx.fillText('История изменений появится после первого сохранения новой цены',ctx.canvas.width/2,120);
  }

  if(recentEl){
    const latest=getFilteredHistoryRows()
      .slice(0,10);
    if(!latest.length){
      recentEl.innerHTML='<div style="font-size:12px;color:var(--text3)">Изменений пока нет</div>';
      return;
    }
    const upCount=latest.filter(row=>Number(row.delta)>0).length;
    const downCount=latest.filter(row=>Number(row.delta)<0).length;
    const sameCount=latest.filter(row=>Number(row.delta)===0).length;
    recentEl.innerHTML=`<div style="font-size:10px;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px">Последние изменения</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:11px;padding:6px 10px;border-radius:999px;background:rgba(42,157,82,.12);color:var(--green);font-weight:700">Рост: ${upCount}</span>
        <span style="font-size:11px;padding:6px 10px;border-radius:999px;background:rgba(229,53,43,.12);color:var(--red);font-weight:700">Снижение: ${downCount}</span>
        <span style="font-size:11px;padding:6px 10px;border-radius:999px;background:rgba(157,157,168,.12);color:var(--text2);font-weight:700">Без изменений: ${sameCount}</span>
      </div>
      <div class="table-wrap"><table style="width:100%"><thead><tr><th>Дата</th><th>Компания</th><th>Позиция</th><th>Было</th><th>Стало</th><th>Δ</th><th></th></tr></thead><tbody>
      ${latest.map(row=>`<tr>
        <td>${esc(formatHistoryDate(row.createdAt))}</td>
        <td>${esc(row.companyName)}</td>
        <td>${esc(row.fieldLabel)}</td>
        <td class="mono">${row.oldValue!=null?fN(row.oldValue)+'₽':'—'}</td>
        <td class="mono" style="color:${Number(row.delta)>=0?'var(--green)':'var(--red)'};font-weight:700">${fN(row.newValue)}₽</td>
        <td class="mono" style="color:${Number(row.delta)>=0?'var(--green)':'var(--red)'};font-weight:700">${Number(row.delta)>=0?'▲':'▼'} ${Number(row.delta)>=0?'+':''}${fN(row.delta)}₽</td>
        <td style="text-align:right"><button class="btn btn-sm btn-secondary" onclick="deleteHistoryLogEntry('${esc(row.id)}')" style="padding:4px 8px;font-size:11px">Удалить</button></td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }
}

// COMPARE
function loadCompareSelects(){const all=getAllWithMy();const opts=all.map(c=>`<option value="${c.id}">${esc(c.name)}${c.id==='MY'?' ⭐':''}</option>`).join('');document.getElementById('compareA').innerHTML=opts;document.getElementById('compareB').innerHTML=opts;if(all.length>1)document.getElementById('compareB').selectedIndex=1}
function runCompare(){
  const all=getAllWithMy();const a=all.find(c=>c.id===document.getElementById('compareA').value),b=all.find(c=>c.id===document.getElementById('compareB').value);
  if(!a||!b){document.getElementById('compareResult').innerHTML='';return}
  const metrics=[{l:'Стул Непал',k:'nepal'},{l:'Стул Лорен',k:'loren'},{l:'Стул Модерн',k:'modern'},{l:'Стул пластик',k:'plasticChair'},{l:'Стул дерево',k:'woodChair'},{l:'Стул металл',k:'metalChair'},{l:'Тарелка закуска',k:'plateSnack'},{l:'Тарелка обед',k:'plateDinner'},{l:'Тарелка подстановочная',k:'plateSub'},{l:'Бокал вино',k:'glassWine'},{l:'Бокал флюте',k:'glassFlute'},{l:'Бокал мартинка',k:'glassMartini'},{l:'Бокал рокс',k:'glassRocks'},{l:'Приборы',k:'cutlerySet'},{l:'Доставка город',k:'delivery'},{l:'Доставка за км',k:'deliveryKm'},{l:'Сетап тарелки',k:'setupPlates'},{l:'Сетап бокалы',k:'setupGlasses'},{l:'Сетап приборы',k:'setupCutlery'},{l:'Сетап стулья металл',k:'setupMetalChair'},{l:'Сетап стулья пластик',k:'setupPlasticChair'},{l:'Сетап стулья подушка',k:'setupCushionChair'},{l:'Проф. скидка',k:'proDiscount'}];
  let h=`<table class="compare-table"><thead><tr><th>Метрика</th><th>${esc(a.name)}${a.id==='MY'?' ⭐':''}</th><th>${esc(b.name)}${b.id==='MY'?' ⭐':''}</th><th>Разница</th></tr></thead><tbody>`;
  metrics.forEach(m=>{const va=Number(a[m.k])||0,vb=Number(b[m.k])||0,d=va-vb;let ca='compare-equal',cb='compare-equal';if(va&&vb&&va!==vb){ca=va<vb?'compare-win':'compare-lose';cb=vb<va?'compare-win':'compare-lose'}const u=m.k==='proDiscount'?'%':'₽';h+=`<tr><td style="font-weight:500">${m.l}</td><td class="mono ${ca}">${va?fN(va)+u:'—'}</td><td class="mono ${cb}">${vb?fN(vb)+u:'—'}</td><td class="mono" style="color:var(--text2)">${d===0?'—':(d>0?'+':'')+fN(d)+u}</td></tr>`});
  h+='</tbody></table>';document.getElementById('compareResult').innerHTML=h}

// AI ANALYSIS
async function runAiAnalysis(){
  const btn=document.getElementById('aiBtn');
  const panel=document.getElementById('aiPanel');
  const result=document.getElementById('aiResult');
  btn.disabled=true;btn.textContent='⏳ Анализирую...';
  panel.style.display='block';
  result.textContent='Загружаю данные и анализирую рынок...';
  try{
    const f=filtered();const my=myCompany;
    let prompt='Ты — аналитик рынка аренды мебели и посуды для мероприятий в России. Проанализируй данные и дай конкретные рекомендации на русском языке.\n\n';
    const labels={'nepal':'Непал','loren':'Лорен','modern':'Модерн','plasticChair':'Пластик стул','woodChair':'Дерево стул','metalChair':'Металл стул','plateSnack':'Тарелка закуска','plateDinner':'Тарелка обед','plateSub':'Тарелка подстанов.','glassWine':'Бокал вино','glassFlute':'Флюте','glassMartini':'Мартинка','glassRocks':'Рокс','cutlerySet':'Приборы','delivery':'Доставка город','deliveryKm':'Доставка за км','setupPlates':'Сетап тарелки','setupGlasses':'Сетап бокалы','setupCutlery':'Сетап приборы','setupMetalChair':'Сетап стулья металл','setupPlasticChair':'Сетап стулья пластик','setupCushionChair':'Сетап стулья подушка','proDiscount':'Проф. скидка %'};
    const nk=Object.keys(labels);
    if(my&&my.name){
      prompt+='НАША КОМПАНИЯ: '+my.name+' ('+my.city+')\n';
      nk.forEach(k=>{const v=Number(my[k]);if(v)prompt+=labels[k]+': '+v+(k==='proDiscount'?'%':'₽')+'\n'});
      prompt+='\n';
    }
    if(f.length){
      prompt+='КОНКУРЕНТЫ ('+f.length+'):\n';
      f.forEach(c=>{prompt+='\n• '+c.name+' ('+c.city+'): ';const p=[];nk.forEach(k=>{const v=Number(c[k]);if(v)p.push(labels[k]+' '+v+(k==='proDiscount'?'%':'₽'))});prompt+=p.join(', ')||'нет данных'});
      prompt+='\n\n';
    }
    prompt+='Фильтр: '+(cityFilter==='all'?'все города':cityFilter)+'\n\n';
    prompt+='Дай краткий анализ:\n1. ПОЗИЦИЯ НА РЫНКЕ\n2. СИЛЬНЫЕ СТОРОНЫ\n3. СЛАБЫЕ СТОРОНЫ\n4. РЕКОМЕНДАЦИИ\nБудь конкретен, используй цифры.';
    // Запрос идёт через Google Apps Script (прокси) — так не нужен API-ключ в браузере и нет CORS-ограничений
    const r=await api('aiAnalysis',{prompt});
    const text=r.success?(r.text||r.response||r.content||'Нет ответа от AI'):'Функция AI-анализа не настроена. Добавьте обработчик действия aiAnalysis в ваш Google Apps Script с вызовом Claude API.';
    result.textContent=text;
  }catch(err){result.textContent='Ошибка: '+err.message}
  btn.disabled=false;btn.textContent='🤖 Анализ рынка';
}

// UI
function openModal(id){document.getElementById(id).classList.add('active')}
function closeModal(id,force=false){
  if(!force&&typeof window.canCloseModal==='function'&&!window.canCloseModal(id))return;
  document.getElementById(id).classList.remove('active');
}
document.querySelectorAll('.modal-overlay').forEach(el=>{el.addEventListener('click',e=>{if(e.target===el)closeModal(el.id)})});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-overlay.active').forEach(m=>closeModal(m.id))});
function showToast(msg,type='success'){const c=document.getElementById('toasts'),t=document.createElement('div');t.className=`toast ${type}`;t.innerHTML=`${type==='success'?'✓':'✕'} ${esc(msg)}`;c.appendChild(t);setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),300)},3000)}
function esc(s){if(s==null)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function fN(n){return Number(n||0).toLocaleString('ru-RU')}
function fP(n){return fN(n)+'₽'}
function v(n){const x=Number(n);return x?fP(x):'—'}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
