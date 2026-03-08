const API_URL='https://script.google.com/macros/s/AKfycbyfZW_xGihRzBcgOs6YLFkqtvrs4Oag3NgT4RiUqPG0gHXgoQXnU1m_FuXTjxTDqkA2/exec';
let currentUser=null,competitors=[],myCompany=null,history=[],charts={},cityFilter='all';
let isLoggingIn=false;
const NUM='nepal,loren,modern,plasticChair,woodChair,metalChair,plateSnack,plateDinner,plateSub,glassWine,glassFlute,glassMartini,glassRocks,cutlerySet,delivery,deliveryKm,setupPlates,setupGlasses,setupCutlery,setupMetalChair,setupPlasticChair,setupCushionChair,proDiscount'.split(',');
const STR='name,city,website,instagram,phone,notes'.split(',');
const ALL=[...STR,...NUM];

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

async function loadAll(){await loadCompetitors();await loadMyCompanyData();await loadHistory();loadDashboard();loadCompareSelects()}

async function syncAllToSupabase(){
  if(!window.supabaseWrite){showToast('Supabase не настроен','error');return}
  showToast('Синхронизация...','info');
  let ok=0,fail=0;
  // Заказы
  const ro=await api('getOrders');
  if(ro.success&&Array.isArray(ro.orders)){
    for(const o of ro.orders){
      try{await window.supabaseWrite('upsertOrder',o);ok++}catch(e){fail++}
    }
  }
  // Конкуренты
  if(competitors.length){
    try{await window.supabaseWrite('upsertCompetitors',competitors);ok++}catch(e){fail++}
  }
  // Моя компания
  if(myCompany){
    try{await window.supabaseWrite('upsertMyCompany',myCompany);ok++}catch(e){fail++}
  }
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
async function loadCompetitors(){const r=await api('getCompetitors');if(r.success){competitors=r.entries||r.competitors||[];renderCompetitors();sbBackup('upsertCompetitors',competitors)}}
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
async function saveComp(){const id=document.getElementById('cId').value;const comp=getCompForm();if(!comp.name){showToast('Укажите название','error');return}if(id){comp.id=id;await api('updateCompetitor',{competitor:comp});showToast('Обновлено','success')}else{await api('addCompetitor',{competitor:comp});showToast('Добавлено','success')}closeModal('modalComp');await loadAll()}
async function deleteComp(id){if(!confirm('Удалить?'))return;await api('deleteCompetitor',{id});sbBackup('deleteCompetitor',{id});showToast('Удалено','success');await loadAll()}

// MY COMPANY (Google Sheets)
async function loadMyCompanyData(){const r=await api('getMyCompany');if(r.success&&r.company)myCompany=r.company;fillMyForm()}
function fillMyForm(){if(!myCompany)return;ALL.forEach(f=>{const el=document.getElementById('my'+cap(f));if(el)el.value=myCompany[f]||''})}
async function saveMyCompany(){const o={};ALL.forEach(f=>{const el=document.getElementById('my'+cap(f));if(el)o[f]=NUM.includes(f)?Number(el.value)||0:el.value.trim()});const r=await api('saveMyCompany',{company:o});if(r.success){myCompany={...o,id:'MY'};sbBackup('upsertMyCompany',myCompany);showToast('Сохранено','success');loadDashboard();loadCompareSelects()}else showToast('Ошибка сохранения','error')}

// HISTORY
async function loadHistory(){const r=await api('getHistory');if(r.success)history=r.history||[]}

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

  // History chart
  const months=[...new Set(history.map(h=>h.month))].sort();
  if(months.length>1){
    const clrs=['#3478f6','#8944d6','#d48806','#e5352b','#2a9d52','#5ac8fa'];
    const cids=[...new Set(history.map(h=>h.companyId))];
    const ds=cids.map((cid,i)=>{const rows=history.filter(h=>h.companyId===cid);return{label:rows[0]?.companyName||cid,data:months.map(m=>{const r=rows.find(h=>h.month===m);return r?Number(r.nepal)||0:null}),borderColor:clrs[i%clrs.length],tension:.3,pointRadius:3,fill:false,spanGaps:true}});
    charts.history=new Chart(document.getElementById('chartHistory'),{type:'line',data:{labels:months,datasets:ds},options:{...defs,plugins:{...defs.plugins,legend:{display:true,labels:{color:'#6e6e78',font:{family:'Inter',size:9},boxWidth:8}}}}});
  }else{
    const ctx=document.getElementById('chartHistory').getContext('2d');ctx.font='13px Inter';ctx.fillStyle='#9d9da8';ctx.textAlign='center';ctx.fillText('История появится после первого обновления данных',ctx.canvas.width/2,120);
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
function esc(s){if(s==null)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML}
function fN(n){return Number(n||0).toLocaleString('ru-RU')}
function fP(n){return fN(n)+'₽'}
function v(n){const x=Number(n);return x?fP(x):'—'}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
