// ── SAVE BUTTON GUARD (prevents double-click, shows spinner) ──
function withSaveGuard(btn,asyncFn){
  if(!btn||btn.disabled)return;
  const orig=btn.innerHTML;
  btn.disabled=true;
  btn.style.opacity='0.6';
  btn.style.pointerEvents='none';
  btn.innerHTML='<span class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></span>Сохранение...';
  asyncFn().catch(e=>{console.error(e);showToast('Ошибка: '+e.message,'error')}).finally(()=>{
    btn.innerHTML=orig;
    btn.disabled=false;
    btn.style.opacity='';
    btn.style.pointerEvents='';
  });
}
// ========== CRM MODULE ==========
let crmOrders=[],crmStock=[],crmCategories=[],crmCategoriesData=[],crmActiveStockCategory='',crmQuickFilter='all',crmYearFilter=new Date().getFullYear(),crmClients=[],crmClientsYears=[new Date().getFullYear()],crmClientsAllYears=false,crmClientAnalyticsOpen=false,crmStockAnalyticsOpen=false,crmClientProfileState={id:'',openCats:{}};
let crmStockOpenGroups={};
let crmOrderDialogDirty=false,crmOrderDialogInit=false,crmLegacyModeAtOpen=false,crmOrderInputsBound=false;
let crmClientDropdownOpen=false;
const CRM_CLIENTS_PRESET=[
  {name:'Светлана Новикова',company:'Семицветик',phone:'8-928-175-59-97'},
  {name:'Ирина Лазарь',company:'Lazar decor',phone:'8-928-145-35-67'},
  {name:'Алеся Вавилова',company:'Лютик',phone:'8-903-462-04-40'},
  {name:'Ирина Пушкарева',company:'Организатор',phone:'8-928-773-79-70'},
  {name:'Анастасия Фисун',company:'Perlamutr decor',phone:'8-938-104-70-12'},
  {name:'Дарья Садчикова',company:'Русские сезоны',phone:'8-928-279-49-82'},
  {name:'Ирина Нечипоренко',company:'COBA',phone:'8-903-400-66-70'},
  {name:'Дарья Речиц',company:'Decoral',phone:'8-928-172-46-32'},
  {name:'Варт Данелян',company:'Sweet Rose',phone:'8-903-488-88-11'},
  {name:'Дарья Сидоровская/Менеджер',company:'Lazar decor',phone:'8-988-991-10-92'},
  {name:'Анастасия Штукатурова',company:'Lu Flowers',phone:'8-961-412-53-88'},
  {name:'Елена Алякина',company:'Для тебя',phone:'8-961-415-62-64'},
  {name:'Галина Хангалдова',company:'Gallawedding',phone:'8-989-702-95-03'},
  {name:'Ксения Карпенко',company:'Madrina Wedding',phone:'8-961-432-66-00'},
  {name:'Татьяна Голотова',company:'White Studio',phone:'8-988-540-58-59'},
  {name:'Лусине Кочарян',company:'Lusi Decor',phone:'8-951-837-04-42'},
  {name:'Анна Запорожцева',company:'Decoral',phone:'8-908-184-94-34'},
  {name:'Анастасия Моисеенко/Менеджер',company:'Студия Анастасии Аникановой',phone:'8-952-562-87-97'},
  {name:'Рена Кочарян',company:'Wedding Rena',phone:'8-928-142-72-57'},
  {name:'Анна Антонова',company:'',phone:'8-938-119-13-51'},
  {name:'Елена Шарганова',company:'',phone:'8-918-561-11-00'},
  {name:'Мария/Администратор',company:'Голицын/Администратор',phone:'8-928-150-83-83'},
  {name:'Екатерина',company:'Theferst_event',phone:''},
  {name:'Елена Притоцкая',company:'Event Bureau',phone:'8-989-214-53-34'},
  {name:'Екатерина Самохвалова/Организатор',company:'',phone:'8-928-270-97-57'},
  {name:'Ирина Ковалева',company:'',phone:'8-918-528-88-38'},
  {name:'Анастасия Михайлова',company:'',phone:'8-938-106-05-35'},
  {name:'Виктория Попова',company:'',phone:'8-908-507-67-85'},
  {name:'Анастасия Аниканова',company:'Студия Анастасии Аникановой',phone:'8-952-562-87-07'},
  {name:'Валерия Шилова',company:'Perlamutr decor',phone:'8-908-173-05-14'},
  {name:'Полина Мазитова/Организатор',company:'Holly Polly',phone:'8-928-270-85-56'},
  {name:'Галина Кравченко',company:'',phone:'8-909-433-04-77'},
  {name:'Екатерина Сухомлинова',company:'Оливка декор',phone:'8-918-515-24-05'},
  {name:'Маргарита Саламатина',company:'Perlamutr decor',phone:'8-989-716-47-06'},
  {name:'Екатерина Богунова',company:'BLOOMROOM',phone:'8-988-536-27-98'},
  {name:'Диана Филипченко',company:'',phone:'8-989-505-16-18'},
  {name:'Анна Атанова',company:'',phone:'8-938-118-13-51'},
  {name:'Елена Селина',company:'Частник',phone:'8-928-270-70-67'},
  {name:'Яна Мигас/координатор',company:'',phone:'8-928-214-01-14'},
  {name:'Анна Живая',company:'Воздушные шары/Зефир Декор',phone:'8-928-901-44-80'},
  {name:'Евгения Костенко',company:'',phone:'8-961-324-34-36'},
  {name:'Анна Вошанова',company:'Holly Polly',phone:'8-938-149-77-47'},
  {name:'Астра/менеджер Пушкаревой',company:'',phone:'8-988-255-88-55'},
  {name:'Юлия Павлятенко',company:'',phone:'8-928-904-12-20'},
  {name:'Юлия Болонкина',company:'',phone:'8-918-593-29-79'},
  {name:'Эдвард Нерсесян/ведущий',company:'',phone:'8-961-433-11-11'},
  {name:'Нина Булатенко',company:'',phone:'8-928-900-09-19'},
  {name:'Анастасия Ганина',company:'Влада Веддинг',phone:'8-928-198-00-15'},
  {name:'Елена Патлань/организатор',company:'',phone:'8-918-592-87-07'},
  {name:'Ирина Быкова',company:'Лазарь Декор',phone:'8-903-434-86-03'},
  {name:'Екатерина Витковская',company:'',phone:''},
  {name:'Галина Данковцева/флорист, декоратор',company:'Flowers Skalet',phone:'8-918-147-25-47'}
];
const crmPricingDefaults={
  deliveryBaseCity:7200,
  deliveryPerKm:110,
  setupMin:2500,
  setupChairNepalMetal:80,
  setupChairNepal:105,
  setupChairModern:60,
  setupChairModernWood:50,
  setupChairModernCushion:70,
  setupChairLoren:125,
  setupGlass:55,
  setupPlate:45
};
let crmPricing={...crmPricingDefaults};
function crmParseDateLocal(v){
  if(!v)return null;
  const s=String(v).slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){
    const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
    return new Date(y,mo-1,d);
  }
  const dt=new Date(v);
  return Number.isNaN(dt.getTime())?null:dt;
}
function crmFormatDate(v){
  const s=String(v||'').slice(0,10);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return `${m[3]}.${m[2]}`;
  const dt=crmParseDateLocal(v);
  if(!dt)return '—';
  const dd=String(dt.getDate()).padStart(2,'0');
  const mm=String(dt.getMonth()+1).padStart(2,'0');
  return `${dd}.${mm}`;
}
function crmMonthTitle(v){
  const d=crmParseDateLocal(v);
  if(!d)return 'Без даты';
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(d);
}
function crmIsLegacyYearOrder(){
  return !!document.getElementById('crmOrderId').value;
}
function crmSyncLegacyMode(){
  const legacy=crmIsLegacyYearOrder();
  const amount=document.getElementById('crmAmount');
  const itemsTotal=document.getElementById('crmItemsTotal');
  const deliveryCost=document.getElementById('crmDeliveryCost');
  const setupCost=document.getElementById('crmSetupCost');
  if(amount){
    amount.readOnly=!legacy;
    amount.style.background=legacy?'var(--surface)':'var(--blue-dim)';
    amount.style.color=legacy?'var(--text)':'var(--blue)';
  }
  if(itemsTotal){
    itemsTotal.readOnly=!legacy;
    itemsTotal.style.background=legacy?'var(--surface)':'var(--surface2)';
  }
  if(deliveryCost){
    deliveryCost.style.background='var(--surface)';
  }
  if(setupCost){
    setupCost.style.background='var(--surface)';
  }
}
function crmRefreshRowsForYearMode(){
  const legacy=crmIsLegacyYearOrder();
  const list=document.getElementById('crmItemsList');
  if(!list)return;
  list.querySelectorAll('div').forEach(row=>{
    const catSel=row.querySelector('[data-cat]');
    const nameSel=row.querySelector('[data-name]');
    const priceSpan=row.querySelector('[data-price]');
    if(!catSel||!nameSel)return;
    const selectedName=nameSel.value;
    const its=crmStock.filter(s=>s.category===catSel.value);
    const selInStock=its.some(s=>s.name===selectedName);
    const selFallback=selectedName&&!selInStock?`<option value="${esc(selectedName)}" selected data-price="0" data-setup-rate="0">${esc(selectedName)}</option>`:'';
    nameSel.innerHTML='<option value="">Изделие</option>'+selFallback+its.map(s=>`<option value="${esc(s.name)}" data-price="${legacy?0:s.price}" data-setup-rate="${s.setupRate||0}" ${selectedName===s.name?'selected':''}>${esc(s.name)}${legacy?'':' — '+s.price+'₽'}</option>`).join('');
    const opt=nameSel.selectedOptions[0];
    priceSpan.textContent=legacy?'':(opt&&opt.dataset.price?opt.dataset.price+'₽':'');
  });
}
function crmSyncDateRange(fixEnd=true){
  const start=document.getElementById('crmStartDate');
  const end=document.getElementById('crmEndDate');
  if(!start||!end)return;
  end.min=start.value||'';
  if(fixEnd&&start.value&&end.value&&end.value<start.value)end.value=start.value;
}
function crmApplyPricingConfig(raw){
  if(!raw||typeof raw!=='object')return;
  const n={...crmPricingDefaults};
  Object.keys(n).forEach(k=>{
    const v=Number(raw[k]);
    if(Number.isFinite(v)&&v>=0)n[k]=v;
  });
  crmPricing=n;
}
function crmExtractPricingConfig(resp){
  if(!resp||!resp.success)return null;
  if(resp.config&&typeof resp.config==='object')return resp.config;
  if(Array.isArray(resp.rows)){
    const cfg={};
    resp.rows.forEach(r=>{
      const key=r?.key||r?.name||r?.param;
      const value=r?.value??r?.val??r?.amount;
      if(key!=null)cfg[String(key)]=value;
    });
    return cfg;
  }
  return null;
}
function crmSyncDepositUI(){
  const status=document.getElementById('crmDepositStatus')?.value||'pending';
  const cf=document.getElementById('crmCompensationFields');
  if(cf)cf.style.display=status==='returned_comp'?'block':'none';
}
function crmSyncDeliveryControls(autoFocus=false){
  const type=document.getElementById('crmDeliveryType')?.value||'pickup';
  const zone=document.getElementById('crmDeliveryZone')?.value||'city';
  const block=document.getElementById('crmDeliveryOptions');
  const km=document.getElementById('crmDeliveryKm');
  if(block)block.style.display=type==='delivery'?'grid':'none';
  if(km)km.disabled=!(type==='delivery'&&zone==='outside');
  if(autoFocus&&type==='delivery'&&zone==='outside')setTimeout(()=>km?.focus(),50);
}
function crmCalcDeliveryCost(){
  const type=document.getElementById('crmDeliveryType')?.value||'pickup';
  const zone=document.getElementById('crmDeliveryZone')?.value||'city';
  const km=Math.max(0,Number(document.getElementById('crmDeliveryKm')?.value||0));
  if(type!=='delivery')return 0;
  if(zone==='outside')return Math.round(crmPricing.deliveryBaseCity+km*crmPricing.deliveryPerKm);
  return Math.round(crmPricing.deliveryBaseCity);
}
function crmItemSetupRate(name,category){
  const s=`${String(name||'')} ${String(category||'')}`.toLowerCase();
  if(s.includes('лорен'))return crmPricing.setupChairLoren;
  if(s.includes('модерн')&&s.includes('подуш'))return crmPricing.setupChairModernCushion;
  if(s.includes('модерн')&&(s.includes('вяз')||s.includes('дерево')))return crmPricing.setupChairModernWood;
  if(s.includes('модерн'))return crmPricing.setupChairModern;
  if(s.includes('непал')&&(s.includes('метал')||s.includes('спинк')))return crmPricing.setupChairNepalMetal;
  if(s.includes('непал'))return crmPricing.setupChairNepal;
  if(s.includes('бокал')||s.includes('флют')||s.includes('мартин')||s.includes('рокс')||s.includes('glass'))return crmPricing.setupGlass;
  if(s.includes('тарел'))return crmPricing.setupPlate;
  return 0;
}
function crmCalcSetupCost(){
  let total=0;
  document.getElementById('crmItemsList')?.querySelectorAll('[data-qty]').forEach(q=>{
    const row=q.parentElement;
    const setupCheck=row.querySelector('[data-setup]');if(setupCheck&&!setupCheck.checked)return;
    const opt=row.querySelector('[data-name]')?.selectedOptions[0];
    const qty=Math.max(0,Number(q.value||0));
    const rate=Number(opt?.dataset.setupRate||0);
    total+=rate*qty;
  });
  if(total>0&&total<crmPricing.setupMin)total=crmPricing.setupMin;
  return Math.round(total);
}
function crmApplyZeroClearBehavior(scope){
  scope.querySelectorAll('input[type="number"]').forEach(inp=>{
    if(inp.dataset.zeroClear==='off')return;
    if(inp.dataset.zeroClearBound==='1')return;
    inp.dataset.zeroClearBound='1';
    inp.addEventListener('focus',()=>{
      if(inp.value==='0'){
        inp.value='';
        setTimeout(()=>{try{inp.select();}catch{}},0);
      }
    });
    inp.addEventListener('input',()=>{
      if(/^0\d+$/.test(inp.value))inp.value=String(Number(inp.value));
    });
  });
}
function crmPositionClientDropdown(){
  const dropdown=document.getElementById('crmClientDropdown');
  const input=document.getElementById('crmClient');
  if(!dropdown||!input)return;
  const rect=input.getBoundingClientRect();
  if(window.innerWidth<=768){
    dropdown.style.top=`${Math.round(rect.bottom+6)}px`;
  }else{
    dropdown.style.top='calc(100% + 6px)';
  }
}
function crmRenderClientDropdown(query=''){
  const dropdown=document.getElementById('crmClientDropdown');
  if(!dropdown)return;
  const q=String(query||'').toLowerCase().trim();
  const matches=crmClients
    .filter(c=>!q||[c.name,c.company,c.phone].join(' ').toLowerCase().includes(q))
    .slice(0,30);
  if(!matches.length){
    dropdown.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--text3)">Ничего не найдено</div>';
    return;
  }
  dropdown.innerHTML=matches.map(c=>`<button type="button" class="crm-client-option" data-name="${esc(c.name)}" onclick="crmPickClient('${esc(c.name)}')"><strong>${esc(c.name)}</strong><span>${esc(c.company||'—')} ${c.phone?`· ${esc(c.phone)}`:''}</span></button>`).join('');
}
function crmOpenClientDropdown(forceAll){
  const input=document.getElementById('crmClient');
  const dropdown=document.getElementById('crmClientDropdown');
  const toggle=document.getElementById('crmClientToggle');
  if(!input||!dropdown)return;
  crmPositionClientDropdown();
  crmRenderClientDropdown(forceAll?'':input.value);
  dropdown.style.display='block';
  crmClientDropdownOpen=true;
  if(toggle)toggle.textContent='▲';
}
function crmCloseClientDropdown(){
  const dropdown=document.getElementById('crmClientDropdown');
  const toggle=document.getElementById('crmClientToggle');
  if(dropdown)dropdown.style.display='none';
  crmClientDropdownOpen=false;
  if(toggle)toggle.textContent='▼';
}
function crmToggleClientDropdown(){
  if(crmClientDropdownOpen)crmCloseClientDropdown();
  else crmOpenClientDropdown(true);
}
function crmPickClient(name){
  const input=document.getElementById('crmClient');
  if(input)input.value=name;
  crmClientApplyToOrder(name);
  crmCloseClientDropdown();
}
function crmBindDialogInputs(){
  if(crmOrderInputsBound)return;
  const m=document.getElementById('crmOrderModal');
  if(!m)return;
  crmOrderInputsBound=true;
  m.addEventListener('input',()=>{if(!crmOrderDialogInit)crmOrderDialogDirty=true});
  m.addEventListener('change',()=>{if(!crmOrderDialogInit)crmOrderDialogDirty=true});
  crmApplyZeroClearBehavior(m);
  const start=document.getElementById('crmStartDate');
  const end=document.getElementById('crmEndDate');
  start?.addEventListener('focus',()=>{try{start.showPicker?.()}catch{}});
  end?.addEventListener('focus',()=>{try{end.showPicker?.()}catch{}});
  document.getElementById('crmDeliveryType')?.addEventListener('change',()=>{const dc=document.getElementById('crmDeliveryCost');if(dc)dc.dataset.manual='';crmSyncDeliveryControls();crmCalcTotal()});
  document.getElementById('crmDeliveryZone')?.addEventListener('change',()=>{const dc=document.getElementById('crmDeliveryCost');if(dc)dc.dataset.manual='';crmSyncDeliveryControls(true);crmCalcTotal()});
  document.getElementById('crmDeliveryKm')?.addEventListener('input',()=>{const dc=document.getElementById('crmDeliveryCost');if(dc)dc.dataset.manual='';crmCalcTotal();});
  document.getElementById('crmDeliveryCost')?.addEventListener('input',e=>{e.target.dataset.manual='1';crmCalcTotal();});
  document.getElementById('crmSetupCost')?.addEventListener('input',e=>{e.target.dataset.manual='1';crmCalcTotal();});
  document.getElementById('crmPaidAmount')?.addEventListener('input',crmSyncPaidAndRemaining);
  document.getElementById('crmPayment')?.addEventListener('change',crmSyncPaidAndRemaining);
  const clientInput=document.getElementById('crmClient');
  clientInput?.addEventListener('focus',()=>crmOpenClientDropdown(false));
  clientInput?.addEventListener('input',e=>crmOpenClientDropdown(false));
  clientInput?.addEventListener('change',e=>crmClientApplyToOrder(e.target.value));
  clientInput?.addEventListener('blur',()=>setTimeout(()=>{
    const exact=crmClients.find(c=>c.name===clientInput.value);
    if(exact)crmClientApplyToOrder(exact.name);
    crmCloseClientDropdown();
  },120));
  window.addEventListener('resize',crmPositionClientDropdown);
}
function crmHandleStartDateChange(){
  crmSyncDateRange(true);
  const prevLegacy=crmLegacyModeAtOpen;
  const nowLegacy=crmIsLegacyYearOrder();
  crmSyncLegacyMode();
  if(prevLegacy!==nowLegacy)crmRefreshRowsForYearMode();
  crmLegacyModeAtOpen=nowLegacy;
  crmSyncDeliveryControls();
  crmCalcTotal();
}
function crmCanCloseOrderDialog(){
  if(!document.getElementById('crmOrderModal')?.classList.contains('active'))return true;
  if(!crmOrderDialogDirty)return true;
  showToast('Есть несохранённые изменения. Нажмите Отмена или Сохранить.','error');
  return false;
}
function crmCancelOrderDialog(){
  crmOrderDialogDirty=false;
  closeModal('crmOrderModal',true);
}
async function crmFillSetupRates(){
  const toUpdate=crmStock.filter(s=>!Number(s.setupRate));
  if(!toUpdate.length)return;
  for(const s of toUpdate){
    const rate=crmItemSetupRate(s.name,s.category);
    if(!rate)continue;
    s.setupRate=rate;
    await api('updateStockItem',{item:s});
    sbBackup('upsertStockItem',s);
  }
}
async function crmInit(){
  const[r1,r2,r3,r4,r5]=await Promise.all([api('getOrders'),api('getStock'),api('getPricingConfig'),api('getCategories'),api('getClients')]);
  if(r1.success)crmOrders=(r1.orders||[]).map(crmNormalize);
  if(r2.success)crmStock=r2.stock||[];
  if(r4?.success&&(r4.categories||[]).length){
    crmCategoriesData=r4.categories||[];
    crmCategories=crmCategoriesData.map(c=>c.name);
  }else{
    crmCategories=[...new Set(['Приборы',...crmStock.map(s=>s.category).filter(Boolean)])].sort();
  }
  if(r5?.success&&Array.isArray(r5.clients))crmClients=crmDedupClients(r5.clients);
  else crmClients=[];
  crmApplyPricingConfig(crmExtractPricingConfig(r3));
  crmRenderAll();
  crmFillSetupRates();
}
function crmNormalize(o){
  let items=Array.isArray(o.items)?o.items:[];
  if(typeof o.items==='string')try{items=JSON.parse(o.items)}catch{items=[]}
  const orderAmount=Number(o.orderAmount||0);
  const remainingAmount=Math.max(0,Number(o.remainingAmount||0));
  const paidAmount=Math.max(0,Number(o.paidAmount!=null?o.paidAmount:o.paid_amount!=null?o.paid_amount:Math.max(0,orderAmount-remainingAmount)));
  return{id:o.id||'',clientName:o.clientName||'',clientPhone:o.clientPhone||'',companyName:o.companyName||'',startDate:o.startDate?String(o.startDate).slice(0,10):'',endDate:o.endDate?String(o.endDate).slice(0,10):'',orderAmount,budgetAmount:Number(o.budgetAmount||0),depositAmount:Number(o.depositAmount||0),deliveryCost:Number(o.deliveryCost||0),setupCost:Number(o.setupCost||0),discount:Number(o.discount||0),paidAmount,remainingAmount,status:o.status||'preparing',paymentStatus:o.paymentStatus||'pending_confirmation',deliveryType:o.deliveryType||'pickup',deliveryAddress:o.deliveryAddress||'',setupRequired:o.setupRequired||'no',items:items.map(i=>({name:String(i.name||'').trim(),qty:String(i.qty||'1'),category:String(i.category||'').trim(),price:Number(i.price||0),setup:i.setup!==undefined?i.setup:true})),comment:o.comment||'',carryFloor:o.carryFloor||o.carry_floor||'no',depositStatus:o.depositStatus||o.deposit_status||'pending',compensationAmount:Number(o.compensationAmount||o.compensation_amount||0),compensationNote:o.compensationNote||o.compensation_note||''};
}
function crmNormalizeClient(c){
  return{
    id:String(c?.id||''),
    name:String(c?.name||c?.clientName||'').trim(),
    company:String(c?.company||c?.companyName||'').trim(),
    phone:String(c?.phone||c?.clientPhone||'').trim(),
    proDiscount:Number(c?.proDiscount||c?.pro_discount||0)||0,
    city:String(c?.city||'Ростов-на-Дону').trim(),
    comment:String(c?.comment||'').trim()
  };
}
function crmClientKey(name){
  return String(name||'').toLowerCase().replace(/\s+/g,' ').trim();
}
function crmDedupClients(list){
  const out=[];
  const byName={};
  (list||[]).forEach((raw,ix)=>{
    const c=crmNormalizeClient(raw);
    const key=crmClientKey(c.name);
    if(!key)return;
    const found=byName[key];
    if(found==null){
      if(!c.id)c.id='LOCAL_'+ix;
      byName[key]=out.length;
      out.push(c);
      return;
    }
    const cur=out[found];
    if(!cur.phone&&c.phone)cur.phone=c.phone;
    if(!cur.company&&c.company)cur.company=c.company;
    if((Number(cur.proDiscount)||0)<(Number(c.proDiscount)||0))cur.proDiscount=Number(c.proDiscount)||0;
  });
  return out.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function crmDeriveClientsFromOrders(){
  const map={};
  crmOrders.forEach((o,ix)=>{
    const name=String(o.clientName||'').trim();
    if(!name)return;
    const key=name.toLowerCase();
    if(!map[key])map[key]={id:`LOCAL_${ix}`,name,company:String(o.companyName||'').trim(),phone:String(o.clientPhone||'').trim(),proDiscount:Number(o.discount||0)||0};
    if(!map[key].phone&&o.clientPhone)map[key].phone=String(o.clientPhone).trim();
    if(!map[key].company&&o.companyName)map[key].company=String(o.companyName).trim();
    map[key].proDiscount=Math.max(map[key].proDiscount,Number(o.discount||0)||0);
  });
  return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function crmPresetClients(){
  return CRM_CLIENTS_PRESET.map((c,i)=>({
    id:`PRESET_${String(i+1).padStart(3,'0')}`,
    name:String(c.name||'').trim(),
    company:String(c.company||'').trim(),
    phone:String(c.phone||'').trim(),
    proDiscount:0
  })).filter(c=>c.name);
}
function crmMergeClients(base,extra){
  const out=crmDedupClients(base||[]);
  const byName={};
  out.forEach((c,idx)=>{byName[crmClientKey(c.name)]=idx});
  (extra||[]).forEach(c=>{
    const key=crmClientKey(c.name);
    if(!key)return;
    const idx=byName[key];
    if(idx==null){byName[key]=out.length;out.push(c);return}
    const cur=out[idx];
    if(!cur.phone&&c.phone)cur.phone=c.phone;
    if(!cur.company&&c.company)cur.company=c.company;
    if((Number(cur.proDiscount)||0)<(Number(c.proDiscount)||0))cur.proDiscount=Number(c.proDiscount)||0;
  });
  return crmDedupClients(out);
}
function crmCleanItemName(name){
  return String(name||'').replace(/\s*[—-]\s*\d[\d\s]*\s*₽\s*$/,'').trim();
}
function crmGetItemDisplayName(item){
  const name=crmCleanItemName(item?.name||'');
  const category=String(item?.category||'').trim();
  return name||category||'—';
}
function crmGetSelectedItemName(nameSel,category){
  const rawValue=crmCleanItemName(nameSel?.value||'');
  const optionText=crmCleanItemName(nameSel?.selectedOptions?.[0]?.textContent||'');
  if(optionText&&rawValue===String(category||'').trim()&&optionText!==rawValue)return optionText;
  return rawValue||optionText;
}
function crmRenderAll(){crmRenderOrders();crmRenderStats();crmRenderClients();crmRenderStock();crmRenderDash();crmSyncQuickFilterUI()}
function crmSyncQuickFilterUI(){
  const map={month:'crmMonthOrders',not_completed:'crmNotCompleted',assembly:'crmAssembly',tomorrow:'crmTomorrow'};
  Object.entries(map).forEach(([key,id])=>document.getElementById(id)?.classList.toggle('active',crmQuickFilter===key));
}
function crmFilteredOrders(){
  const s=document.getElementById('crmSearchInput')?.value.toLowerCase()||'';
  const cf=document.getElementById('crmCompletionFilter')?.value||'not_completed';
  const sf=document.getElementById('crmStatusFilter')?.value||'all';
  const pf=document.getElementById('crmPaymentFilter')?.value||'all';
  return crmOrders.filter(o=>{
    const d0=crmParseDateLocal(o.startDate);if(!d0)return false;
    const oy=d0.getFullYear();
    if(crmYearFilter&&oy!==crmYearFilter)return false;
    if(crmQuickFilter==='month'){const now=new Date();const d=crmParseDateLocal(o.startDate);return d&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}
    if(crmQuickFilter==='assembly'){const now=new Date();now.setHours(0,0,0,0);const lim=new Date(now);lim.setDate(lim.getDate()+3);const d=crmParseDateLocal(o.startDate);return d&&o.status!=='completed'&&d>=now&&d<=lim}
    if(crmQuickFilter==='tomorrow'){const t=new Date();t.setDate(t.getDate()+1);t.setHours(0,0,0,0);const d=crmParseDateLocal(o.startDate);if(!d)return false;d.setHours(0,0,0,0);return d.getTime()===t.getTime()&&o.status!=='completed'}
    if(crmQuickFilter==='not_completed')return o.status!=='completed';
    if(cf==='completed')return o.status==='completed';
    if(cf==='not_completed')return o.status!=='completed';
    return true;
  }).filter(o=>sf==='all'||o.status===sf)
  .filter(o=>pf==='all'||o.paymentStatus===pf)
  .filter(o=>{if(!s)return true;return[o.clientName,o.clientPhone,o.deliveryAddress].join(' ').toLowerCase().includes(s)})
  .sort((a,b)=>(crmParseDateLocal(a.startDate)?.getTime()||0)-(crmParseDateLocal(b.startDate)?.getTime()||0));
}
const crmSL={preparing:'Подготовка',assembly:'Сборка',in_progress:'В работе',completed:'Выполнен'};
const crmPL={pending_confirmation:'На подтверждении',confirmed:'Подтвержден',prepaid:'Предоплата',paid:'Оплачен',paid_cash:'Оплачен наличными'};
const crmPaidStatuses=new Set(['paid','paid_cash']);
function crmRenderOrders(){
  const t=document.getElementById('crmOrdersTable');if(!t)return;
  const orders=crmFilteredOrders();
  if(!orders.length){t.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:30px">Нет заказов</td></tr>';return}
  const isMobile=window.innerWidth<=768;
  const depositBg={pending:'',deposited:'#e0edff',returned:'#dff6e8',returned_comp:'#ffe5ef'};
  const depositLbl={pending:'Залог',deposited:'Внесён',returned:'Вернули',returned_comp:'Компенс.'};
  let prevMonthKey='';
  let rowIndex=0;
  t.innerHTML=orders.map(o=>{
    rowIndex++;
    const d=crmParseDateLocal(o.startDate);
    const monthKey=d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`:'na';
    const sep=monthKey!==prevMonthKey?`<tr class="crm-month-sep"><td colspan="10"><span>${esc(crmMonthTitle(o.startDate))}</span></td></tr>`:'';
    prevMonthKey=monthKey;
    const remain=Number(o.remainingAmount||0);
    const showRemain=remain>0&&!crmPaidStatuses.has(o.paymentStatus);
    const deliveryCell=o.deliveryType==='pickup'?'Самовывоз':esc(o.deliveryAddress||'');
    const itemsList=(o.items||[]).length
      ? `<div class="crm-items-mobile-list" style="display:flex;flex-direction:column;gap:3px;white-space:normal">${(o.items||[]).map(i=>`<div>• ${esc(crmGetItemDisplayName(i))} ×${esc(i.qty)}</div>`).join('')}</div>`
      : '—';
    if(isMobile){
      return `${sep}<tr class="crm-order-mobile-card"><td colspan="10">
      <div class="crm-om-head">
        <div class="crm-om-client"><span class="crm-om-num">#${rowIndex}</span><strong>${esc(o.clientName)}</strong><span>${esc(o.clientPhone||'')}</span>${showRemain?`<span class="badge badge-amber">Остаток: ${fN(remain)}₽</span>`:''}</div>
        <div class="crm-om-actions"><button onclick="crmToggleItems('${o.id}')" class="crm-om-toggle" title="Показать изделия">↓</button><button class="btn btn-sm btn-secondary" onclick="crmOpenDialog('${o.id}')" style="padding:4px 8px;font-size:11px">✎</button></div>
      </div>
      <div class="crm-om-line"><span>Период</span><strong>${crmFormatDate(o.startDate)} — ${crmFormatDate(o.endDate)}</strong></div>
      <div class="crm-om-line"><span>Сумма</span><strong>${fN(o.orderAmount)}₽</strong></div>
      <div class="crm-om-line"><span>Доставка</span><strong>${deliveryCell}</strong></div>
      <div class="crm-om-grid">
        <div><span>Статус работы</span><select data-crm-status="${o.id}" style="padding:4px 28px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.status==='completed'?'#dff6e8':o.status==='in_progress'?'#e0edff':o.status==='assembly'?'#fff4d6':'#ffead4'};width:100%">${Object.entries(crmSL).map(([v,l])=>`<option value="${v}" ${o.status===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div><span>Статус оплаты</span><select data-crm-payment="${o.id}" style="padding:4px 28px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.paymentStatus==='paid'?'#dff6e8':o.paymentStatus==='paid_cash'?'#ffe5ef':o.paymentStatus==='prepaid'?'#f0e6ff':'#ffead4'};width:100%">${Object.entries(crmPL).map(([v,l])=>`<option value="${v}" ${o.paymentStatus===v?'selected':''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="crm-om-line"><span>Залог</span><select data-crm-deposit="${o.id}" style="padding:3px 28px 3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${depositBg[o.depositStatus]||''};min-width:120px">${Object.entries(depositLbl).map(([v,l])=>`<option value="${v}" ${o.depositStatus===v?'selected':''}>${l}</option>`).join('')}</select></div>
    </td></tr><tr id="crmItemsRow-${o.id}" style="display:none"><td colspan="10" style="padding:6px 10px 8px 12px;font-size:11px;color:var(--text2);background:var(--surface2)">${itemsList}</td></tr>`;
    }
    return `${sep}<tr>
    <td>${rowIndex}</td><td><strong>${esc(o.clientName)}</strong><br><span style="color:var(--text2);font-size:11px">${esc(o.clientPhone)}</span>${showRemain?`<br><span class="badge badge-amber" style="margin-top:4px">Остаток: ${fN(remain)}₽</span>`:''}<div class="crm-delivery-mobile">${deliveryCell}</div></td>
    <td><button onclick="crmToggleItems('${o.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--text2);padding:2px 4px" title="Показать изделия">↓</button></td>
    <td style="font-size:11px">${deliveryCell}</td>
    <td class="mono" style="font-size:11px">${crmFormatDate(o.startDate)} — ${crmFormatDate(o.endDate)}</td>
    <td class="mono">${fN(o.orderAmount)}₽</td>
    <td><select data-crm-status="${o.id}" style="padding:4px 28px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.status==='completed'?'#dff6e8':o.status==='in_progress'?'#e0edff':o.status==='assembly'?'#fff4d6':'#ffead4'};max-width:110px">${Object.entries(crmSL).map(([v,l])=>`<option value="${v}" ${o.status===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><select data-crm-payment="${o.id}" style="padding:4px 28px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.paymentStatus==='paid'?'#dff6e8':o.paymentStatus==='paid_cash'?'#ffe5ef':o.paymentStatus==='prepaid'?'#f0e6ff':'#ffead4'};max-width:130px">${Object.entries(crmPL).map(([v,l])=>`<option value="${v}" ${o.paymentStatus===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><select data-crm-deposit="${o.id}" style="padding:3px 28px 3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${depositBg[o.depositStatus]||''};max-width:100px">${Object.entries(depositLbl).map(([v,l])=>`<option value="${v}" ${o.depositStatus===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><button class="btn btn-sm btn-secondary" onclick="crmOpenDialog('${o.id}')" style="padding:4px 8px;font-size:11px">✎</button></td>
  </tr><tr id="crmItemsRow-${o.id}" style="display:none"><td colspan="10" style="padding:4px 10px 8px 24px;font-size:11px;color:var(--text2);background:var(--surface2)">${itemsList}</td></tr>`;
  }).join('');
  t.querySelectorAll('[data-crm-status]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmStatus;const o=crmOrders.find(x=>x.id===id);if(o){o.status=e.target.value;await api('updateOrder',{order:{id,status:e.target.value}});sbBackup('upsertOrder',o);crmRenderAll();showToast('Статус обновлён','success')}}));
  t.querySelectorAll('[data-crm-payment]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmPayment;const o=crmOrders.find(x=>x.id===id);if(o){const p=e.target.value;o.paymentStatus=p;const update={id,paymentStatus:p};if(crmPaidStatuses.has(p)){o.paidAmount=Number(o.orderAmount||0);o.remainingAmount=0;update.paidAmount=o.paidAmount;update.remainingAmount=0}await api('updateOrder',{order:update});sbBackup('upsertOrder',o);await crmSyncClientsToSupabase();crmRenderAll();showToast('Оплата обновлена','success')}}));
  t.querySelectorAll('[data-crm-deposit]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmDeposit;const o=crmOrders.find(x=>x.id===id);if(o){o.depositStatus=e.target.value;sel.style.background=depositBg[e.target.value]||'';await api('updateOrder',{order:{id,depositStatus:e.target.value}});sbBackup('upsertOrder',o);if(e.target.value==='returned_comp')crmOpenDialog(id);else showToast('Статус залога обновлён','success');}}))}
function crmRenderStats(){
  const now=new Date(),cm=now.getMonth(),cy=now.getFullYear();
  const mo=crmOrders.filter(o=>{const d=crmParseDateLocal(o.startDate);return d&&d.getMonth()===cm&&d.getFullYear()===cy});
  const nc=crmOrders.filter(o=>o.status!=='completed');
  document.getElementById('crmTotalOrders').textContent=mo.length;
  document.getElementById('crmActiveOrders').textContent=nc.length;
  const now2=new Date();now2.setHours(0,0,0,0);const lim=new Date(now2);lim.setDate(lim.getDate()+3);
  document.getElementById('crmAssemblyOrders').textContent=crmOrders.filter(o=>{const d=crmParseDateLocal(o.startDate);return d&&o.status!=='completed'&&d>=now2&&d<=lim}).length;
  const tm=new Date();tm.setDate(tm.getDate()+1);tm.setHours(0,0,0,0);
  document.getElementById('crmTomorrowOrders').textContent=crmOrders.filter(o=>{const d=crmParseDateLocal(o.startDate);if(!d)return false;d.setHours(0,0,0,0);return d.getTime()===tm.getTime()&&o.status!=='completed'}).length;
}
function crmClientMetrics(c,years,allYears){
  const name=String(c.name||'').trim().toLowerCase();
  let ordersCount=0,turnover=0,revenueNoLog=0;
  const yearSet=new Set((years||[]).map(Number).filter(Boolean));
  crmOrders.forEach(o=>{
    if(!crmPaidStatuses.has(o.paymentStatus))return;
    const d=crmParseDateLocal(o.startDate);if(!d)return;
    if(!allYears&&yearSet.size&&!yearSet.has(d.getFullYear()))return;
    if(String(o.clientName||'').trim().toLowerCase()!==name)return;
    const amount=Number(o.orderAmount||0);
    ordersCount++;
    turnover+=amount;
    revenueNoLog+=Math.max(0,amount-Number(o.deliveryCost||0)-Number(o.setupCost||0));
  });
  return{ordersCount,turnover,revenueNoLog};
}
function crmGetClientYears(){
  const nowY=new Date().getFullYear();
  return [...new Set([nowY,...crmOrders.map(o=>crmParseDateLocal(o.startDate)?.getFullYear()).filter(Boolean)])].sort((a,b)=>b-a);
}
function crmGetSelectedMultiNumbers(id){
  const el=document.getElementById(id);
  if(!el)return[];
  return Array.from(el.selectedOptions).map(o=>Number(o.value)).filter(Boolean);
}
function crmClientSelectedYears(selectId,allTimeId){
  if(document.getElementById(allTimeId)?.checked)return[];
  return crmGetSelectedMultiNumbers(selectId);
}
function crmGetPaidClientOrders(selectedYears,allTime){
  return crmOrders.filter(o=>{
    if(!crmPaidStatuses.has(o.paymentStatus))return false;
    const d=crmParseDateLocal(o.startDate);
    if(!d)return false;
    if(allTime)return true;
    if(!selectedYears.length)return d.getFullYear()===new Date().getFullYear();
    return selectedYears.includes(d.getFullYear());
  });
}
function crmAggregateClientsForPeriod(selectedYears,allTime){
  const known={};
  crmClients.forEach(c=>{known[crmClientKey(c.name)]={name:c.name,company:c.company||''};});
  const stats={};
  crmGetPaidClientOrders(selectedYears,allTime).forEach(o=>{
    const key=crmClientKey(o.clientName);
    if(!key)return;
    if(!stats[key]){
      const meta=known[key]||{name:String(o.clientName||'').trim(),company:String(o.companyName||'').trim()};
      stats[key]={name:meta.name,company:meta.company,orders:0,turnover:0,revenue:0,avg:0};
    }
    const amount=Number(o.orderAmount||0);
    stats[key].orders+=1;
    stats[key].turnover+=amount;
    stats[key].revenue+=Math.max(0,amount-Number(o.deliveryCost||0)-Number(o.setupCost||0));
  });
  return Object.values(stats).map(r=>({...r,avg:r.orders?Math.round(r.turnover/r.orders):0}));
}
function crmClientMetricValue(row,metric){
  if(metric==='revenue')return row.revenue;
  if(metric==='orders')return row.orders;
  if(metric==='avg')return row.avg;
  return row.turnover;
}
function crmClientMetricLabel(metric){
  if(metric==='revenue')return 'Выручка';
  if(metric==='orders')return 'Количество заказов';
  if(metric==='avg')return 'Средний чек';
  return 'Оборот';
}
function crmClientSelectedSortMetrics(){
  const metrics=[];
  if(document.getElementById('crmClientsDashMetricTurnover')?.checked)metrics.push('turnover');
  if(document.getElementById('crmClientsDashMetricRevenue')?.checked)metrics.push('revenue');
  if(document.getElementById('crmClientsDashMetricOrders')?.checked)metrics.push('orders');
  if(document.getElementById('crmClientsDashMetricAvg')?.checked)metrics.push('avg');
  return metrics;
}
function crmClientCombinedScore(row,allRows,metrics){
  return metrics.reduce((sum,metric)=>{
    const max=Math.max(...allRows.map(r=>crmClientMetricValue(r,metric)),1);
    return sum+(crmClientMetricValue(row,metric)/max);
  },0);
}
function crmFormatClientPeriod(years,allTime){
  if(allTime)return 'Все время';
  if(!years.length)return String(new Date().getFullYear());
  if(years.length===1)return String(years[0]);
  return years.slice().sort((a,b)=>a-b).join(', ');
}
function crmFillClientDashboardControls(){
  const years=crmGetClientYears();
  const topYears=document.getElementById('crmClientsDashYears');
  const trendYears=document.getElementById('crmClientTrendYears');
  const nowY=new Date().getFullYear();
  if(topYears){
    const prev=new Set(Array.from(topYears.selectedOptions).map(o=>Number(o.value)));
    topYears.innerHTML=years.map(y=>`<option value="${y}" ${prev.has(y)||(!prev.size&&y===nowY)?'selected':''}>${y}</option>`).join('');
  }
  if(trendYears){
    const prevTrend=new Set(Array.from(trendYears.selectedOptions).map(o=>Number(o.value)));
    trendYears.innerHTML=years.map(y=>`<option value="${y}" ${prevTrend.has(y)||(!prevTrend.size&&y===nowY)?'selected':''}>${y}</option>`).join('');
  }
  const trendQuery=(document.getElementById('crmClientTrendSearch')?.value||'').toLowerCase().trim();
  const compareQuery=(document.getElementById('crmClientTrendCompareSearch')?.value||'').toLowerCase().trim();
  const trendList=crmClients.filter(c=>!trendQuery||[c.name,c.company,c.phone].join(' ').toLowerCase().includes(trendQuery));
  const compareList=crmClients.filter(c=>!compareQuery||[c.name,c.company,c.phone].join(' ').toLowerCase().includes(compareQuery));
  const clientOptions='<option value="">Выберите клиента</option>'+trendList.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const compareOptions='<option value="">Выберите клиента</option>'+compareList.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const trendClient=document.getElementById('crmClientTrendTarget');
  const compareClient=document.getElementById('crmClientTrendCompareTarget');
  if(trendClient){
    const cur=trendClient.value;
    trendClient.innerHTML=clientOptions;
    trendClient.value=trendList.some(c=>c.name===cur)?cur:'';
  }
  if(compareClient){
    const cur2=compareClient.value;
    compareClient.innerHTML=compareOptions;
    compareClient.value=compareList.some(c=>c.name===cur2)?cur2:'';
  }
}
function crmRenderClientTrendChart(canvasId,titleId,clientName,selectedYears,allTime,metricChecks,instanceKey){
  const canvas=document.getElementById(canvasId);
  if(window[instanceKey])window[instanceKey].destroy();
  const titleEl=document.getElementById(titleId);
  if(titleEl)titleEl.textContent=clientName?`Динамика клиента — ${clientName}`:'Динамика клиента';
  if(!canvas||!clientName)return;
  const rows=crmGetPaidClientOrders(selectedYears,allTime).filter(o=>crmClientKey(o.clientName)===crmClientKey(clientName));
  const monthMap={};
  rows.forEach(o=>{
    const d=crmParseDateLocal(o.startDate);if(!d)return;
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if(!monthMap[key])monthMap[key]={turnover:0,revenue:0,orders:0,avg:0};
    const amount=Number(o.orderAmount||0);
    monthMap[key].orders+=1;
    monthMap[key].turnover+=amount;
    monthMap[key].revenue+=Math.max(0,amount-Number(o.deliveryCost||0)-Number(o.setupCost||0));
  });
  const labels=Object.keys(monthMap).sort();
  labels.forEach(k=>{const row=monthMap[k];row.avg=row.orders?Math.round(row.turnover/row.orders):0;});
  if(!labels.length)return;
  const labelFmt=labels.map(k=>{
    const parts=k.split('-');
    return new Intl.DateTimeFormat('ru-RU',{month:'short',year:'numeric'}).format(new Date(Number(parts[0]),Number(parts[1])-1,1));
  });
  const datasets=[];
  if(metricChecks.turnover)datasets.push({label:'Оборот',data:labels.map(k=>monthMap[k].turnover),borderColor:'#007aff',backgroundColor:'rgba(0,122,255,0.12)',tension:.28,pointRadius:3,fill:false});
  if(metricChecks.revenue)datasets.push({label:'Выручка',data:labels.map(k=>monthMap[k].revenue),borderColor:'#34c759',backgroundColor:'rgba(52,199,89,0.12)',tension:.28,pointRadius:3,fill:false});
  if(metricChecks.orders)datasets.push({label:'Заказы',data:labels.map(k=>monthMap[k].orders),borderColor:'#ff9500',backgroundColor:'rgba(255,149,0,0.12)',tension:.28,pointRadius:3,fill:false,yAxisID:'y1'});
  if(metricChecks.avg)datasets.push({label:'Средний чек',data:labels.map(k=>monthMap[k].avg),borderColor:'#af52de',backgroundColor:'rgba(175,82,222,0.12)',tension:.28,pointRadius:3,fill:false});
  if(!datasets.length)return;
  window[instanceKey]=new Chart(canvas,{
    type:'line',
    data:{labels:labelFmt,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,labels:{boxWidth:10,color:'#86868b'}},
        tooltip:{callbacks:{afterBody:(items)=>{
          const idx=items[0]?.dataIndex;
          if(idx==null)return '';
          const row=monthMap[labels[idx]];
          return [`Оборот: ${fN(Math.round(row.turnover))}₽`,`Выручка: ${fN(Math.round(row.revenue))}₽`,`Заказов: ${row.orders}`,`Средний чек: ${row.avg?fN(row.avg)+'₽':'—'}`];
        }}}
      },
      scales:{
        y:{ticks:{callback:v=>fN(v)+'₽'}},
        y1:{display:metricChecks.orders,position:'right',grid:{drawOnChartArea:false},ticks:{precision:0}}
      }
    }
  });
}
function crmToggleClientAnalytics(force){
  crmClientAnalyticsOpen=typeof force==='boolean'?force:!crmClientAnalyticsOpen;
  const panel=document.getElementById('crmClientAnalyticsPanel');
  const btn=document.getElementById('crmClientAnalyticsToggle');
  if(panel)panel.style.display=crmClientAnalyticsOpen?'block':'none';
  if(btn)btn.textContent=crmClientAnalyticsOpen?'Скрыть анализ клиентов':'Открыть анализ клиентов';
  if(crmClientAnalyticsOpen)crmRenderClientAnalytics();
}
function crmFillClientsYearOptions(){
  const sel=document.getElementById('crmClientsYear');if(!sel)return;
  const allEl=document.getElementById('crmClientsYearAll');
  const nowY=new Date().getFullYear();
  const years=[...new Set([nowY,...crmOrders.map(o=>crmParseDateLocal(o.startDate)?.getFullYear()).filter(Boolean)])].sort((a,b)=>b-a);
  crmClientsYears=(crmClientsYears||[]).map(Number).filter(y=>years.includes(y));
  if(!crmClientsYears.length&&!crmClientsAllYears)crmClientsYears=[years[0]||nowY];
  sel.innerHTML=years.map(y=>`<option value="${y}" ${crmClientsYears.includes(y)?'selected':''}>${y}</option>`).join('');
  sel.disabled=crmClientsAllYears;
  if(allEl)allEl.checked=crmClientsAllYears;
}
function crmFillClientSelect(selectedName=''){
  const input=document.getElementById('crmClient');if(!input)return;
  const list=document.getElementById('crmClientList');
  const sName=String(selectedName||'').trim();
  if(list){
    const opts=crmClients
      .slice()
      .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ru'))
      .map(c=>`<option value="${esc(c.name)}">${esc(c.name)}${c.company?` — ${esc(c.company)}`:''}</option>`).join('');
    list.innerHTML=opts;
  }
  input.value=sName;
  crmRenderClientDropdown(sName);
}
function crmClientApplyToOrder(name){
  const c=crmClients.find(x=>x.name===name);if(!c)return;
  const phone=document.getElementById('crmPhone');
  const company=document.getElementById('crmCompany');
  const discount=document.getElementById('crmDiscount');
  if(phone)phone.value=c.phone||'';
  if(company)company.value=c.company||'';
  if(discount)discount.value=Number(c.proDiscount||0);
  crmCalcTotal();
}
function crmRenderClients(){
  const t=document.getElementById('crmClientsTable');if(!t)return;
  crmClients=crmDedupClients(crmClients);
  crmFillClientDashboardControls();
  crmFillClientsYearOptions();
  crmFillClientSelect(document.getElementById('crmClient')?.value||'');
  const q=(document.getElementById('crmClientsSearch')?.value||'').toLowerCase().trim();
  const list=crmClients.filter(c=>!q||[c.name,c.company,c.phone].join(' ').toLowerCase().includes(q));
  crmRenderClientsDashboard();
  if(crmClientAnalyticsOpen)crmRenderClientAnalytics();
  if(!list.length){t.innerHTML='<tr><td colspan="11" style="text-align:center;color:var(--text3);padding:26px">Клиентов пока нет</td></tr>';return}
  t.innerHTML=list.map((c,idx)=>{
    const m=crmClientMetrics(c,crmClientsYears,crmClientsAllYears);
    const avgCheck=m.ordersCount?Math.round(m.turnover/m.ordersCount):0;
    const cityBadge=c.city==='Краснодар'?'badge-green':'badge-blue';
    return`<tr>
      <td class="mono">${idx+1}</td>
      <td class="crm-client-link" style="font-weight:600;cursor:pointer" onclick="crmOpenClientProfile('${esc(c.id)}')" title="${c.comment?esc(c.comment):'Открыть карточку клиента'}">${esc(c.name)}${c.comment?'<div style="font-size:11px;font-weight:400;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">'+esc(c.comment)+'</div>':''}</td>
      <td><span class="badge ${cityBadge}">${esc(c.city||'Ростов-на-Дону')}</span></td>
      <td>${esc(c.company||'—')}</td>
      <td>${esc(c.phone||'—')}</td>
      <td class="mono">${Number(c.proDiscount||0)}%</td>
      <td class="mono">${m.ordersCount}</td>
      <td class="mono">${fN(Math.round(m.turnover))}₽</td>
      <td class="mono">${fN(Math.round(m.revenueNoLog))}₽</td>
      <td class="mono">${avgCheck?fN(avgCheck)+'₽':'—'}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="crmOpenClientModal('${esc(c.id)}')" style="padding:4px 8px;font-size:11px">✎</button></td>
    </tr>`
  }).join('');
}
function crmRenderClientsDashboard(){
  const yearsEl=document.getElementById('crmClientsDashYears');
  const topEl=document.getElementById('crmClientsDashTopN');
  const allTimeEl=document.getElementById('crmClientsDashAllTime');
  const statsEl=document.getElementById('crmClientsDashStats');
  const tableEl=document.getElementById('crmClientsTopTable');
  const chartEl=document.getElementById('crmClientsTopChart');
  if(!yearsEl||!topEl||!tableEl||!statsEl||!chartEl)return;

  yearsEl.disabled=!!allTimeEl?.checked;
  const selectedYears=crmClientSelectedYears('crmClientsDashYears','crmClientsDashAllTime');
  const allTime=!!allTimeEl?.checked;
  const topN=Math.max(1,Number(topEl.value)||10);
  let metrics=crmClientSelectedSortMetrics();
  if(!metrics.length){
    const fallback=document.getElementById('crmClientsDashMetricTurnover');
    if(fallback)fallback.checked=true;
    metrics=['turnover'];
  }
  const allRows=crmAggregateClientsForPeriod(selectedYears,allTime);
  const metricLabel=metrics.length===1?crmClientMetricLabel(metrics[0]):'Комбинированный рейтинг';
  const rows=allRows.slice().sort((a,b)=>{
    const diff=crmClientCombinedScore(b,allRows,metrics)-crmClientCombinedScore(a,allRows,metrics);
    return diff||b.turnover-a.turnover||b.revenue-a.revenue||b.orders-a.orders;
  }).slice(0,topN);
  const ordersTotal=allRows.reduce((s,r)=>s+r.orders,0);
  const turnoverTotal=allRows.reduce((s,r)=>s+r.turnover,0);
  const revenueTotal=allRows.reduce((s,r)=>s+r.revenue,0);
  const avgTotal=ordersTotal?Math.round(turnoverTotal/ordersTotal):0;
  const leader=rows[0];
  statsEl.innerHTML=`<div class="stat-card"><div class="stat-label">Период</div><div class="stat-value dark" style="font-size:16px">${esc(crmFormatClientPeriod(selectedYears,allTime))}</div></div><div class="stat-card"><div class="stat-label">Сортировка</div><div class="stat-value dark" style="font-size:14px">${esc(metricLabel)}</div></div><div class="stat-card"><div class="stat-label">Клиентов</div><div class="stat-value dark">${allRows.length}</div></div><div class="stat-card"><div class="stat-label">Заказов</div><div class="stat-value blue">${fN(ordersTotal)}</div></div><div class="stat-card"><div class="stat-label">Оборот</div><div class="stat-value green">${fN(Math.round(turnoverTotal))}₽</div></div><div class="stat-card"><div class="stat-label">Выручка</div><div class="stat-value purple">${fN(Math.round(revenueTotal))}₽</div></div><div class="stat-card"><div class="stat-label">Средний чек</div><div class="stat-value amber">${avgTotal?fN(avgTotal)+'₽':'—'}</div></div><div class="stat-card"><div class="stat-label">Лидер</div><div class="stat-value dark" style="font-size:14px">${leader?esc(leader.name):'—'}</div></div>`;
  if(!rows.length){
    if(window.crmClientsTopChartInst)window.crmClientsTopChartInst.destroy();
    tableEl.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">Нет оплаченных заказов за выбранный период</td></tr>';
    return;
  }
  tableEl.innerHTML=rows.map((r,idx)=>`<tr><td class="mono">${idx+1}</td><td style="font-weight:600">${esc(r.name)}</td><td>${esc(r.company||'—')}</td><td class="mono">${r.orders}</td><td class="mono">${fN(Math.round(r.turnover))}₽</td><td class="mono">${fN(Math.round(r.revenue))}₽</td><td class="mono">${r.avg?fN(r.avg)+'₽':'—'}</td></tr>`).join('');
  if(window.crmClientsTopChartInst)window.crmClientsTopChartInst.destroy();
  const chartValues=rows.map(r=>metrics.length===1?crmClientMetricValue(r,metrics[0]):Math.round(crmClientCombinedScore(r,allRows,metrics)*100));
  window.crmClientsTopChartInst=new Chart(chartEl,{
    type:'bar',
    data:{labels:rows.map(r=>r.name),datasets:[{data:chartValues,backgroundColor:'rgba(0,122,255,0.45)',borderColor:'#007aff',borderWidth:1,borderRadius:6}]},
    options:{
      responsive:true,maintainAspectRatio:false,indexAxis:'y',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>{
        const r=rows[ctx.dataIndex];
        if(metrics.length===1){
          return `${crmClientMetricLabel(metrics[0])}: ${metrics[0]==='orders'?r.orders:fN(Math.round(crmClientMetricValue(r,metrics[0])))+(metrics[0]==='orders'?'':'₽')}`;
        }
        return `Комбинированный рейтинг: ${Math.round(crmClientCombinedScore(r,allRows,metrics)*100)} баллов`;
      },afterBody:(items)=>{
        const r=rows[items[0].dataIndex];
        return [`Оборот: ${fN(Math.round(r.turnover))}₽`,`Выручка: ${fN(Math.round(r.revenue))}₽`,`Заказов: ${r.orders}`,`Средний чек: ${r.avg?fN(r.avg)+'₽':'—'}`];
      }}}},
      scales:{x:{ticks:{callback:v=>metrics.length===1?(metrics[0]==='orders'?v:fN(v)+'₽'):`${v} б.`}},y:{grid:{display:false}}}
    }
  });
}
function crmRenderClientAnalytics(){
  const targetEl=document.getElementById('crmClientTrendTarget');
  const compareToggle=document.getElementById('crmClientTrendCompare');
  const compareTargetEl=document.getElementById('crmClientTrendCompareTarget');
  const compareCard=document.getElementById('crmClientTrendCompareCard');
  const compareWrap=document.getElementById('crmClientTrendCompareWrap');
  if(!targetEl||!compareToggle||!compareTargetEl||!compareCard||!compareWrap)return;
  const years=crmClientSelectedYears('crmClientTrendYears','crmClientTrendAllTime');
  const allTime=!!document.getElementById('crmClientTrendAllTime')?.checked;
  document.getElementById('crmClientTrendYears').disabled=allTime;
  compareWrap.style.display=compareToggle.checked?'flex':'none';
  compareCard.style.display=compareToggle.checked&&compareTargetEl.value?'block':'none';
  const metricChecks={
    turnover:!!document.getElementById('crmTrendMetricTurnover')?.checked,
    revenue:!!document.getElementById('crmTrendMetricRevenue')?.checked,
    orders:!!document.getElementById('crmTrendMetricOrders')?.checked,
    avg:!!document.getElementById('crmTrendMetricAvg')?.checked
  };
  if(!metricChecks.turnover&&!metricChecks.revenue&&!metricChecks.orders&&!metricChecks.avg){
    document.getElementById('crmTrendMetricTurnover').checked=true;
    metricChecks.turnover=true;
  }
  document.getElementById('crmClientTrendCompareTitle').textContent=compareTargetEl.value?`Сравнение клиента — ${compareTargetEl.value}`:'Сравнение клиента';
  crmRenderClientTrendChart('crmClientTrendChart','crmClientTrendTitle',targetEl.value,years,allTime,metricChecks,'crmClientTrendChartInst');
  if(compareToggle.checked&&compareTargetEl.value){
    crmRenderClientTrendChart('crmClientTrendCompareChart','crmClientTrendCompareTitle',compareTargetEl.value,years,allTime,metricChecks,'crmClientTrendCompareChartInst');
  }else if(window.crmClientTrendCompareChartInst){
    window.crmClientTrendCompareChartInst.destroy();
  }
}
function crmClientProfileYears(){
  return crmClientSelectedYears('crmClientProfileYears','crmClientProfileAllTime');
}
function crmGetClientProfileOrders(clientName,years,allTime){
  return crmGetPaidClientOrders(years,allTime).filter(o=>crmClientKey(o.clientName)===crmClientKey(clientName));
}
function crmToggleClientProfileCategory(encoded){
  const key=decodeURIComponent(encoded);
  crmClientProfileState.openCats[key]=!crmClientProfileState.openCats[key];
  if(crmClientProfileState.id)crmRenderClientProfile(crmClientProfileState.id);
}
function crmRenderClientProfile(id){
  const c=crmClients.find(x=>x.id===id);if(!c)return;
  crmClientProfileState.id=id;
  const currentYear=new Date().getFullYear();
  const allTime=!!document.getElementById('crmClientProfileAllTime')?.checked;
  const years=allTime?[]:(crmClientProfileYears().length?crmClientProfileYears():[currentYear]);
  const my=crmGetClientProfileOrders(c.name,years,allTime);
  const periodLabel=crmFormatClientPeriod(years,allTime);
  const totalPeriodOrders=crmGetPaidClientOrders(years,allTime);
  const totalPeriodRevenue=totalPeriodOrders.reduce((s,o)=>s+Math.max(0,Number(o.orderAmount||0)-Number(o.deliveryCost||0)-Number(o.setupCost||0)),0);
  const myTurnover=my.reduce((s,o)=>s+Number(o.orderAmount||0),0);
  const myRevenue=my.reduce((s,o)=>s+Math.max(0,Number(o.orderAmount||0)-Number(o.deliveryCost||0)-Number(o.setupCost||0)),0);
  const sharePct=totalPeriodRevenue?Math.round(myRevenue/totalPeriodRevenue*1000)/10:0;
  const avgCheck=my.length?Math.round(myTurnover/my.length):0;
  const catStats={};
  const itemStats={};
  my.forEach(o=>{
    (o.items||[]).forEach(i=>{
      const cat=String(i.category||'Без категории').trim()||'Без категории';
      const name=String(i.name||'').trim()||'Без названия';
      const qty=Math.max(0,Number(i.qty||0));
      const amount=Math.max(0,Number(i.price||0)*qty);
      if(!catStats[cat])catStats[cat]={qty:0,amount:0,items:{}};
      catStats[cat].qty+=qty;
      catStats[cat].amount+=amount;
      if(!catStats[cat].items[name])catStats[cat].items[name]={qty:0,amount:0};
      catStats[cat].items[name].qty+=qty;
      catStats[cat].items[name].amount+=amount;
      if(!itemStats[name])itemStats[name]={qty:0,amount:0,category:cat};
      itemStats[name].qty+=qty;
      itemStats[name].amount+=amount;
    });
  });
  const topItems=Object.entries(itemStats).sort((a,b)=>b[1].qty-a[1].qty||b[1].amount-a[1].amount).slice(0,3);
  const cats=Object.entries(catStats).sort((a,b)=>b[1].qty-a[1].qty||b[1].amount-a[1].amount);
  const yearsOptions=crmGetClientYears().map(y=>`<option value="${y}" ${years.includes(y)?'selected':''}>${y}</option>`).join('');
  document.getElementById('crmClientProfileTitle').textContent=`Карточка клиента — ${c.name}`;
  document.getElementById('crmClientProfileBody').innerHTML=`
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-start">
      <select id="crmClientProfileYears" multiple size="4" style="min-width:220px">${yearsOptions}</select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);padding:10px 12px;border:0.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2)">
        <input type="checkbox" id="crmClientProfileAllTime" style="width:14px;height:14px" ${allTime?'checked':''}>
        Все время
      </label>
      <div style="font-size:11px;color:var(--text3);align-self:center">Период: ${esc(periodLabel)}</div>
    </div>
    <div class="stats-grid" style="margin-bottom:12px">
      <div class="stat-card"><div class="stat-label">Оплаченных заказов</div><div class="stat-value dark">${my.length}</div></div>
      <div class="stat-card"><div class="stat-label">Оборот</div><div class="stat-value blue">${fN(Math.round(myTurnover))}₽</div></div>
      <div class="stat-card"><div class="stat-label">Выручка</div><div class="stat-value green">${fN(Math.round(myRevenue))}₽</div></div>
      <div class="stat-card"><div class="stat-label">Средний чек</div><div class="stat-value purple">${avgCheck?fN(avgCheck)+'₽':'—'}</div></div>
      <div class="stat-card"><div class="stat-label">Доля в выручке периода</div><div class="stat-value amber">${sharePct}%</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="table-wrap" style="padding:12px">
        <div style="font-size:10px;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px">Топ 3 изделия</div>
        ${topItems.length?topItems.map(([n,v],i)=>`<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border)"><span style="font-size:12px">${i+1}. ${esc(n)}</span><span class="mono">${v.qty} шт · ${fN(Math.round(v.amount))}₽</span></div>`).join(''):'<div style="color:var(--text2);font-size:12px">Нет данных</div>'}
      </div>
      <div class="chart-card">
        <div class="chart-title">Категории клиента</div>
        <div class="chart-container" style="height:240px"><canvas id="crmClientProfileCategoryChart"></canvas></div>
      </div>
    </div>
    <div class="table-wrap" style="padding:12px">
      <div style="font-size:10px;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;font-weight:700;margin-bottom:8px">Категории и изделия</div>
      ${cats.length?cats.map(([cat,val],idx)=>{
        const open=!!crmClientProfileState.openCats[cat];
        const itemsRows=Object.entries(val.items).sort((a,b)=>b[1].qty-a[1].qty||b[1].amount-a[1].amount);
        return `<div style="border-bottom:0.5px solid var(--border);padding:6px 0">
          <button onclick="crmToggleClientProfileCategory('${encodeURIComponent(cat)}')" style="width:100%;display:flex;justify-content:space-between;gap:8px;background:none;border:none;padding:0;cursor:pointer;text-align:left">
            <span style="font-size:12px;font-weight:600">${idx+1}. ${esc(cat)}</span>
            <span class="mono" style="font-size:11px">${val.qty} шт · ${fN(Math.round(val.amount))}₽ ${open?'↑':'↓'}</span>
          </button>
          ${open?`<div style="margin-top:8px;padding-left:10px">${itemsRows.map(([name,item])=>`<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;color:var(--text2)"><span style="font-size:12px">${esc(name)}</span><span class="mono" style="font-size:11px">${item.qty} шт · ${fN(Math.round(item.amount))}₽</span></div>`).join('')}</div>`:''}
        </div>`;
      }).join(''):'<div style="color:var(--text2);font-size:12px">Нет данных</div>'}
    </div>`;
  document.getElementById('crmClientProfileYears')?.addEventListener('change',()=>crmRenderClientProfile(id));
  document.getElementById('crmClientProfileAllTime')?.addEventListener('change',()=>crmRenderClientProfile(id));
  if(document.getElementById('crmClientProfileYears'))document.getElementById('crmClientProfileYears').disabled=allTime;
  const chartCanvas=document.getElementById('crmClientProfileCategoryChart');
  if(window.crmClientProfileCategoryChartInst)window.crmClientProfileCategoryChartInst.destroy();
  if(chartCanvas&&cats.length){
    const palette=['#007aff','#34c759','#ff9500','#af52de','#ff3b30','#5ac8fa','#ff9f40','#7f8c8d'];
    window.crmClientProfileCategoryChartInst=new Chart(chartCanvas,{
      type:'doughnut',
      data:{labels:cats.map(([cat])=>cat),datasets:[{data:cats.map(([,v])=>v.qty),backgroundColor:cats.map((_,i)=>palette[i%palette.length]),borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,color:'#86868b'}},tooltip:{callbacks:{label:(ctx)=>`${ctx.label}: ${ctx.raw} шт`}}}}
    });
  }
}
function crmOpenClientProfile(id){
  crmClientProfileState.id=id;
  crmClientProfileState.openCats={};
  crmRenderClientProfile(id);
  openModal('crmClientProfileModal');
}
function crmOpenClientModal(id=''){
  const c=id?crmClients.find(x=>x.id===id):null;
  const modal=document.getElementById('crmClientModal');
  const discountInput=document.getElementById('crmClientDiscountInput');
  document.getElementById('crmClientModalTitle').textContent=c?'Редактировать клиента':'Новый клиент';
  document.getElementById('crmClientId').value=c?.id||'';
  document.getElementById('crmClientNameInput').value=c?.name||'';
  document.getElementById('crmClientCompanyInput').value=c?.company||'';
  document.getElementById('crmClientPhoneInput').value=c?.phone||'';
  const cityInput=document.getElementById('crmClientCityInput');
  if(cityInput)cityInput.value=c?.city||'Ростов-на-Дону';
  const commentInput=document.getElementById('crmClientCommentInput');
  if(commentInput)commentInput.value=c?.comment||'';
  if(discountInput){
    discountInput.value=c?.proDiscount||0;
    if(!discountInput.dataset.clientZeroBound){
      discountInput.dataset.clientZeroBound='1';
      discountInput.addEventListener('focus',()=>{
        if(discountInput.value==='0'){
          discountInput.value='';
          requestAnimationFrame(()=>{try{discountInput.select();}catch{}});
        }
      });
      discountInput.addEventListener('click',()=>{
        if(discountInput.value==='0'){
          discountInput.value='';
          requestAnimationFrame(()=>{try{discountInput.select();}catch{}});
        }
      });
      discountInput.addEventListener('input',()=>{
        discountInput.value=discountInput.value.replace(/[^\d]/g,'');
        if(/^0\d+$/.test(discountInput.value))discountInput.value=String(Number(discountInput.value));
      });
    }
  }
  document.getElementById('crmClientDeleteBtn').style.display=c?'inline-block':'none';
  if(modal)crmApplyZeroClearBehavior(modal);
  openModal('crmClientModal');
}
var _crmSavingClient=false;
async function crmSaveClient(){
  if(_crmSavingClient)return;
  const saveBtn=document.querySelector('#crmClientModal .modal-actions .btn:not(.btn-secondary)');
  const id=document.getElementById('crmClientId').value;
  const client=crmNormalizeClient({
    id,
    name:document.getElementById('crmClientNameInput').value,
    company:document.getElementById('crmClientCompanyInput').value,
    phone:document.getElementById('crmClientPhoneInput').value,
    proDiscount:document.getElementById('crmClientDiscountInput').value,
    city:document.getElementById('crmClientCityInput')?.value||'Ростов-на-Дону',
    comment:document.getElementById('crmClientCommentInput')?.value||''
  });
  if(!client.name){showToast('Укажите имя клиента','error');return}
  _crmSavingClient=true;
  if(saveBtn){saveBtn.disabled=true;saveBtn._origText=saveBtn.textContent;saveBtn.textContent='⏳ Сохранение...';}
  try{
    let r={success:false};
    if(id)r=await api('updateClient',{client});
    else r=await api('addClient',{client});
    if(r.success){
      if(!id)client.id=r.id||('C_'+Date.now());
      if(id){const i=crmClients.findIndex(x=>x.id===id);if(i>=0)crmClients[i]=client;}
      else crmClients.push(client);
      crmClients.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
      sbBackup('upsertClient',client);
      closeModal('crmClientModal');
      crmRenderClients();
      showToast('Сохранено','success');
    }else{
      showToast('Не удалось сохранить (проверьте лист Clients в Apps Script)','error');
    }
  }catch(e){showToast('Ошибка сохранения','error')}
  finally{_crmSavingClient=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn._origText||'Сохранить';}}
}
async function crmDeleteClient(){
  const id=document.getElementById('crmClientId').value;
  if(!id||!confirm('Удалить клиента?'))return;
  const r=await api('deleteClient',{id});
  if(r.success){
    crmClients=crmClients.filter(c=>c.id!==id);
    sbBackup('deleteClient',{id});
    closeModal('crmClientModal');
    crmRenderClients();
    showToast('Удалено','success');
  }else showToast('Не удалось удалить','error');
}
async function crmSyncPresetClients(){
  const preset=crmPresetClients();
  const currentByName=new Set(crmClients.map(c=>String(c.name||'').trim().toLowerCase()));
  const missing=preset.filter(c=>!currentByName.has(c.name.toLowerCase()));
  if(!missing.length){showToast('Список уже загружен','success');return}
  let ok=0,fail=0;
  for(const c of missing){
    try{
      const r=await api('addClient',{client:c});
      if(r?.success){
        c.id=r.id||c.id;ok++;crmClients.push(c);sbBackup('upsertClient',c);
      }else fail++;
    }catch{fail++}
  }
  crmClients=crmMergeClients(crmClients,[]);
  crmRenderClients();
  showToast(`Загружено клиентов: ${ok}${fail?`, ошибок: ${fail}`:''}`, fail?'error':'success');
}
async function crmSyncClientsToSupabase(){
  try{ await api('recalcClientsStats'); }catch{}
  try{
    const r=await api('getClients');
    if(r?.success&&Array.isArray(r.clients)){
      crmClients=crmDedupClients(r.clients);
      for(const c of crmClients)sbBackup('upsertClient',c);
    }
  }catch{}
}
function crmSetQuickFilter(f){crmQuickFilter=crmQuickFilter===f?'all':f;crmRenderOrders();crmSyncQuickFilterUI()}
function crmGetMultiValues(id){
  const el=document.getElementById(id);
  if(!el)return[];
  return Array.from(el.selectedOptions).map(o=>String(o.value));
}
function crmSetMultiOptions(id,options,selectedValues,defaultValue){
  const el=document.getElementById(id);
  if(!el)return;
  const selected=new Set((selectedValues||[]).map(String));
  el.innerHTML=options.map(o=>`<option value="${esc(o.value)}" ${selected.has(String(o.value))?'selected':''}>${esc(o.label)}</option>`).join('');
  if(defaultValue!==undefined&&defaultValue!==null&&!el.selectedOptions.length&&el.options.length){
    const val=defaultValue!=null?String(defaultValue):String(el.options[0].value);
    const target=Array.from(el.options).find(o=>String(o.value)===val)||el.options[0];
    if(target)target.selected=true;
  }
}
function crmGetStockYears(){
  const curYear=new Date().getFullYear();
  return [...new Set([curYear,...crmOrders.filter(o=>crmPaidStatuses.has(o.paymentStatus)).map(o=>crmParseDateLocal(o.startDate)?.getFullYear()).filter(Boolean)])].sort((a,b)=>b-a);
}
function crmGetStockFactRows(){
  const rows=[];
  crmOrders.forEach((o,ix)=>{
    if(!crmPaidStatuses.has(o.paymentStatus))return;
    const d=crmParseDateLocal(o.startDate);
    if(!d)return;
    const orderId=o.id||`ROW_${ix}`;
    const year=d.getFullYear();
    const month=d.getMonth();
    const monthKey=`${year}-${String(month+1).padStart(2,'0')}`;
    const monthLabel=new Intl.DateTimeFormat('ru-RU',{month:'short',year:'numeric'}).format(new Date(year,month,1));
    (Array.isArray(o.items)?o.items:[]).forEach(it=>{
      if(!it||typeof it!=='object')return;
      const category=String(it.category||'').trim()||'Без категории';
      const name=String(it.name||'').trim();
      const qty=Math.max(0,Number(it.qty||0));
      const amount=Math.max(0,Number(it.price||0))*qty;
      if(!qty||(!name&&category==='Без категории'))return;
      rows.push({orderId,year,month,monthKey,monthLabel,category,name,qty,amount});
    });
  });
  return rows;
}
function crmGetSelectedYearsState(selectId,allTimeId){
  const allTime=!!document.getElementById(allTimeId)?.checked;
  const years=crmGetMultiValues(selectId).map(Number).filter(Boolean);
  const fallbackYear=new Date().getFullYear();
  return {allTime,years:allTime?[]:(years.length?years:[fallbackYear])};
}
function crmFillStockDashboardControls(){
  const years=crmGetStockYears();
  crmSetMultiOptions('crmStockTopYears',years.map(y=>({value:y,label:y})),crmGetMultiValues('crmStockTopYears'),new Date().getFullYear());
  crmSetMultiOptions('crmStockAnalysisYears',years.map(y=>({value:y,label:y})),crmGetMultiValues('crmStockAnalysisYears'),new Date().getFullYear());

  const factRows=crmGetStockFactRows();
  const categories=[...new Set(factRows.map(r=>r.category).filter(Boolean))].sort();
  const selectedCategory=document.getElementById('crmStockAnalysisCategory')?.value||'';
  const categoryEl=document.getElementById('crmStockAnalysisCategory');
  if(categoryEl){
    categoryEl.innerHTML=`<option value="">Выберите категорию</option>${categories.map(c=>`<option value="${esc(c)}" ${selectedCategory===c?'selected':''}>${esc(c)}</option>`).join('')}`;
  }
  const itemRows=selectedCategory?factRows.filter(r=>r.category===selectedCategory):factRows;
  const items=[...new Set(itemRows.map(r=>r.name).filter(Boolean))].sort();
  const selectedItem=document.getElementById('crmStockAnalysisItem')?.value||'';
  const itemEl=document.getElementById('crmStockAnalysisItem');
  if(itemEl){
    itemEl.innerHTML=`<option value="">Выберите изделие</option>${items.map(i=>`<option value="${esc(i)}" ${selectedItem===i?'selected':''}>${esc(i)}</option>`).join('')}`;
    if(selectedItem && !items.includes(selectedItem))itemEl.value='';
  }
}
function crmAggregateStockForPeriod(mode,years,allTime){
  const rows=crmGetStockFactRows().filter(r=>allTime||!years.length||years.includes(r.year));
  const grouped={};
  rows.forEach(r=>{
    const key=mode==='category'?r.category:r.name;
    if(!key)return;
    if(!grouped[key])grouped[key]={name:key,category:mode==='item'?r.category:'',qty:0,amount:0,orders:new Set()};
    grouped[key].qty+=r.qty;
    grouped[key].amount+=r.amount;
    grouped[key].orders.add(r.orderId);
  });
  return Object.values(grouped).map(r=>({...r,ordersCount:r.orders.size})).sort((a,b)=>b.qty-a.qty||b.amount-a.amount||b.ordersCount-a.ordersCount);
}
function crmToggleStockAnalytics(force){
  crmStockAnalyticsOpen=typeof force==='boolean'?force:!crmStockAnalyticsOpen;
  const panel=document.getElementById('crmStockAnalyticsPanel');
  const btn=document.getElementById('crmStockAnalyticsToggle');
  if(panel)panel.style.display=crmStockAnalyticsOpen?'block':'none';
  if(btn)btn.textContent=crmStockAnalyticsOpen?'Скрыть анализ склада':'Открыть анализ склада';
  if(crmStockAnalyticsOpen)crmRenderStockAnalysis();
}
function crmRenderStockTopDashboard(){
  const tableBody=document.getElementById('crmStockTopTable');
  if(!tableBody)return;
  try{
    crmFillStockDashboardControls();
    const mode=document.getElementById('crmStockTopMode')?.value||'item';
    const metric=document.getElementById('crmStockTopMetric')?.value||'qty';
    const limitVal=document.getElementById('crmStockTopN')?.value||'5';
    const {years,allTime}=crmGetSelectedYearsState('crmStockTopYears','crmStockTopAllTime');
    const rows=crmAggregateStockForPeriod(mode,years,allTime).sort((a,b)=>(metric==='amount'?b.amount-a.amount:b.qty-a.qty)||b.amount-a.amount||b.ordersCount-a.ordersCount);
    const topRows=limitVal==='all'?rows:rows.slice(0,Number(limitVal)||5);
    const periodLabel=allTime?'Все время':years.join(', ');
    const statsEl=document.getElementById('crmStockTopStats');
    if(statsEl){
      const totalQty=rows.reduce((s,r)=>s+r.qty,0);
      const totalAmount=rows.reduce((s,r)=>s+r.amount,0);
      const leader=topRows[0];
      statsEl.innerHTML=`<div class="stat-card"><div class="stat-label">Период</div><div class="stat-value dark" style="font-size:16px">${esc(periodLabel)}</div></div><div class="stat-card"><div class="stat-label">Режим</div><div class="stat-value dark" style="font-size:16px">${mode==='category'?'Категории':'Изделия'}</div></div><div class="stat-card"><div class="stat-label">Единиц</div><div class="stat-value blue">${fN(totalQty)}</div></div><div class="stat-card"><div class="stat-label">Сумма аренды</div><div class="stat-value green">${fN(totalAmount)}₽</div></div><div class="stat-card"><div class="stat-label">Позиции в рейтинге</div><div class="stat-value purple">${fN(topRows.length)}</div></div><div class="stat-card"><div class="stat-label">Лидер</div><div class="stat-value dark" style="font-size:14px">${leader?esc(leader.name):'—'}</div></div>`;
    }
    if(!topRows.length){
      if(window.crmStockTopChartInst)window.crmStockTopChartInst.destroy();
      tableBody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:18px">Нет данных по оплаченных заказам</td></tr>';
      return;
    }
    tableBody.innerHTML=topRows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.name)}</strong>${mode==='item'&&r.category?`<div style="font-size:11px;color:var(--text3)">${esc(r.category)}</div>`:''}</td><td class="mono">${fN(r.qty)}</td><td class="mono">${fN(r.amount)}₽</td></tr>`).join('');

    if(window.crmStockTopChartInst)window.crmStockTopChartInst.destroy();
    const topCanvas=document.getElementById('crmStockTopChart');
    if(topCanvas){
      window.crmStockTopChartInst=new Chart(topCanvas,{
        type:'bar',
        data:{
          labels:topRows.map(r=>r.name),
          datasets:[{
            label:metric==='amount'?'Сумма аренды':'Количество единиц',
            data:topRows.map(r=>metric==='amount'?r.amount:r.qty),
            backgroundColor:topRows.map((_,i)=>`hsla(${(i*31)%360},70%,58%,0.72)`),
            borderColor:topRows.map((_,i)=>`hsl(${(i*31)%360},70%,46%)`),
            borderWidth:1,
            borderRadius:6
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          indexAxis:'y',
          plugins:{
            legend:{display:false},
            tooltip:{callbacks:{label:(ctx)=>metric==='amount'?`${fN(ctx.parsed.x)}₽`:`${fN(ctx.parsed.x)} шт.`}}
          },
          scales:{x:{ticks:{callback:v=>metric==='amount'?`${fN(v)}₽`:fN(v)}}}
        }
      });
    }
  }catch(err){
    console.error('crmRenderStockTopDashboard failed',err);
    tableBody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--red);padding:18px">Не удалось построить дашборд склада</td></tr>';
  }
}
function crmRenderStockAnalysis(){
  const panel=document.getElementById('crmStockAnalyticsPanel');
  if(!panel||!crmStockAnalyticsOpen)return;
  try{
    crmFillStockDashboardControls();
    const category=document.getElementById('crmStockAnalysisCategory')?.value||'';
    const item=document.getElementById('crmStockAnalysisItem')?.value||'';
    const {years,allTime}=crmGetSelectedYearsState('crmStockAnalysisYears','crmStockAnalysisAllTime');
    const showQty=!!document.getElementById('crmStockMetricQty')?.checked;
    const showAmount=!!document.getElementById('crmStockMetricAmount')?.checked;
    const showOrders=!!document.getElementById('crmStockMetricOrders')?.checked;
    const title=document.getElementById('crmStockAnalysisTitle');
    const canvas=document.getElementById('crmStockAnalysisChart');
    if(window.crmStockAnalysisChartInst)window.crmStockAnalysisChartInst.destroy();
    if(!canvas)return;

    if(title){
      const scope=item?item:(category?category:'Выберите категорию или изделие');
      title.textContent=`Анализ склада: ${scope}`;
    }
    if(!category&&!item){
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      return;
    }

    const baseRows=crmGetStockFactRows().filter(r=>(allTime||!years.length||years.includes(r.year))&&(!category||r.category===category)&&(!item||r.name===item));
    const monthly={};
    baseRows.forEach(r=>{
      if(!monthly[r.monthKey])monthly[r.monthKey]={label:r.monthLabel,qty:0,amount:0,orders:new Set()};
      monthly[r.monthKey].qty+=r.qty;
      monthly[r.monthKey].amount+=r.amount;
      monthly[r.monthKey].orders.add(r.orderId);
    });
    const labels=Object.keys(monthly).sort();
    const datasets=[];
    if(showQty)datasets.push({label:'Количество единиц',data:labels.map(k=>monthly[k].qty),borderColor:'#007aff',backgroundColor:'rgba(0,122,255,0.12)',tension:.28,pointRadius:3,fill:false,yAxisID:'y'});
    if(showAmount)datasets.push({label:'Сумма аренды',data:labels.map(k=>monthly[k].amount),borderColor:'#34c759',backgroundColor:'rgba(52,199,89,0.12)',tension:.28,pointRadius:3,fill:false,yAxisID:'y1'});
    if(showOrders)datasets.push({label:'Количество заказов',data:labels.map(k=>monthly[k].orders.size),borderColor:'#af52de',backgroundColor:'rgba(175,82,222,0.12)',tension:.28,pointRadius:3,fill:false,yAxisID:'y'});

    if(!datasets.length||!labels.length){
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,canvas.width,canvas.height);
      return;
    }

    window.crmStockAnalysisChartInst=new Chart(canvas,{
      type:'line',
      data:{labels:labels.map(k=>monthly[k].label),datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:true},
          tooltip:{
            callbacks:{
              afterBody:(items)=>{
                const idx=items[0]?.dataIndex??0;
                const bucket=monthly[labels[idx]];
                if(!bucket)return '';
                return [`Единиц: ${fN(bucket.qty)}`,`Сумма аренды: ${fN(bucket.amount)}₽`,`Заказов: ${fN(bucket.orders.size)}`];
              },
              label:(ctx)=>{
                if(ctx.dataset.label==='Сумма аренды')return `${ctx.dataset.label}: ${fN(ctx.parsed.y)}₽`;
                return `${ctx.dataset.label}: ${fN(ctx.parsed.y)}`;
              }
            }
          }
        },
        scales:{
          y:{beginAtZero:true,ticks:{callback:v=>fN(v)}},
          y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>`${fN(v)}₽`}}
        }
      }
    });
  }catch(err){
    console.error('crmRenderStockAnalysis failed',err);
  }
}
function crmSetStockCat(cat){crmActiveStockCategory=cat;crmRenderStock()}
function crmRenderStock(){
  crmRenderStockTopDashboard();
  crmToggleStockAnalytics(crmStockAnalyticsOpen);
  // Category tabs
  const tabs=document.getElementById('crmStockCatTabs');
  const isMobile=window.innerWidth<=768;
  if(tabs){
    const allCats=[...new Set(crmStock.map(s=>s.category).filter(Boolean))].sort();
    if(isMobile){
      const current=crmActiveStockCategory||'Все категории';
      tabs.innerHTML=`<details class="stock-cat-mobile-dd"><summary>${esc(current)}</summary><div class="stock-cat-mobile-list"><button type="button" class="filter-btn${crmActiveStockCategory===''?' active':''}" data-stock-cat="">Все</button>${allCats.map(c=>`<button type="button" class="filter-btn${crmActiveStockCategory===c?' active':''}" data-stock-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div></details>`;
      tabs.querySelectorAll('[data-stock-cat]').forEach(btn=>btn.addEventListener('click',e=>{
        e.preventDefault();
        const cat=e.currentTarget.getAttribute('data-stock-cat')||'';
        const details=tabs.querySelector('.stock-cat-mobile-dd');
        if(details)details.open=false;
        crmSetStockCat(cat);
      }));
    }else{
      tabs.innerHTML='<button class="filter-btn'+(crmActiveStockCategory===''?' active':'')+'" onclick="crmSetStockCat(\'\')">Все</button>'+
        allCats.map(c=>`<button class="filter-btn${crmActiveStockCategory===c?' active':''}" onclick="crmSetStockCat('${esc(c)}')">${esc(c)}</button>`).join('');
    }
  }
  const grpEl=document.getElementById('crmStockGroups');if(!grpEl)return;
  const statsEl=document.getElementById('crmStockStats');
  const q=(document.getElementById('crmStockSearch')?.value||'').toLowerCase();
  let items=crmStock.filter(s=>!q||[s.name,s.category].join(' ').toLowerCase().includes(q));
  if(crmActiveStockCategory)items=items.filter(s=>s.category===crmActiveStockCategory);
  if(statsEl){
    const cats=[...new Set(crmStock.map(s=>s.category).filter(Boolean))];
    statsEl.innerHTML=`<div class="stat-card"><div class="stat-label">Позиций</div><div class="stat-value dark">${crmStock.length}</div></div><div class="stat-card"><div class="stat-label">Категорий</div><div class="stat-value blue">${cats.length}</div></div>`;
  }
  if(!items.length){grpEl.innerHTML='<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-text">Ничего не найдено</div></div>';crmRenderPricingSection();return}
  const grouped={};
  items.forEach(s=>{const c=s.category||'Без категории';if(!grouped[c])grouped[c]=[];grouped[c].push(s)});
  if(isMobile){
    grpEl.innerHTML=Object.entries(grouped).map(([cat,its],idx)=>{
      const isOpen=crmStockOpenGroups[cat]!==undefined?crmStockOpenGroups[cat]:idx===0;
      const rows=its.map(s=>`<tr>
        <td style="font-weight:500">${esc(s.name)}</td>
        <td class="mono">${fN(s.price)}₽</td>
        <td class="mono">${Number(s.setupRate)>0?fN(s.setupRate)+'₽':'—'}</td>
        <td><span class="badge ${Number(s.qty)>20?'badge-green':Number(s.qty)>5?'badge-amber':'badge-red'}">${s.qty} ${esc(s.unit||'шт')}</span></td>
        <td style="width:32px"><button class="btn-icon" onclick="crmOpenStockModal('${esc(s.id)}')">✎</button></td>
      </tr>`).join('');
      return `<details class="stock-mobile-group" data-stock-group="${esc(cat)}" ${isOpen?'open':''}><summary><span>${esc(cat)}</span><span>${its.length} поз.</span></summary><div class="table-wrap"><table><thead><tr><th>Название</th><th>Цена</th><th>Сетап</th><th>Кол-во</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }).join('');
    grpEl.querySelectorAll('.stock-mobile-group').forEach(el=>el.addEventListener('toggle',()=>{crmStockOpenGroups[el.getAttribute('data-stock-group')||'']=el.open}));
  }else{
    let rows='';
    Object.entries(grouped).forEach(([cat,its])=>{
      rows+=`<tr class="crm-month-sep"><td colspan="5"><span>${esc(cat)} · ${its.length} поз.</span></td></tr>`;
      rows+=its.map(s=>`<tr>
        <td style="font-weight:500">${esc(s.name)}</td>
        <td class="mono">${fN(s.price)}₽</td>
        <td class="mono">${Number(s.setupRate)>0?fN(s.setupRate)+'₽':'—'}</td>
        <td><span class="badge ${Number(s.qty)>20?'badge-green':Number(s.qty)>5?'badge-amber':'badge-red'}">${s.qty} ${esc(s.unit||'шт')}</span></td>
        <td style="width:32px"><button class="btn-icon" onclick="crmOpenStockModal('${esc(s.id)}')">✎</button></td>
      </tr>`).join('');
    });
    grpEl.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Название</th><th>Цена аренды</th><th>Сетап за ед.</th><th>Кол-во</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  crmRenderPricingSection();
}
function crmRenderPricingSection(){
  const el=document.getElementById('crmPricingSection');if(!el)return;
  const catRows=crmCategoriesData.map(c=>`<tr>
    <td style="font-weight:500">${esc(c.name)}</td>
    <td class="mono">${c.setupRate>0?fN(c.setupRate)+' ₽/ед.':'—'}</td>
    <td style="width:32px"><button class="btn-icon" onclick="crmOpenCatRateModal('${esc(c.id)}')">✎</button></td>
  </tr>`).join('');
  const minSetup=crmPricing.setupMin||2500;
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px">
    <div class="form-card">
      <div class="modal-section" style="margin-bottom:12px">Сетап по категориям</div>
      ${catRows?`<div class="table-wrap"><table style="width:100%"><thead><tr><th>Категория</th><th>Ставка за ед.</th><th></th></tr></thead><tbody>${catRows}</tbody></table></div>`:'<div style="color:var(--text2);font-size:13px">Нет данных — запустите createCategoriesSheet в Apps Script</div>'}
    </div>
    <div class="form-card">
      <div class="modal-section" style="margin-bottom:12px">Доставка и минимум</div>
      <div style="display:grid;gap:0">
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:0.5px solid var(--border)"><span style="color:var(--text2);font-size:13px">В пределах города</span><span class="mono" style="font-weight:600">${fN(crmPricing.deliveryBaseCity)} ₽</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:0.5px solid var(--border)"><span style="color:var(--text2);font-size:13px">За каждый км (за городом)</span><span class="mono" style="font-weight:600">${fN(crmPricing.deliveryPerKm)} ₽/км</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0"><span style="color:var(--text2);font-size:13px">Минимум сетапа</span><span class="mono" style="font-weight:600">${fN(minSetup)} ₽</span></div>
      </div>
    </div>
  </div>`;
}
function crmOpenCatRateModal(id){
  const cat=crmCategoriesData.find(c=>c.id===id);if(!cat)return;
  document.getElementById('crmCatRateId').value=cat.id;
  document.getElementById('crmCatRateName').textContent=cat.name;
  document.getElementById('crmCatRateVal').value=cat.setupRate||0;
  openModal('crmCatRateModal');
  crmApplyZeroClearBehavior(document.getElementById('crmCatRateModal'));
}
var _crmSavingCatRate=false;
async function crmSaveCatRate(){
  if(_crmSavingCatRate)return;
  const saveBtn=document.querySelector('#crmCatRateModal .modal-actions .btn:not(.btn-secondary)');
  const id=document.getElementById('crmCatRateId').value;
  const rate=Number(document.getElementById('crmCatRateVal').value)||0;
  const cat=crmCategoriesData.find(c=>c.id===id);if(!cat)return;
  _crmSavingCatRate=true;
  if(saveBtn){saveBtn.disabled=true;saveBtn._origText=saveBtn.textContent;saveBtn.textContent='⏳ Сохранение...';}
  try{
    const r=await api('updateCategory',{category:{id,name:cat.name,setupRate:rate}});
    if(r.success){
      cat.setupRate=rate;
      sbBackup('upsertCategory',cat);
      showToast('Сохранено','success');
      closeModal('crmCatRateModal');
      crmRenderPricingSection();
    }else{showToast('Ошибка сохранения','error')}
  }catch(e){showToast('Ошибка сохранения','error')}
  finally{_crmSavingCatRate=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn._origText||'Сохранить';}}
}

function crmOpenStockModal(id){
  const m=document.getElementById('crmStockModal');if(!m)return;
  const s=id?crmStock.find(x=>x.id===id):null;
  document.getElementById('crmStockModalTitle').textContent=s?'Редактировать позицию':'Добавить позицию';
  document.getElementById('crmStockId').value=s?.id||'';
  // Populate category select
  const catSel=document.getElementById('crmStockCat');
  if(catSel){
    const catList=crmCategoriesData.length?crmCategoriesData:crmCategories.map(n=>({id:n,name:n,setupRate:0}));
    catSel.innerHTML='<option value="">Выберите категорию</option>'+
      catList.map(c=>`<option value="${esc(c.name)}" data-rate="${c.setupRate||0}" ${s?.category===c.name?'selected':''}>${esc(c.name)}</option>`).join('');
    if(!catSel.dataset.bound){
      catSel.dataset.bound='1';
      catSel.addEventListener('change',()=>{
        const opt=catSel.selectedOptions[0];
        const rate=Number(opt?.dataset.rate||0);
        const rateEl=document.getElementById('crmStockSetupRate');
        if(rateEl&&!document.getElementById('crmStockId').value)rateEl.value=rate;
      });
    }
  }
  document.getElementById('crmStockName').value=s?.name||'';
  document.getElementById('crmStockPrice').value=s?.price||0;
  document.getElementById('crmStockSetupRate').value=s?.setupRate||0;
  document.getElementById('crmStockQty').value=s?.qty||0;
  document.getElementById('crmStockUnit').value=s?.unit||'шт';
  document.getElementById('crmStockDeleteBtn').style.display=s?'inline-block':'none';
  openModal('crmStockModal');
  crmApplyZeroClearBehavior(m);
}
var _crmSavingStock=false;
async function crmSaveStockItem(){
  if(_crmSavingStock)return;
  const saveBtn=document.querySelector('#crmStockModal .btn-primary');
  const id=document.getElementById('crmStockId').value;
  const item={
    id,
    category:document.getElementById('crmStockCat').value.trim(),
    name:document.getElementById('crmStockName').value.trim(),
    price:Number(document.getElementById('crmStockPrice').value)||0,
    setupRate:Number(document.getElementById('crmStockSetupRate').value)||0,
    qty:Number(document.getElementById('crmStockQty').value)||0,
    unit:document.getElementById('crmStockUnit').value.trim()||'шт'
  };
  if(!item.category||!item.name){showToast('Заполните категорию и название','error');return}
  _crmSavingStock=true;
  if(saveBtn){saveBtn.disabled=true;saveBtn._origText=saveBtn.textContent;saveBtn.textContent='⏳ Сохранение...';}
  try{
    let r;
    if(id){item.id=id;r=await api('updateStockItem',{item})}
    else{r=await api('addStockItem',{item})}
    if(r.success){
      if(!id&&r.id)item.id=r.id;
      sbBackup('upsertStockItem',item);
      showToast(id?'Обновлено':'Добавлено','success');
      closeModal('crmStockModal');
      const r2=await api('getStock');
      if(r2.success)crmStock=r2.stock||[];
      crmRenderStock();
    }else{showToast('Ошибка сохранения','error')}
  }catch(e){showToast('Ошибка сохранения','error')}
  finally{_crmSavingStock=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn._origText||'Сохранить';}}
}
async function crmDeleteStockItem(){
  const id=document.getElementById('crmStockId').value;
  const item=crmStock.find(s=>s.id===id);
  if(!id||!confirm('Удалить позицию?'))return;
  const r=await api('deleteStockItem',{id});
  if(r.success){
    if(item)sbBackup('deleteStockItem',{id,name:item.name,category:item.category});
    showToast('Удалено','success');
    closeModal('crmStockModal');
    crmStock=crmStock.filter(s=>s.id!==id);
    crmRenderStock();
  }else{showToast('Ошибка удаления','error')}
}
// CRM Dialog
function crmOpenDialog(id){
  const m=document.getElementById('crmOrderModal');
  crmBindDialogInputs();
  crmOrderDialogInit=true;
  crmOrderDialogDirty=false;
  document.getElementById('crmDialogTitle').textContent=id?'Редактировать заказ':'Новый заказ';
  document.getElementById('crmDeleteBtn').style.display=id?'inline-block':'none';
  document.getElementById('crmEstimateProBtn').style.display=id?'inline-block':'none';
  document.getElementById('crmEstimateBtn').style.display=id?'inline-block':'none';
  document.getElementById('crmActBtn').style.display=id?'inline-block':'none';
  const canShare=id&&navigator.share;
  ['crmShareProBtn','crmShareEstBtn','crmShareActBtn'].forEach(sid=>{const b=document.getElementById(sid);if(b)b.style.display=canShare?'inline-block':'none'});
  document.getElementById('crmItemsList').innerHTML='';
  if(id){
    const o=crmOrders.find(x=>x.id===id);if(!o)return;
    document.getElementById('crmOrderId').value=o.id;
    crmFillClientSelect(o.clientName||'');
    document.getElementById('crmClient').value=o.clientName||'';
    document.getElementById('crmPhone').value=o.clientPhone;
    document.getElementById('crmCompany').value=o.companyName||'';
    document.getElementById('crmStartDate').value=o.startDate;
    document.getElementById('crmEndDate').value=o.endDate;
    document.getElementById('crmAmount').value=o.orderAmount;
    document.getElementById('crmBudget').value=o.budgetAmount;
    document.getElementById('crmDeposit').value=o.depositAmount;
    document.getElementById('crmStatus').value=o.status;
    document.getElementById('crmPayment').value=o.paymentStatus;
    document.getElementById('crmDeliveryType').value=o.deliveryType;
    const isOutside=(o.deliveryType==='delivery')&&Number(o.deliveryCost||0)>crmPricing.deliveryBaseCity;
    document.getElementById('crmDeliveryZone').value=isOutside?'outside':'city';
    document.getElementById('crmDeliveryKm').value=isOutside?Math.max(0,Math.round((Number(o.deliveryCost||0)-crmPricing.deliveryBaseCity)/crmPricing.deliveryPerKm)):0;
    document.getElementById('crmAddress').value=o.deliveryAddress;
    document.getElementById('crmDeliveryCost').value=o.deliveryCost||0;
    document.getElementById('crmSetupCost').value=o.setupCost||0;
    document.getElementById('crmDiscount').value=o.discount||0;
    document.getElementById('crmPaidAmount').value=o.paidAmount||0;
    document.getElementById('crmRemaining').value=o.remainingAmount||0;
    document.getElementById('crmComment').value=o.comment;
    (o.items||[]).forEach(i=>crmAddItemRow(i));
    crmLegacyModeAtOpen=crmIsLegacyYearOrder();
    crmSyncLegacyMode();
    crmSyncDateRange(true);
    document.getElementById('crmCarryFloor').value=o.carryFloor||'no';
    document.getElementById('crmDepositStatus').value=o.depositStatus||'pending';
    document.getElementById('crmCompensationAmount').value=o.compensationAmount||0;
    document.getElementById('crmCompensationNote').value=o.compensationNote||'';
    crmSyncDepositUI();
    const dcEl=document.getElementById('crmDeliveryCost');if(dcEl)dcEl.dataset.manual='1';
    const scEl=document.getElementById('crmSetupCost');if(scEl)scEl.dataset.manual='1';
    setTimeout(crmCalcTotal,100);
  }else{
    document.getElementById('crmOrderId').value='';
    crmFillClientSelect('');
    ['crmPhone','crmCompany','crmAddress','crmComment'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('crmClient').value='';
    document.getElementById('crmAmount').value='';document.getElementById('crmBudget').value='';document.getElementById('crmDeposit').value='';
    document.getElementById('crmDeliveryCost').value='0';document.getElementById('crmSetupCost').value='0';document.getElementById('crmDiscount').value='0';document.getElementById('crmPaidAmount').value='0';document.getElementById('crmRemaining').value='0';if(document.getElementById('crmItemsTotal'))document.getElementById('crmItemsTotal').value='';if(document.getElementById('crmDiscountAmount'))document.getElementById('crmDiscountAmount').value='';
    document.getElementById('crmDeliveryType').value='delivery';
    document.getElementById('crmDeliveryZone').value='city';
    document.getElementById('crmDeliveryKm').value='0';
    const td=new Date();document.getElementById('crmStartDate').value=td.toISOString().slice(0,10);
    td.setDate(td.getDate()+1);document.getElementById('crmEndDate').value=td.toISOString().slice(0,10);
    crmLegacyModeAtOpen=crmIsLegacyYearOrder();
    crmSyncDateRange(true);
    crmSyncLegacyMode();
    crmSyncDeliveryControls();
    document.getElementById('crmCarryFloor').value='no';
    document.getElementById('crmDepositStatus').value='pending';
    document.getElementById('crmCompensationAmount').value='0';
    document.getElementById('crmCompensationNote').value='';
    crmSyncDepositUI();
    const dcEl2=document.getElementById('crmDeliveryCost');if(dcEl2)dcEl2.dataset.manual='';
    const scEl2=document.getElementById('crmSetupCost');if(scEl2)scEl2.dataset.manual='';
    crmAddItemRow();
  }
  crmSyncDeliveryControls();
  crmSyncPaidAndRemaining();
  crmCloseClientDropdown();
  crmPositionClientDropdown();
  crmOrderDialogInit=false;
  openModal('crmOrderModal');
}
function crmAddItemRow(item={name:'',qty:'1',category:'',price:0,setup:true}){
  if(!crmOrderDialogInit)crmOrderDialogDirty=true;
  const list=document.getElementById('crmItemsList');
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px auto 60px 24px;gap:6px;margin-bottom:6px;align-items:center';
  const legacy=crmIsLegacyYearOrder();
  const catOpts=crmCategories.map(c=>`<option value="${esc(c)}" ${item.category===c?'selected':''}>${esc(c)}</option>`).join('');
  const stockItems=item.category?crmStock.filter(s=>s.category===item.category):[];
  const savedInStock=!item.name||stockItems.some(s=>s.name===item.name);
  const fallbackOpt=(!savedInStock&&item.name)?`<option value="${esc(item.name)}" selected data-price="${item.price||0}" data-setup-rate="0">${esc(item.name)}</option>`:'';
  const itemOpts=fallbackOpt+stockItems.map(s=>`<option value="${esc(s.name)}" data-price="${legacy?0:s.price}" data-setup-rate="${s.setupRate||0}" ${item.name===s.name?'selected':''}>${esc(s.name)}${legacy?'':' — '+s.price+'₽'}</option>`).join('');
  const setupChecked=item.setup!==false?'checked':'';
  const initRate=item.name?(Number(crmStock.find(s=>s.name===item.name)?.setupRate)||0):0;
  row.innerHTML=`<select data-cat style="padding:6px 24px 6px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><option value="">Категория</option>${catOpts}</select><select data-name style="padding:6px 24px 6px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><option value="">Изделие</option>${itemOpts}</select><input type="number" data-qty value="${item.qty||1}" min="1" style="padding:6px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);cursor:pointer;white-space:nowrap"><input type="checkbox" data-setup ${setupChecked} style="width:14px;height:14px;cursor:pointer;accent-color:var(--blue);flex-shrink:0">Сетап<span data-rate-display style="color:var(--blue);font-size:10px;font-weight:600">${initRate>0?' '+initRate+'₽':''}</span></label><span data-price style="font-size:11px;color:var(--text2)">${item.price?item.price+'₽':''}</span><span onclick="crmOrderDialogDirty=true;this.parentElement.remove();crmCalcTotal()" style="cursor:pointer;text-align:center;color:var(--red)">✕</span>`;
  const catSel=row.querySelector('[data-cat]'),nameSel=row.querySelector('[data-name]'),priceSpan=row.querySelector('[data-price]'),qtyInp=row.querySelector('[data-qty]');
  catSel.addEventListener('change',()=>{const its=crmStock.filter(s=>s.category===catSel.value);const isLegacy=crmIsLegacyYearOrder();nameSel.innerHTML='<option value="">Изделие</option>'+its.map((s,i)=>`<option value="${esc(s.name)}" data-price="${isLegacy?0:s.price}" data-setup-rate="${s.setupRate||0}" ${i===0?'selected':''}>${esc(s.name)}${isLegacy?'':' — '+s.price+'₽'}</option>`).join('');const opt=nameSel.selectedOptions[0];priceSpan.textContent=isLegacy?'':(opt&&opt.dataset.price?opt.dataset.price+'₽':'');const rateSpan=row.querySelector('[data-rate-display]');const r0=Number(opt?.dataset.setupRate||0);if(rateSpan)rateSpan.textContent=r0>0?' '+r0+'₽':'';const setupCb0=row.querySelector('[data-setup]');if(setupCb0&&r0===0)setupCb0.checked=false;crmCalcTotal()});
  nameSel.addEventListener('change',()=>{const opt=nameSel.selectedOptions[0];const isLegacy=crmIsLegacyYearOrder();priceSpan.textContent=isLegacy?'':(opt&&opt.dataset.price?opt.dataset.price+'₽':'');const rateSpan=row.querySelector('[data-rate-display]');const r=Number(opt?.dataset.setupRate||0);if(rateSpan)rateSpan.textContent=r>0?' '+r+'₽':'';const setupCb=row.querySelector('[data-setup]');if(setupCb&&r===0)setupCb.checked=false;crmCalcTotal()});
  qtyInp.addEventListener('input',crmCalcTotal);
  list.appendChild(row);
  row.querySelector('[data-setup]')?.addEventListener('change',crmCalcTotal);
  crmApplyZeroClearBehavior(row);
}
function crmCalcTotal(){
  if(crmIsLegacyYearOrder())return;
  let itemsTotal=0;
  document.getElementById('crmItemsList').querySelectorAll('[data-qty]').forEach(q=>{
    const row=q.parentElement;const opt=row.querySelector('[data-name]').selectedOptions[0];
    const price=opt?Number(opt.dataset.price||0):0;
    itemsTotal+=price*Number(q.value||1);
  });
  const deliveryCostEl=document.getElementById('crmDeliveryCost');
  const setupCostEl=document.getElementById('crmSetupCost');
  const deliveryCost=deliveryCostEl?.dataset.manual==='1'?Number(deliveryCostEl.value||0):crmCalcDeliveryCost();
  const setupCost=setupCostEl?.dataset.manual==='1'?Number(setupCostEl.value||0):crmCalcSetupCost();
  if(deliveryCostEl&&deliveryCostEl.dataset.manual!=='1')deliveryCostEl.value=deliveryCost;
  if(setupCostEl&&setupCostEl.dataset.manual!=='1')setupCostEl.value=setupCost;
  const budgetEl=document.getElementById('crmBudget');
  if(budgetEl)budgetEl.value=deliveryCost+setupCost;
  const discountPct=Number(document.getElementById('crmDiscount')?.value||0);
  const discountAmt=Math.round(itemsTotal*discountPct/100);
  const total=(itemsTotal-discountAmt)+deliveryCost+setupCost;
  if(document.getElementById('crmItemsTotal'))document.getElementById('crmItemsTotal').value=itemsTotal-discountAmt;
  if(document.getElementById('crmDiscountAmount'))document.getElementById('crmDiscountAmount').value=discountAmt;
  document.getElementById('crmAmount').value=total>0?total:0;
  crmSyncPaidAndRemaining();
}
function crmSyncPaidAndRemaining(){
  const amountEl=document.getElementById('crmAmount');
  const paidEl=document.getElementById('crmPaidAmount');
  const remainingEl=document.getElementById('crmRemaining');
  const paymentEl=document.getElementById('crmPayment');
  if(!amountEl||!paidEl||!remainingEl)return;
  const total=Math.max(0,Number(amountEl.value||0));
  const status=paymentEl?.value||'pending_confirmation';
  let paid=Math.max(0,Number(paidEl.value||0));
  if(crmPaidStatuses.has(status))paid=total;
  if(paid>total)paid=total;
  paidEl.value=paid;
  remainingEl.value=Math.max(0,total-paid);
}
function crmGetItems(){
  const items=[];
  document.getElementById('crmItemsList').querySelectorAll('[data-qty]').forEach(q=>{
    const row=q.parentElement;
    const nameSel=row.querySelector('[data-name]');
    const cat=row.querySelector('[data-cat]').value;
    const name=crmGetSelectedItemName(nameSel,cat);
    const opt=nameSel?.selectedOptions?.[0];
    let price=Number(opt?.dataset.price||0);
    if(!price&&name){const stockItem=crmStock.find(s=>s.name===name);if(stockItem)price=Number(stockItem.price)||0;}
    if(name)items.push({name,category:cat,qty:q.value||'1',price,setup:row.querySelector('[data-setup]')?.checked!==false});
  });
  return items;
}
var _crmSaving=false;
async function crmSaveOrder(){
  if(_crmSaving)return;
  const saveBtn=document.querySelector('#crmOrderModal .btn-primary');
  const id=document.getElementById('crmOrderId').value;
  const paymentStatus=document.getElementById('crmPayment').value;
  const isPaid=crmPaidStatuses.has(paymentStatus);
  crmSyncPaidAndRemaining();
  const orderAmount=Number(document.getElementById('crmAmount').value)||0;
  const paidAmount=isPaid?orderAmount:(Number(document.getElementById('crmPaidAmount').value)||0);
  const o={clientName:document.getElementById('crmClient').value,clientPhone:document.getElementById('crmPhone').value,companyName:document.getElementById('crmCompany').value,startDate:document.getElementById('crmStartDate').value,endDate:document.getElementById('crmEndDate').value,orderAmount,budgetAmount:Number(document.getElementById('crmBudget').value)||0,depositAmount:Number(document.getElementById('crmDeposit').value)||0,deliveryCost:Number(document.getElementById('crmDeliveryCost').value)||0,setupCost:Number(document.getElementById('crmSetupCost').value)||0,discount:Number(document.getElementById('crmDiscount').value)||0,paidAmount,remainingAmount:Math.max(0,orderAmount-paidAmount),status:document.getElementById('crmStatus').value,paymentStatus,deliveryType:document.getElementById('crmDeliveryType').value,deliveryAddress:document.getElementById('crmAddress').value,setupRequired:document.getElementById('crmSetupCost').value>0?'yes':'no',items:crmGetItems(),comment:document.getElementById('crmComment').value,carryFloor:document.getElementById('crmCarryFloor')?.value||'no',depositStatus:document.getElementById('crmDepositStatus')?.value||'pending',compensationAmount:Number(document.getElementById('crmCompensationAmount')?.value||0),compensationNote:document.getElementById('crmCompensationNote')?.value||''};
  if(!o.clientName){showToast('Укажите клиента','error');return}
  if(!crmClients.some(c=>c.name===o.clientName)){showToast('Клиента нет в базе. Сначала добавьте клиента в разделе Клиенты.','error');return}
  if(id){
    const prevItems=(crmOrders.find(x=>x.id===id)?.items||[]).filter(i=>i.name);
    if(prevItems.length>0&&o.items.length===0&&!confirm('Список изделий пустой — изделия не выбраны. Сохранить без изделий?'))return;
  }
  _crmSaving=true;
  if(saveBtn){saveBtn.disabled=true;saveBtn._origText=saveBtn.textContent;saveBtn.textContent='⏳ Сохранение...';}
  try{
    if(id){
      o.id=id;await api('updateOrder',{order:o});const idx=crmOrders.findIndex(x=>x.id===id);if(idx>=0)crmOrders[idx]={...crmOrders[idx],...o};sbBackup('upsertOrder',o);await crmSyncClientsToSupabase();showToast('Обновлено','success')}
    else{const r=await api('addOrder',{order:o});if(r.success){o.id=r.id;crmOrders.push(crmNormalize(o));sbBackup('upsertOrder',o);await crmSyncClientsToSupabase()}showToast('Заказ создан','success')}
    crmOrderDialogDirty=false;closeModal('crmOrderModal',true);crmRenderAll();
  }catch(e){showToast('Ошибка сохранения','error')}
  finally{_crmSaving=false;if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn._origText||'Сохранить';}}
}
async function crmDeleteOrder(){
  const id=document.getElementById('crmOrderId').value;if(!id||!confirm('Удалить заказ?'))return;
  await api('deleteOrder',{id});sbBackup('deleteOrder',{id});crmOrders=crmOrders.filter(o=>o.id!==id);
  await crmSyncClientsToSupabase();
  crmOrderDialogDirty=false;closeModal('crmOrderModal',true);crmRenderAll();showToast('Удалено','success');
}

// ── PDF DOCUMENTS ────────────────────────────────────────────────────────────
function crmFmtN(n){return Math.round(Number(n)||0).toLocaleString('ru-RU');}
function crmFmtDate(s){
  if(!s)return'—';
  const d=new Date(s+'T12:00:00');
  return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
}
function crmFmtDateShort(s){
  if(!s)return'—';
  const d=new Date(s+'T12:00:00');
  return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
}
function crmGetPdfOrderData(){
  return{
    orderId:document.getElementById('crmOrderId').value||'NEW',
    clientName:document.getElementById('crmClient').value||'—',
    clientPhone:document.getElementById('crmPhone').value||'',
    startDate:document.getElementById('crmStartDate').value,
    endDate:document.getElementById('crmEndDate').value,
    deliveryType:document.getElementById('crmDeliveryType').value,
    deliveryAddress:document.getElementById('crmAddress').value||'',
    setupCost:Number(document.getElementById('crmSetupCost').value)||0,
    deliveryCost:Number(document.getElementById('crmDeliveryCost').value)||0,
    discountPct:Number(document.getElementById('crmDiscount').value)||0,
    depositAmt:Number(document.getElementById('crmDeposit').value)||0,
    carryFloor:document.getElementById('crmCarryFloor')?.value||'no',
    deliveryZone:document.getElementById('crmDeliveryZone')?.value||'city',
    deliveryKm:Number(document.getElementById('crmDeliveryKm')?.value)||0,
    companyName:document.getElementById('crmCompany').value||'',
    items:crmGetItems(),
  };
}
function crmRenderAndSavePDF(htmlStr,filename,cb,openInTab){
  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-9999px;top:0;z-index:-999;background:#fff;';
  container.innerHTML=htmlStr;
  const docRoot=container.firstElementChild;
  const isMobile=window.matchMedia&&window.matchMedia('(max-width: 768px)').matches;
  if(docRoot){
    docRoot.style.setProperty('-webkit-text-size-adjust','100%');
    docRoot.style.setProperty('text-size-adjust','100%');
    if(isMobile){
      // Mobile Safari tends to enlarge text in offscreen render; pre-scale keeps PDF typography consistent.
      docRoot.style.transform='scale(0.9)';
      docRoot.style.transformOrigin='top left';
    }
  }
  document.body.appendChild(container);
  html2canvas(container.firstElementChild,{scale:isMobile?1.8:2,useCORS:true,logging:false,backgroundColor:'#ffffff',windowWidth:1200}).then(canvas=>{
    document.body.removeChild(container);
    const{jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const pdfW=pdf.internal.pageSize.getWidth(),pdfH=pdf.internal.pageSize.getHeight();
    const ratio=pdfW/canvas.width,totalH=canvas.height*ratio;
    let offset=0;
    while(offset<totalH){if(offset>0)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',0.97),'JPEG',0,-offset,pdfW,totalH);offset+=pdfH;}
    if(cb)cb(pdf);
    if(openInTab){const url=URL.createObjectURL(pdf.output('blob'));window.open(url,'_blank');}
    else{pdf.save(filename);showToast('PDF скачан','success');}
  }).catch(()=>{showToast('Ошибка генерации PDF','error');if(document.body.contains(container))document.body.removeChild(container);});
}
function crmApplyEstimatePdfLink(pdf){
  if(!pdf||typeof pdf.link!=='function')return;
  const totalPages=typeof pdf.getNumberOfPages==='function'?pdf.getNumberOfPages():1;
  for(let page=1;page<=totalPages;page++){
    pdf.setPage(page);
    // Oversized invisible clickable area over the "Условия работы" footer block.
    pdf.link(10, 226, 190, 34, { url:'https://nandrent.ru/uslovia' });
  }
}
function crmBuildEstimateHTML(d,withDiscount){
  const isMobile=window.matchMedia&&window.matchMedia('(max-width: 768px)').matches;
  const{orderId,clientName,clientPhone,companyName,startDate,endDate,deliveryType,deliveryAddress,setupCost,deliveryCost,discountPct,depositAmt,carryFloor,deliveryZone,deliveryKm,items}=d;
  const itemsTotal=items.reduce((s,i)=>s+(Number(i.price)*Number(i.qty)),0);
  const discountAmt=withDiscount?Math.round(itemsTotal*discountPct/100):0;
  const itemsAfterDiscount=itemsTotal-discountAmt;
  const grandTotal=itemsAfterDiscount+deliveryCost+setupCost;
  const prepay=Math.round(grandTotal*0.5);
  const kmLine=(deliveryZone==='outside'&&deliveryKm>0)?deliveryKm+' км от города<br>':'';
  const deliveryMeta=deliveryType==='pickup'?'Самовывоз':kmLine+(deliveryAddress||'—');
  const setupMeta=setupCost>0?'Предусмотрен':'Не предусмотрен';
  const carryMeta=carryFloor==='yes'?'Предусмотрен':'Не предусмотрен';
  const docSubtitle=withDiscount?'Для профессионала':'Стандарт';
  const P='padding:10px 16px 10px 0;border-bottom:1px solid #ebebeb;';
  const PL='padding:10px 16px 10px 24px;border-bottom:1px solid #ebebeb;';
  const PR='border-right:1px solid #ebebeb;';
  const ML=(label,val)=>`<div style="font-size:8.5px;letter-spacing:2px;text-transform:uppercase;color:#aaa;font-family:sans-serif;margin-bottom:4px">${label}</div><div style="font-size:14px;font-weight:400;color:#1a1a1a;font-family:sans-serif;line-height:1.45">${val}</div>`;

  const iName=`font-size:${isMobile?'12.5px':'14px'};color:#1a1a1a;font-family:sans-serif;margin-bottom:3px`;
  const iDetail=`font-size:${isMobile?'11px':'12.5px'};color:#888;font-family:sans-serif`;
  const iRow=`padding:${isMobile?'5px':'7px'} 0;border-bottom:1px solid #f0f0f0`;
  const itemsRowsHTML=items.map(i=>{
    const unitPrice=withDiscount&&discountPct>0?Math.round(Number(i.price)*(1-discountPct/100)):Number(i.price);
    const sum=unitPrice*Number(i.qty);
    const iDisplay=crmGetItemDisplayName(i);
    return`<div style="${iRow}"><div style="${iName}">${iDisplay}</div><div style="${iDetail}">Кол-во: ${i.qty} &nbsp;|&nbsp; Цена: ${crmFmtN(unitPrice)} ₽ &nbsp;|&nbsp; Сумма: ${crmFmtN(sum)} ₽</div></div>`;
  }).join('');
  const deliveryRow=deliveryCost>0?`<div style="${iRow}"><div style="${iName};color:#888;font-style:italic">Доставка</div><div style="${iDetail}">Сумма: ${crmFmtN(deliveryCost)} ₽</div></div>`:'';
  const setupRow=setupCost>0?`<div style="padding:7px 0"><div style="${iName};color:#888;font-style:italic">Сетап</div><div style="${iDetail}">Сумма: ${crmFmtN(setupCost)} ₽</div></div>`:'';

  const totRow=(label,val,color='#888',size='12px',weight='400')=>`<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;font-family:sans-serif;font-size:${size};color:${color};font-weight:${weight}"><span>${label}</span><span style="white-space:nowrap;font-variant-numeric:tabular-nums;min-width:80px;text-align:right;color:${color}">${val}</span></div>`;
  let totalsBlock=`<div style="margin-top:16px;border-top:2px solid #1a1a1a;padding-top:14px;display:flex;justify-content:center"><div style="width:400px">`;
  totalsBlock+=`<div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#aaa;font-family:sans-serif;margin-bottom:10px">Итог</div>`;
  totalsBlock+=totRow('Сумма товаров',crmFmtN(itemsTotal)+' ₽');
  if(withDiscount&&discountAmt>0){
    totalsBlock+=totRow(`↓ Скидка ${discountPct}%`,'− '+crmFmtN(discountAmt)+' ₽','#7a9e7e','12px','600');
    totalsBlock+=totRow('Товары со скидкой',crmFmtN(itemsAfterDiscount)+' ₽');
  }
  if(deliveryCost>0)totalsBlock+=totRow('Доставка',crmFmtN(deliveryCost)+' ₽');
  if(setupCost>0)totalsBlock+=totRow('Сетап',crmFmtN(setupCost)+' ₽');
  totalsBlock+=`<hr style="border:none;border-top:1px solid #ccc;margin:8px 0">`;
  totalsBlock+=totRow('Итого к оплате <span style="font-size:10px;color:#888;font-weight:500;margin-left:6px">без учета залога</span>',crmFmtN(grandTotal)+' ₽','#1a1a1a','16px','700');
  totalsBlock+=`</div></div>`;

  const discountBadge=withDiscount&&discountPct>0
    ?`<span style="font-size:14px;font-weight:700;font-family:sans-serif">${discountPct}%</span><span style="display:inline-block;background:#1a1a1a;color:#fff;font-family:sans-serif;font-size:9.5px;letter-spacing:1px;padding:2px 9px;margin-left:7px">− ${crmFmtN(discountAmt)} ₽</span>`
    :'';

  // meta rows — always: клиент, период, доставка, сетап, залог, пронос, [скидка, исполнитель]
  const depositBlock=depositAmt>0?`<div style="${P}${PR}">${ML('Залог',`${crmFmtN(depositAmt)} ₽`)}</div><div style="${PL}">${ML('Пронос / Подъём на этаж',carryMeta)}</div>`
    :`<div style="${P}${PR}">${ML('Пронос / Подъём на этаж',carryMeta)}</div><div style="${PL}"></div>`;
  const executor='Компания NANDRENT<br>тел. +7 (966) 866-86-66';
  const lastRow=withDiscount&&discountPct>0
    ?`<div style="${P}${PR};border-bottom:none">${ML('Индивидуальная скидка',discountBadge)}</div><div style="${PL};border-bottom:none">${ML('Исполнитель',executor)}</div>`
    :`<div style="${P}${PR};border-bottom:none">${ML('Исполнитель',executor)}</div><div style="${PL};border-bottom:none"></div>`;

  const pi=(label,val)=>`<div style="font-family:sans-serif;font-size:${isMobile?'11px':'12px'};color:#333;line-height:${isMobile?'1.5':'1.6'}"><span style="font-size:${isMobile?'8.5px':'8px'};letter-spacing:1.5px;text-transform:uppercase;color:#bbb;display:block;margin-bottom:2px">${label}</span>${val}</div>`;
  const depositPayBlock=depositAmt>0?pi('Залог',`<strong>${crmFmtN(depositAmt)} ₽</strong><br>Возвращается после возврата и проверки изделий`):'';
  const payGrid=depositAmt>0
    ?`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">${pi('Предоплата',`50% для бронирования — <strong>${crmFmtN(prepay)} ₽</strong><br>Остаток — не позднее чем за 2 дня до получения`)}${depositPayBlock}${pi('Реквизиты',`Карта: <strong>+7 (906) 060-40-60</strong><br>Имя: Андрей Г. · Альфа-Банк`)}</div>`
    :`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${pi('Предоплата',`50% для бронирования — <strong>${crmFmtN(prepay)} ₽</strong><br>Остаток — не позднее чем за 2 дня до получения`)}${pi('Реквизиты',`Карта: <strong>+7 (906) 060-40-60</strong><br>Имя: Андрей Г. · Альфа-Банк`)}</div>`;

  return`<div style="width:794px;background:#fff;font-family:Georgia,serif"><div style="margin:0 60px;padding:44px 0 40px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:18px;margin-bottom:22px">
    <div><div style="font-size:24px;font-weight:700;letter-spacing:6px;color:#1a1a1a;font-family:Georgia,serif">NANDRENT</div><div style="font-size:8.5px;letter-spacing:3px;color:#999;text-transform:uppercase;font-family:sans-serif;margin-top:3px">Аренда посуды и мебели</div></div>
    <div style="text-align:right;font-family:sans-serif"><div style="font-size:16px;font-weight:700;color:#1a1a1a;letter-spacing:1px;text-transform:uppercase">Смета</div><div style="font-size:10.5px;color:#666;margin-top:3px">${docSubtitle}</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;margin-bottom:20px">
    <div style="${P}${PR}">${ML('Клиент',clientName+(companyName?'<br><span style="font-size:12px;color:#888">'+companyName+'</span>':'')+(clientPhone?'<br>'+clientPhone:''))}</div>
    <div style="${PL}">${ML('Период аренды',crmFmtDate(startDate)+'<br>— '+crmFmtDate(endDate))}</div>
    <div style="${P}${PR}">${ML('Доставка',deliveryMeta)}</div>
    <div style="${PL}">${ML('Сетап',setupMeta)}</div>
    ${depositBlock}
    ${lastRow}
  </div>
  <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#aaa;font-family:sans-serif;margin-bottom:${isMobile?'6px':'8px'}">Состав заказа</div>
  <div>${itemsRowsHTML}${deliveryRow}${setupRow}</div>
  ${totalsBlock}
  <div style="margin-top:20px;padding:${isMobile?'18px 20px':'16px 20px'};background:#f8f8f8;border-left:3px solid #1a1a1a">
    <div style="font-family:sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:10px">Условия оплаты</div>
    ${payGrid}
  </div>
  <div style="margin-top:14px;padding:${isMobile?'10px 12px':'12px 14px'};border:1px solid #d8d8d8;border-left:3px solid #8a8a8a;background:#f7f7f7;font-family:sans-serif;font-size:${isMobile?'9.4px':'10.5px'};color:#4f4f4f;line-height:${isMobile?'1.42':'1.5'}"><strong style="color:#2f2f2f">Важно:</strong> при отмене всего заказа или части позиций менее чем за 2 дня до получения удерживается полная стоимость аренды.</div>
  <div style="margin-top:10px;padding:${isMobile?'12px 14px':'10px 12px'};border:1px solid #e3e7ef;background:#fafbfd;border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-family:sans-serif">
    <div>
      <div style="font-size:${isMobile?'9px':'8px'};letter-spacing:1.8px;text-transform:uppercase;color:#9aa3b2;margin-bottom:3px">Условия работы</div>
      <div style="font-size:${isMobile?'11.2px':'10.5px'};color:#5b6472;line-height:1.4">Подробные условия аренды, оплаты и отмены заказа доступны на сайте.</div>
    </div>
    <div style="white-space:nowrap;font-size:${isMobile?'11.2px':'10.5px'};color:#3478f6;font-weight:600">nandrent.ru/uslovia</div>
  </div>
  <div style="margin-top:20px;padding-top:12px;border-top:1px solid #d9d9d9;display:flex;justify-content:space-between;align-items:center"><span style="font-size:9px;letter-spacing:3px;color:#9b9b9b;font-family:sans-serif;text-transform:uppercase">NANDRENT</span><span style="font-size:10px;color:#555;font-family:sans-serif;font-weight:600">Пожалуйста, отправьте менеджеру чек после перевода</span></div>
</div></div>`;
}
function crmBuildActHTML(d){
  const{orderId,clientName,clientPhone,companyName,startDate,endDate,deliveryType,deliveryAddress,setupCost,depositAmt,carryFloor,deliveryZone,deliveryKm,items}=d;
  const kmLine=(deliveryZone==='outside'&&deliveryKm>0)?deliveryKm+' км от города<br>':'';
  const deliveryMeta=deliveryType==='pickup'?'Самовывоз':kmLine+(deliveryAddress||'—');
  const setupMeta=setupCost>0?'Предусмотрен':'Не предусмотрен';
  const carryMeta=carryFloor==='yes'?'Предусмотрен':'Не предусмотрен';
  const P='padding:10px 16px 10px 0;border-bottom:1px solid #ebebeb;';
  const PL='padding:10px 16px 10px 24px;border-bottom:1px solid #ebebeb;';
  const PR='border-right:1px solid #ebebeb;';
  const ML=(label,val)=>`<div style="font-size:8.5px;letter-spacing:2px;text-transform:uppercase;color:#aaa;font-family:sans-serif;margin-bottom:4px">${label}</div><div style="font-size:12px;font-weight:400;color:#1a1a1a;font-family:sans-serif;line-height:1.45">${val}</div>`;

  const aName='font-size:14px;color:#1a1a1a;font-family:sans-serif;margin-bottom:3px';
  const aDetail='font-size:12.5px;color:#888;font-family:sans-serif';
  const aRow='padding:9px 0;border-bottom:1px solid #f0f0f0';
  const itemsRowsHTML=items.map(i=>{const aDisplay=crmGetItemDisplayName(i);return`<div style="${aRow}"><div style="${aName}">${aDisplay}</div><div style="${aDetail}">Получено: ${i.qty} шт &nbsp;|&nbsp; Возвращено: ___</div></div>`}).join('');

  const sigLine=(label)=>`<div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:32px;font-family:sans-serif;font-size:12px;color:#333">
    <span style="white-space:nowrap">${label}</span>
    <span style="white-space:nowrap">Клиент</span><span style="flex:1;border-bottom:1px solid #1a1a1a;min-width:100px"></span>
    <span style="white-space:nowrap">Исполнитель</span><span style="flex:1;border-bottom:1px solid #1a1a1a;min-width:100px"></span>
  </div>`;

  return`<div style="width:794px;background:#fff;font-family:Georgia,serif"><div style="margin:0 60px;padding:44px 0 40px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:18px;margin-bottom:22px">
    <div><div style="font-size:24px;font-weight:700;letter-spacing:6px;color:#1a1a1a;font-family:Georgia,serif">NANDRENT</div><div style="font-size:8.5px;letter-spacing:3px;color:#999;text-transform:uppercase;font-family:sans-serif;margin-top:3px">Аренда посуды и мебели</div></div>
    <div style="text-align:right;font-family:sans-serif"><div style="font-size:16px;font-weight:700;color:#1a1a1a;letter-spacing:1px;text-transform:uppercase">Акт передачи</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;margin-bottom:20px">
    <div style="${P}${PR}">${ML('Исполнитель','Компания NANDRENT<br>тел. +7 (966) 866-86-66')}</div>
    <div style="${PL}">${ML('Клиент',clientName+(companyName?'<br><span style="font-size:11px;color:#888">'+companyName+'</span>':'')+(clientPhone?'<br>'+clientPhone:''))}</div>
    <div style="${P}${PR}">${ML('Получение / Возврат',crmFmtDate(startDate)+' — '+crmFmtDate(endDate))}</div>
    <div style="${PL}">${ML('Доставка',deliveryMeta)}</div>
    <div style="${P}${PR}">${ML('Сетап',setupMeta)}</div>
    <div style="${PL}">${ML('Пронос / Подъём на этаж',carryMeta)}</div>
    <div style="${P}${PR};border-bottom:none">${ML('Залог принят',depositAmt>0?`${crmFmtN(depositAmt)} ₽`:'—')}</div>
    <div style="${PL};border-bottom:none"></div>
  </div>
  <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#aaa;font-family:sans-serif;margin-bottom:8px">Состав заказа</div>
  <div>${itemsRowsHTML}</div>
  <div style="margin-top:40px;font-family:sans-serif;font-size:12px;color:#333">
    ${sigLine('«Получено» подтверждаю:')}
    ${sigLine('«Возвращено» подтверждаю:')}
    <div style="display:flex;align-items:flex-end;gap:14px"><span style="white-space:nowrap">С условиями ознакомлен/а. Услуга оказана в полном объёме</span><span style="flex:1;border-bottom:1px solid #1a1a1a;min-width:80px"></span></div>
  </div>
  <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e3e3e3;display:flex;justify-content:space-between;align-items:center"><span style="font-size:9px;letter-spacing:3px;color:#b0b0b0;font-family:sans-serif;text-transform:uppercase">NANDRENT</span><span style="font-size:10px;color:#6a6a6a;font-family:sans-serif;font-weight:600">Залог возвращается после возврата и проверки изделий.</span></div>
</div></div>`;
}
function crmGenerateEstimatePDF(withDiscount){
  const d=crmGetPdfOrderData();
  showToast('Генерируем PDF…','info');
  const fname=withDiscount?`Смета_профессионал_${d.orderId}.pdf`:`Смета_${d.orderId}.pdf`;
  crmRenderAndSavePDF(crmBuildEstimateHTML(d,withDiscount),fname,crmApplyEstimatePdfLink);
}
function crmGenerateActPDF(){
  const d=crmGetPdfOrderData();
  showToast('Генерируем акт…','info');
  crmRenderAndSavePDF(crmBuildActHTML(d),`Акт_${d.orderId}.pdf`);
}
function crmDownloadAllPDF(){
  const d=crmGetPdfOrderData();
  showToast('Открываем 3 документа…','info');
  crmRenderAndSavePDF(crmBuildEstimateHTML(d,true),null,crmApplyEstimatePdfLink,true);
  setTimeout(()=>crmRenderAndSavePDF(crmBuildEstimateHTML(d,false),null,crmApplyEstimatePdfLink,true),1200);
  setTimeout(()=>crmRenderAndSavePDF(crmBuildActHTML(d),null,null,true),2400);
}
function crmSharePDF(type){
  const d=crmGetPdfOrderData();
  let html,fname;
  if(type==='pro'){html=crmBuildEstimateHTML(d,true);fname=`Смета_профессионал_${d.orderId}.pdf`}
  else if(type==='std'){html=crmBuildEstimateHTML(d,false);fname=`Смета_${d.orderId}.pdf`}
  else{html=crmBuildActHTML(d);fname=`Акт_${d.orderId}.pdf`}
  showToast('Генерируем PDF…','info');
  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-9999px;top:0;z-index:-999;background:#fff;';
  container.innerHTML=html;
  document.body.appendChild(container);
  html2canvas(container.firstElementChild,{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff'}).then(canvas=>{
    document.body.removeChild(container);
    const{jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const pdfW=pdf.internal.pageSize.getWidth(),pdfH=pdf.internal.pageSize.getHeight();
    const ratio=pdfW/canvas.width,totalH=canvas.height*ratio;
    let offset=0;
    while(offset<totalH){if(offset>0)pdf.addPage();pdf.addImage(canvas.toDataURL('image/jpeg',0.97),'JPEG',0,-offset,pdfW,totalH);offset+=pdfH;}
    if(type!=='act')crmApplyEstimatePdfLink(pdf);
    const blob=pdf.output('blob');
    const file=new File([blob],fname,{type:'application/pdf'});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
      navigator.share({files:[file]}).then(()=>showToast('Отправлено','success')).catch(()=>{});
    }else{
      pdf.save(fname);showToast('Скачано (отправка не поддерживается)','info');
    }
  }).catch(()=>{showToast('Ошибка генерации PDF','error');if(document.body.contains(container))document.body.removeChild(container);});
}
// CRM Dashboard
function crmRenderDash(){
  const ysel=document.getElementById('crmDashYear'),msel=document.getElementById('crmDashMonth');
  if(!ysel||!msel)return;
  const now=new Date(),cy=now.getFullYear(),cm=now.getMonth();
  const years=[...new Set([cy,...crmOrders.map(o=>crmParseDateLocal(o.startDate)?.getFullYear()).filter(Boolean)])].filter(y=>y>2020).sort((a,b)=>b-a);
  // Всегда обновляем список годов (могли добавиться новые заказы)
  const prevYear=ysel.value;
  ysel.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');
  if(!ysel.dataset.init){ysel.value=cy;ysel.dataset.init='1';
  ysel.addEventListener('change',crmRenderDash);msel.addEventListener('change',crmRenderDash);
  document.getElementById('crmCompareYear')?.addEventListener('change',crmRenderDash);
  const mLabels=Array.from({length:12},(_,m)=>new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(new Date(cy,m,1)));
  msel.innerHTML=mLabels.map((l,m)=>`<option value="${m}">${l}</option>`).join('');msel.value=cm}
  else{ysel.value=prevYear||cy}
  const cmpSel=document.getElementById('crmCompareYear');
  if(cmpSel){cmpSel.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');if(!cmpSel.value)cmpSel.value=String(cy)}
  const sy=Number(ysel.value),sm=Number(msel.value);
  const mOrders=crmOrders.filter(o=>{const d=crmParseDateLocal(o.startDate);return d&&d.getMonth()===sm&&d.getFullYear()===sy});
  const yOrders=crmOrders.filter(o=>crmParseDateLocal(o.startDate)?.getFullYear()===sy);
  const mPaid=mOrders.filter(o=>crmPaidStatuses.has(o.paymentStatus));
  const yPaid=yOrders.filter(o=>crmPaidStatuses.has(o.paymentStatus));
  const mRev=mPaid.reduce((s,o)=>s+o.orderAmount,0);
  const yRev=yPaid.reduce((s,o)=>s+o.orderAmount,0);
  document.getElementById('crmMonthRevenue').textContent=fN(mRev)+'₽';
  document.getElementById('crmMonthAvg').textContent=mPaid.length?fN(Math.round(mRev/mPaid.length))+'₽':'0 ₽';
  document.getElementById('crmMonthCount').textContent=mOrders.length;
  document.getElementById('crmYearRevenue').textContent=fN(yRev)+'₽';
  document.getElementById('crmYearAvg').textContent=yPaid.length?fN(Math.round(yRev/yPaid.length))+'₽':'0 ₽';
  // Compensation stats
  const mComp=mOrders.filter(o=>Number(o.compensationAmount)>0);
  const yComp=yOrders.filter(o=>Number(o.compensationAmount)>0);
  const mCompSum=mComp.reduce((s,o)=>s+Number(o.compensationAmount),0);
  const yCompSum=yComp.reduce((s,o)=>s+Number(o.compensationAmount),0);
  const mCompEl=document.getElementById('crmMonthComp');
  const yCompEl=document.getElementById('crmYearComp');
  if(mCompEl)mCompEl.textContent=mCompSum?fN(mCompSum)+'₽':'0 ₽';
  if(yCompEl){
    yCompEl.textContent=yCompSum?fN(yCompSum)+'₽':'0 ₽';
    yCompEl.style.cursor=yCompSum?'pointer':'default';
    yCompEl.onclick=yCompSum?function(){
      const det=document.getElementById('crmCompensationDetails');
      const tb=document.getElementById('crmCompTable');
      if(det&&tb){
        det.style.display=det.style.display==='none'?'block':'none';
        tb.innerHTML=yComp.sort((a,b)=>(crmParseDateLocal(a.startDate)?.getTime()||0)-(crmParseDateLocal(b.startDate)?.getTime()||0))
          .map(o=>`<tr><td>${o.startDate||'—'}</td><td>${esc(o.clientName||'—')}</td><td class="mono" style="color:var(--red)">${fN(Number(o.compensationAmount))}₽</td><td>${esc(o.compensationNote||'—')}</td></tr>`).join('');
      }
    }:null;
  }
  // Charts
  const monthly=Array.from({length:12},(_,m)=>({m,rev:0,cnt:0,paidCnt:0}));
  yOrders.forEach(o=>{const m=crmParseDateLocal(o.startDate)?.getMonth();if(m==null)return;monthly[m].cnt++;if(crmPaidStatuses.has(o.paymentStatus)){monthly[m].rev+=o.orderAmount;monthly[m].paidCnt++}});
  const mNames=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const revChart=document.getElementById('crmChartRevenue');
  const ordChart=document.getElementById('crmChartOrders');
  if(window.crmChart1)window.crmChart1.destroy();if(window.crmChart2)window.crmChart2.destroy();if(window.crmChart3)window.crmChart3.destroy();if(window.crmChart4)window.crmChart4.destroy();if(window.crmCmpChart1)window.crmCmpChart1.destroy();if(window.crmCmpChart2)window.crmCmpChart2.destroy();if(window.crmCmpChart3)window.crmCmpChart3.destroy();
  if(revChart){window.crmChart1=new Chart(revChart,{type:'line',data:{labels:mNames,datasets:[{data:monthly.map(m=>m.rev),borderColor:'#007aff',tension:.3,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  if(ordChart){window.crmChart2=new Chart(ordChart,{type:'bar',data:{labels:mNames,datasets:[{data:monthly.map(m=>m.cnt),backgroundColor:'rgba(52,199,89,0.5)',borderColor:'#34c759',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}})}
  const avgChart=document.getElementById('crmChartAvg');
  const avgData=monthly.map(m=>m.paidCnt?Math.round(m.rev/m.paidCnt):0);
  if(avgChart){window.crmChart3=new Chart(avgChart,{type:'line',data:{labels:mNames,datasets:[{data:avgData,borderColor:'#af52de',tension:.3,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  const idxChart=document.getElementById('crmChartIndex');
  const maxRev=Math.max(...monthly.map(m=>m.rev),1);const maxCnt=Math.max(...monthly.map(m=>m.cnt),1);const maxAvg=Math.max(...avgData,1);
  const indexData=monthly.map((m,i)=>{const r=m.rev/maxRev*100;const c=m.cnt/maxCnt*100;const a=avgData[i]/maxAvg*100;return Math.round((r+c+a)/3)});
  if(idxChart){window.crmChart4=new Chart(idxChart,{type:'bar',data:{labels:mNames,datasets:[{data:indexData,backgroundColor:indexData.map((v,i)=>{const mx=Math.max(...indexData);return v===mx?'rgba(52,199,89,0.7)':'rgba(0,122,255,0.4)'}),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{max:100,ticks:{callback:v=>v+'%'}}}}})}
  const summary=document.getElementById('crmIndexSummary');
  if(summary){const maxIdx=Math.max(...indexData);const minIdx=Math.min(...indexData.filter(v=>v>0));const bestM=indexData.indexOf(maxIdx);const worstM=indexData.indexOf(minIdx>0?minIdx:0);summary.textContent=maxIdx>0?`Лучший месяц: ${mNames[bestM]} (${maxIdx}%). ${minIdx>0?'Слабый: '+mNames[worstM]+' ('+minIdx+'%)':''}`:'Нет данных'}

  // Year compare dashboard
  const cmpYear=Number(cmpSel?.value||sy);
  const cmpYears=years.filter(y=>y<=cmpYear).sort((a,b)=>a-b);
  const byYear=cmpYears.map(y=>{
    const list=crmOrders.filter(o=>crmParseDateLocal(o.startDate)?.getFullYear()===y);
    const paid=list.filter(o=>crmPaidStatuses.has(o.paymentStatus));
    const rev=paid.reduce((s,o)=>s+o.orderAmount,0);
    const avg=paid.length?Math.round(rev/paid.length):0;
    const comp=list.reduce((s,o)=>s+Number(o.compensationAmount||0),0);
    return{year:y,count:list.length,paidCount:paid.length,rev,avg,comp};
  });
  const yl=byYear.map(x=>String(x.year));
  const rc=document.getElementById('crmCompareRevenue');
  const oc=document.getElementById('crmCompareOrders');
  const ac=document.getElementById('crmCompareAvg');
  if(rc){window.crmCmpChart1=new Chart(rc,{type:'bar',data:{labels:yl,datasets:[{data:byYear.map(x=>x.rev),backgroundColor:'rgba(0,122,255,0.45)',borderColor:'#007aff',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  if(oc){window.crmCmpChart2=new Chart(oc,{type:'bar',data:{labels:yl,datasets:[{data:byYear.map(x=>x.count),backgroundColor:'rgba(52,199,89,0.45)',borderColor:'#34c759',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}})}
  if(ac){window.crmCmpChart3=new Chart(ac,{type:'line',data:{labels:yl,datasets:[{data:byYear.map(x=>x.avg),borderColor:'#af52de',tension:.25,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  const tt=document.getElementById('crmCompareTable');
  if(tt){
    if(!byYear.length){tt.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:16px">Нет данных</td></tr>'}
    else{
      tt.innerHTML=byYear.map((x,i)=>{const p=byYear[i-1];const d=p&&p.rev>0?Math.round(((x.rev-p.rev)/p.rev)*100):null;return`<tr><td>${x.year}</td><td>${x.count}</td><td>${x.paidCount}</td><td class="mono">${fN(x.rev)}₽</td><td class="mono">${x.avg?fN(x.avg)+'₽':'—'}</td><td class="mono" style="color:${x.comp?'var(--red)':'var(--text3)'}">${x.comp?fN(x.comp)+'₽':'—'}</td><td class="mono" style="color:${d==null?'var(--text3)':d>=0?'var(--green)':'var(--red)'}">${d==null?'—':(d>0?'+':'')+d+'%'}</td></tr>`}).join('');
    }
  }
}
function crmToggleItems(id){
  const row=document.getElementById('crmItemsRow-'+id);
  if(!row)return;
  const btn=document.querySelector(`button[onclick="crmToggleItems('${id}')"]`);
  const isOpen=row.style.display!=='none';
  row.style.display=isOpen?'none':'';
  if(btn)btn.textContent=isOpen?'↓':'↑';
}
// CRM filter events
document.getElementById('crmSearchInput')?.addEventListener('input',()=>crmRenderOrders());
document.getElementById('crmCompletionFilter')?.addEventListener('change',()=>{crmQuickFilter='all';crmRenderOrders()});
document.getElementById('crmStatusFilter')?.addEventListener('change',()=>crmRenderOrders());
document.getElementById('crmPaymentFilter')?.addEventListener('change',()=>crmRenderOrders());
document.getElementById('crmClient')?.addEventListener('change',e=>crmClientApplyToOrder(e.target.value));
document.addEventListener('click',e=>{
  const picker=document.querySelector('.crm-client-picker');
  if(!picker||picker.contains(e.target))return;
  crmCloseClientDropdown();
});
document.getElementById('crmClientsSearch')?.addEventListener('input',()=>crmRenderClients());
document.getElementById('crmClientsYear')?.addEventListener('change',e=>{crmClientsYears=Array.from(e.target.selectedOptions).map(o=>Number(o.value)).filter(Boolean);crmRenderClients()});
document.getElementById('crmClientsYearAll')?.addEventListener('change',e=>{crmClientsAllYears=!!e.target.checked;crmRenderClients()});
document.getElementById('crmClientsDashYears')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashAllTime')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashTopN')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashMetricTurnover')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashMetricRevenue')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashMetricOrders')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientsDashMetricAvg')?.addEventListener('change',()=>crmRenderClientsDashboard());
document.getElementById('crmClientTrendTarget')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmClientTrendSearch')?.addEventListener('input',()=>{crmFillClientDashboardControls();crmRenderClientAnalytics()});
document.getElementById('crmClientTrendYears')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmClientTrendAllTime')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmClientTrendCompare')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmClientTrendCompareTarget')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmClientTrendCompareSearch')?.addEventListener('input',()=>{crmFillClientDashboardControls();crmRenderClientAnalytics()});
document.getElementById('crmTrendMetricTurnover')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmTrendMetricRevenue')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmTrendMetricOrders')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmTrendMetricAvg')?.addEventListener('change',()=>crmRenderClientAnalytics());
document.getElementById('crmStockSearch')?.addEventListener('input',()=>crmRenderStock());
document.getElementById('crmStockTopMode')?.addEventListener('change',()=>crmRenderStockTopDashboard());
document.getElementById('crmStockTopYears')?.addEventListener('change',()=>crmRenderStockTopDashboard());
document.getElementById('crmStockTopAllTime')?.addEventListener('change',()=>crmRenderStockTopDashboard());
document.getElementById('crmStockTopMetric')?.addEventListener('change',()=>crmRenderStockTopDashboard());
document.getElementById('crmStockTopN')?.addEventListener('change',()=>crmRenderStockTopDashboard());
document.getElementById('crmStockAnalysisCategory')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockAnalysisItem')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockAnalysisYears')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockAnalysisAllTime')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockMetricQty')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockMetricAmount')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockMetricOrders')?.addEventListener('change',()=>crmRenderStockAnalysis());
document.getElementById('crmStockModal')?.addEventListener('click',e=>{if(e.target===document.getElementById('crmStockModal'))closeModal('crmStockModal')});
document.getElementById('crmClientModal')?.addEventListener('click',e=>{if(e.target===document.getElementById('crmClientModal'))closeModal('crmClientModal')});
document.getElementById('crmClientProfileModal')?.addEventListener('click',e=>{if(e.target===document.getElementById('crmClientProfileModal'))closeModal('crmClientProfileModal')});
document.getElementById('crmYearFilter')?.addEventListener('change',e=>{crmYearFilter=Number(e.target.value)||0;crmRenderOrders()});
document.getElementById('crmStartDate')?.addEventListener('change',crmHandleStartDateChange);
document.getElementById('crmEndDate')?.addEventListener('change',()=>{crmSyncDateRange(true)});
window.canCloseModal=(id)=>id==='crmOrderModal'?crmCanCloseOrderDialog():true;
// Init CRM on page switch
const origSwitchPage=switchPage;
switchPage=function(p){origSwitchPage(p);if(p==='crm'||p==='clients'||p==='crmstock'||p==='crmdash'){if(!crmOrders.length&&!crmStock.length)crmInit();else crmRenderAll()}}
