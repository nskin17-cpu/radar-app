// ========== CRM MODULE ==========
let crmOrders=[],crmStock=[],crmCategories=[],crmQuickFilter='all',crmYearFilter=new Date().getFullYear();
let crmOrderDialogDirty=false,crmOrderDialogInit=false,crmLegacyModeAtOpen=false,crmOrderInputsBound=false;
const crmPricingDefaults={
  deliveryBaseCity:7200,
  deliveryPerKm:110,
  setupMin:2500,
  setupChairNepalMetal:80,
  setupChairNepal:105,
  setupChairModern:60,
  setupChairModernCushion:85,
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
  const start=document.getElementById('crmStartDate')?.value||'';
  const y=Number(String(start).slice(0,4));
  return y===2023||y===2024;
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
    deliveryCost.readOnly=!legacy;
    deliveryCost.style.background=legacy?'var(--surface)':'var(--surface2)';
  }
  if(setupCost){
    setupCost.readOnly=!legacy;
    setupCost.style.background=legacy?'var(--surface)':'var(--surface2)';
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
    nameSel.innerHTML='<option value="">Изделие</option>'+its.map(s=>`<option value="${esc(s.name)}" data-price="${legacy?0:s.price}" ${selectedName===s.name?'selected':''}>${esc(s.name)}${legacy?'':' — '+s.price+'₽'}</option>`).join('');
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
    const name=row.querySelector('[data-name]')?.value||'';
    const category=row.querySelector('[data-cat]')?.value||'';
    const qty=Math.max(0,Number(q.value||0));
    const rate=crmItemSetupRate(name,category);
    total+=rate*qty;
  });
  if(total>0&&total<crmPricing.setupMin)total=crmPricing.setupMin;
  return Math.round(total);
}
function crmApplyZeroClearBehavior(scope){
  scope.querySelectorAll('input[type="number"]').forEach(inp=>{
    if(inp.dataset.zeroClearBound==='1')return;
    inp.dataset.zeroClearBound='1';
    inp.addEventListener('focus',()=>{if(inp.value==='0')inp.value=''});
  });
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
  document.getElementById('crmDeliveryType')?.addEventListener('change',()=>{crmSyncDeliveryControls();crmCalcTotal()});
  document.getElementById('crmDeliveryZone')?.addEventListener('change',()=>{crmSyncDeliveryControls(true);crmCalcTotal()});
  document.getElementById('crmDeliveryKm')?.addEventListener('input',crmCalcTotal);
  document.getElementById('crmBudget')?.addEventListener('input',e=>{e.target.dataset.manual='1';});
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
async function crmInit(){
  const[r1,r2,r3]=await Promise.all([api('getOrders'),api('getStock'),api('getPricingConfig')]);
  if(r1.success)crmOrders=(r1.orders||[]).map(crmNormalize);
  if(r2.success){crmStock=r2.stock||[];crmCategories=[...new Set(crmStock.map(s=>s.category).filter(Boolean))].sort()}
  crmApplyPricingConfig(crmExtractPricingConfig(r3));
  crmRenderAll();
}
function crmNormalize(o){
  let items=Array.isArray(o.items)?o.items:[];
  if(typeof o.items==='string')try{items=JSON.parse(o.items)}catch{items=[]}
  return{id:o.id||'',clientName:o.clientName||'',clientPhone:o.clientPhone||'',companyName:o.companyName||'',startDate:o.startDate?String(o.startDate).slice(0,10):'',endDate:o.endDate?String(o.endDate).slice(0,10):'',orderAmount:Number(o.orderAmount||0),budgetAmount:Number(o.budgetAmount||0),depositAmount:Number(o.depositAmount||0),deliveryCost:Number(o.deliveryCost||0),setupCost:Number(o.setupCost||0),discount:Number(o.discount||0),remainingAmount:Number(o.remainingAmount||0),status:o.status||'preparing',paymentStatus:o.paymentStatus||'pending_confirmation',deliveryType:o.deliveryType||'pickup',deliveryAddress:o.deliveryAddress||'',setupRequired:o.setupRequired||'no',items:items.map(i=>({name:String(i.name||''),qty:String(i.qty||'1'),category:String(i.category||''),price:Number(i.price||0),setup:i.setup!==undefined?i.setup:true})),comment:o.comment||'',carryFloor:o.carryFloor||o.carry_floor||'no',depositStatus:o.depositStatus||o.deposit_status||'pending',compensationAmount:Number(o.compensationAmount||o.compensation_amount||0),compensationNote:o.compensationNote||o.compensation_note||''};
}
function crmRenderAll(){crmRenderOrders();crmRenderStats();crmRenderStock();crmRenderDash();crmSyncQuickFilterUI()}
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
  const depositBg={pending:'',deposited:'#e6f1ff',returned:'#e4f6e8',returned_comp:'#fff3cd'};
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
    const itemsList=(o.items||[]).map(i=>`${esc(i.name)} ×${i.qty}`).join(', ')||'—';
    return `${sep}<tr>
    <td>${rowIndex}</td><td><strong>${esc(o.clientName)}</strong><br><span style="color:var(--text2);font-size:11px">${esc(o.clientPhone)}</span>${showRemain?`<br><span class="badge badge-amber" style="margin-top:4px">Остаток: ${fN(remain)}₽</span>`:''}</td>
    <td><button onclick="crmToggleItems('${o.id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--text2);padding:2px 4px" title="Показать изделия">↓</button></td>
    <td style="font-size:11px">${deliveryCell}</td>
    <td class="mono" style="font-size:11px">${crmFormatDate(o.startDate)} — ${crmFormatDate(o.endDate)}</td>
    <td class="mono">${fN(o.orderAmount)}₽</td>
    <td><select data-crm-status="${o.id}" style="padding:4px 20px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.status==='completed'?'#e4f6e8':o.status==='in_progress'?'#e6f1ff':o.status==='assembly'?'#fff3cd':'#ffeddc'}">${Object.entries(crmSL).map(([v,l])=>`<option value="${v}" ${o.status===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><select data-crm-payment="${o.id}" style="padding:4px 20px 4px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${o.paymentStatus==='paid'?'#e4f6e8':o.paymentStatus==='paid_cash'?'#ffe0f0':o.paymentStatus==='prepaid'?'#efe6ff':'#ffeddc'}">${Object.entries(crmPL).map(([v,l])=>`<option value="${v}" ${o.paymentStatus===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><select data-crm-deposit="${o.id}" style="padding:3px 20px 3px 6px;font-size:11px;border:0.5px solid var(--border2);border-radius:6px;background:${depositBg[o.depositStatus]||''}">${Object.entries(depositLbl).map(([v,l])=>`<option value="${v}" ${o.depositStatus===v?'selected':''}>${l}</option>`).join('')}</select></td>
    <td><button class="btn btn-sm btn-secondary" onclick="crmOpenDialog('${o.id}')" style="padding:4px 8px;font-size:11px">✎</button></td>
  </tr><tr id="crmItemsRow-${o.id}" style="display:none"><td colspan="10" style="padding:4px 10px 8px 24px;font-size:11px;color:var(--text2);background:var(--surface2)">${itemsList}</td></tr>`;
  }).join('');
  t.querySelectorAll('[data-crm-status]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmStatus;const o=crmOrders.find(x=>x.id===id);if(o){o.status=e.target.value;await api('updateOrder',{order:{id,status:e.target.value}});crmRenderAll();showToast('Статус обновлён','success')}}));
  t.querySelectorAll('[data-crm-payment]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmPayment;const o=crmOrders.find(x=>x.id===id);if(o){const p=e.target.value;o.paymentStatus=p;const update={id,paymentStatus:p};if(crmPaidStatuses.has(p)){o.remainingAmount=0;update.remainingAmount=0}await api('updateOrder',{order:update});crmRenderAll();showToast('Оплата обновлена','success')}}));
  t.querySelectorAll('[data-crm-deposit]').forEach(sel=>sel.addEventListener('change',async e=>{const id=sel.dataset.crmDeposit;const o=crmOrders.find(x=>x.id===id);if(o){o.depositStatus=e.target.value;sel.style.background=depositBg[e.target.value]||'';await api('updateOrder',{order:{id,depositStatus:e.target.value}});if(e.target.value==='returned_comp')crmOpenDialog(id);else showToast('Статус залога обновлён','success');}}))}
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
function crmSetQuickFilter(f){crmQuickFilter=crmQuickFilter===f?'all':f;crmRenderOrders();crmSyncQuickFilterUI()}
function crmRenderStock(){
  const t=document.getElementById('crmStockTable');if(!t)return;
  const q=(document.getElementById('crmStockSearch')?.value||'').toLowerCase();
  const items=crmStock.filter(s=>!q||[s.name,s.category].join(' ').toLowerCase().includes(q));
  if(!items.length){t.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:20px">Нет позиций</td></tr>';return}
  t.innerHTML=items.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.name)}</td><td><span class="badge badge-blue">${esc(s.category)}</span></td><td class="mono">${fN(s.price)}₽</td><td>${s.qty} ${esc(s.unit||'шт')}</td></tr>`).join('')}
// CRM Dialog
function crmOpenDialog(id){
  const m=document.getElementById('crmOrderModal');
  crmBindDialogInputs();
  crmOrderDialogInit=true;
  crmOrderDialogDirty=false;
  document.getElementById('crmDialogTitle').textContent=id?'Редактировать заказ':'Новый заказ';
  document.getElementById('crmDeleteBtn').style.display=id?'inline-block':'none';
  document.getElementById('crmItemsList').innerHTML='';
  if(id){
    const o=crmOrders.find(x=>x.id===id);if(!o)return;
    document.getElementById('crmOrderId').value=o.id;
    document.getElementById('crmClient').value=o.clientName;
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
    const budgetEl=document.getElementById('crmBudget');if(budgetEl)budgetEl.dataset.manual=o.budgetAmount>0?'1':'';
    setTimeout(crmCalcTotal,100);
  }else{
    document.getElementById('crmOrderId').value='';
    ['crmClient','crmPhone','crmCompany','crmAddress','crmComment'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('crmAmount').value='';document.getElementById('crmBudget').value='';document.getElementById('crmDeposit').value='';
    document.getElementById('crmDeliveryCost').value='0';document.getElementById('crmSetupCost').value='0';document.getElementById('crmDiscount').value='0';document.getElementById('crmRemaining').value='0';if(document.getElementById('crmItemsTotal'))document.getElementById('crmItemsTotal').value='';if(document.getElementById('crmDiscountAmount'))document.getElementById('crmDiscountAmount').value='';
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
    const budgetEl=document.getElementById('crmBudget');if(budgetEl)budgetEl.dataset.manual='';
    crmAddItemRow();
  }
  crmSyncDeliveryControls();
  crmOrderDialogInit=false;
  openModal('crmOrderModal');
}
function crmAddItemRow(item={name:'',qty:'1',category:'',price:0,setup:true}){
  if(!crmOrderDialogInit)crmOrderDialogDirty=true;
  const list=document.getElementById('crmItemsList');
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 1fr 60px 24px 60px 24px;gap:6px;margin-bottom:6px;align-items:center';
  const legacy=crmIsLegacyYearOrder();
  const catOpts=crmCategories.map(c=>`<option value="${esc(c)}" ${item.category===c?'selected':''}>${esc(c)}</option>`).join('');
  const stockItems=item.category?crmStock.filter(s=>s.category===item.category):[];
  const itemOpts=stockItems.map(s=>`<option value="${esc(s.name)}" data-price="${legacy?0:s.price}" ${item.name===s.name?'selected':''}>${esc(s.name)}${legacy?'':' — '+s.price+'₽'}</option>`).join('');
  const setupChecked=item.setup!==false?'checked':'';
  row.innerHTML=`<select data-cat style="padding:6px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><option value="">Категория</option>${catOpts}</select><select data-name style="padding:6px 8px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><option value="">Изделие</option>${itemOpts}</select><input type="number" data-qty value="${item.qty||1}" min="1" style="padding:6px;font-size:12px;border:0.5px solid var(--border2);border-radius:var(--radius-sm)"><input type="checkbox" data-setup ${setupChecked} title="Сетап" style="width:18px;height:18px;cursor:pointer;accent-color:var(--blue)"><span data-price style="font-size:11px;color:var(--text2)">${item.price?item.price+'₽':''}</span><span onclick="crmOrderDialogDirty=true;this.parentElement.remove();crmCalcTotal()" style="cursor:pointer;text-align:center;color:var(--red)">✕</span>`;
  const catSel=row.querySelector('[data-cat]'),nameSel=row.querySelector('[data-name]'),priceSpan=row.querySelector('[data-price]'),qtyInp=row.querySelector('[data-qty]');
  catSel.addEventListener('change',()=>{const its=crmStock.filter(s=>s.category===catSel.value);const isLegacy=crmIsLegacyYearOrder();nameSel.innerHTML='<option value="">Изделие</option>'+its.map(s=>`<option value="${esc(s.name)}" data-price="${isLegacy?0:s.price}">${esc(s.name)}${isLegacy?'':' — '+s.price+'₽'}</option>`).join('');priceSpan.textContent='';crmCalcTotal()});
  nameSel.addEventListener('change',()=>{const opt=nameSel.selectedOptions[0];const isLegacy=crmIsLegacyYearOrder();priceSpan.textContent=isLegacy?'':(opt&&opt.dataset.price?opt.dataset.price+'₽':'');crmCalcTotal()});
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
  const deliveryCost=crmCalcDeliveryCost();
  const setupCost=crmCalcSetupCost();
  if(document.getElementById('crmDeliveryCost'))document.getElementById('crmDeliveryCost').value=deliveryCost;
  if(document.getElementById('crmSetupCost'))document.getElementById('crmSetupCost').value=setupCost;
  const budgetEl=document.getElementById('crmBudget');
  if(budgetEl&&budgetEl.dataset.manual!=='1')budgetEl.value=deliveryCost+setupCost;
  const discountPct=Number(document.getElementById('crmDiscount')?.value||0);
  const discountAmt=Math.round(itemsTotal*discountPct/100);
  const total=(itemsTotal-discountAmt)+deliveryCost+setupCost;
  if(document.getElementById('crmItemsTotal'))document.getElementById('crmItemsTotal').value=itemsTotal;
  if(document.getElementById('crmDiscountAmount'))document.getElementById('crmDiscountAmount').value=discountAmt;
  document.getElementById('crmAmount').value=total>0?total:0;
}
function crmGetItems(){
  const items=[];
  document.getElementById('crmItemsList').querySelectorAll('[data-qty]').forEach(q=>{
    const row=q.parentElement;const name=row.querySelector('[data-name]').value;
    const cat=row.querySelector('[data-cat]').value;const opt=row.querySelector('[data-name]').selectedOptions[0];
    if(name)items.push({name,category:cat,qty:q.value||'1',price:Number(opt?.dataset.price||0),setup:row.querySelector('[data-setup]')?.checked!==false});
  });
  return items;
}
async function crmSaveOrder(){
  const id=document.getElementById('crmOrderId').value;
  const paymentStatus=document.getElementById('crmPayment').value;
  const isPaid=crmPaidStatuses.has(paymentStatus);
  if(isPaid)document.getElementById('crmRemaining').value='0';
  const o={clientName:document.getElementById('crmClient').value,clientPhone:document.getElementById('crmPhone').value,companyName:document.getElementById('crmCompany').value,startDate:document.getElementById('crmStartDate').value,endDate:document.getElementById('crmEndDate').value,orderAmount:Number(document.getElementById('crmAmount').value)||0,budgetAmount:Number(document.getElementById('crmBudget').value)||0,depositAmount:Number(document.getElementById('crmDeposit').value)||0,deliveryCost:Number(document.getElementById('crmDeliveryCost').value)||0,setupCost:Number(document.getElementById('crmSetupCost').value)||0,discount:Number(document.getElementById('crmDiscount').value)||0,remainingAmount:isPaid?0:(Number(document.getElementById('crmRemaining').value)||0),status:document.getElementById('crmStatus').value,paymentStatus,deliveryType:document.getElementById('crmDeliveryType').value,deliveryAddress:document.getElementById('crmAddress').value,setupRequired:document.getElementById('crmSetupCost').value>0?'yes':'no',items:crmGetItems(),comment:document.getElementById('crmComment').value,carryFloor:document.getElementById('crmCarryFloor')?.value||'no',depositStatus:document.getElementById('crmDepositStatus')?.value||'pending',compensationAmount:Number(document.getElementById('crmCompensationAmount')?.value||0),compensationNote:document.getElementById('crmCompensationNote')?.value||''};
  if(!o.clientName){showToast('Укажите клиента','error');return}
  if(id){o.id=id;await api('updateOrder',{order:o});const idx=crmOrders.findIndex(x=>x.id===id);if(idx>=0)crmOrders[idx]={...crmOrders[idx],...o};sbBackup('upsertOrder',o);showToast('Обновлено','success')}
  else{const r=await api('addOrder',{order:o});if(r.success){o.id=r.id;crmOrders.push(crmNormalize(o));sbBackup('upsertOrder',o)}showToast('Заказ создан','success')}
  crmOrderDialogDirty=false;closeModal('crmOrderModal',true);crmRenderAll();
}
async function crmDeleteOrder(){
  const id=document.getElementById('crmOrderId').value;if(!id||!confirm('Удалить заказ?'))return;
  await api('deleteOrder',{id});sbBackup('deleteOrder',{id});crmOrders=crmOrders.filter(o=>o.id!==id);
  crmOrderDialogDirty=false;closeModal('crmOrderModal',true);crmRenderAll();showToast('Удалено','success');
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
  // Charts
  const monthly=Array.from({length:12},(_,m)=>({m,rev:0,cnt:0,paidCnt:0}));
  yOrders.forEach(o=>{const m=crmParseDateLocal(o.startDate)?.getMonth();if(m==null)return;monthly[m].cnt++;if(crmPaidStatuses.has(o.paymentStatus)){monthly[m].rev+=o.orderAmount;monthly[m].paidCnt++}});
  const mNames=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const revChart=document.getElementById('crmChartRevenue');
  const ordChart=document.getElementById('crmChartOrders');
  if(window.crmChart1)window.crmChart1.destroy();if(window.crmChart2)window.crmChart2.destroy();if(window.crmChart3)window.crmChart3.destroy();if(window.crmChart4)window.crmChart4.destroy();if(window.crmCmpChart1)window.crmCmpChart1.destroy();if(window.crmCmpChart2)window.crmCmpChart2.destroy();if(window.crmCmpChart3)window.crmCmpChart3.destroy();
  if(revChart){window.crmChart1=new Chart(revChart,{type:'line',data:{labels:mNames,datasets:[{data:monthly.map(m=>m.rev),borderColor:'#3478f6',tension:.3,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  if(ordChart){window.crmChart2=new Chart(ordChart,{type:'bar',data:{labels:mNames,datasets:[{data:monthly.map(m=>m.cnt),backgroundColor:'rgba(42,157,82,0.5)',borderColor:'#2a9d52',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}})}
  const avgChart=document.getElementById('crmChartAvg');
  const avgData=monthly.map(m=>m.paidCnt?Math.round(m.rev/m.paidCnt):0);
  if(avgChart){window.crmChart3=new Chart(avgChart,{type:'line',data:{labels:mNames,datasets:[{data:avgData,borderColor:'#8944d6',tension:.3,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  const idxChart=document.getElementById('crmChartIndex');
  const maxRev=Math.max(...monthly.map(m=>m.rev),1);const maxCnt=Math.max(...monthly.map(m=>m.cnt),1);const maxAvg=Math.max(...avgData,1);
  const indexData=monthly.map((m,i)=>{const r=m.rev/maxRev*100;const c=m.cnt/maxCnt*100;const a=avgData[i]/maxAvg*100;return Math.round((r+c+a)/3)});
  if(idxChart){window.crmChart4=new Chart(idxChart,{type:'bar',data:{labels:mNames,datasets:[{data:indexData,backgroundColor:indexData.map((v,i)=>{const mx=Math.max(...indexData);return v===mx?'rgba(42,157,82,0.7)':'rgba(52,120,246,0.4)'}),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{max:100,ticks:{callback:v=>v+'%'}}}}})}
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
    return{year:y,count:list.length,paidCount:paid.length,rev,avg};
  });
  const yl=byYear.map(x=>String(x.year));
  const rc=document.getElementById('crmCompareRevenue');
  const oc=document.getElementById('crmCompareOrders');
  const ac=document.getElementById('crmCompareAvg');
  if(rc){window.crmCmpChart1=new Chart(rc,{type:'bar',data:{labels:yl,datasets:[{data:byYear.map(x=>x.rev),backgroundColor:'rgba(52,120,246,0.45)',borderColor:'#3478f6',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  if(oc){window.crmCmpChart2=new Chart(oc,{type:'bar',data:{labels:yl,datasets:[{data:byYear.map(x=>x.count),backgroundColor:'rgba(42,157,82,0.45)',borderColor:'#2a9d52',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}})}
  if(ac){window.crmCmpChart3=new Chart(ac,{type:'line',data:{labels:yl,datasets:[{data:byYear.map(x=>x.avg),borderColor:'#8944d6',tension:.25,pointRadius:3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>fN(v)+'₽'}}}}})}
  const tt=document.getElementById('crmCompareTable');
  if(tt){
    if(!byYear.length){tt.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">Нет данных</td></tr>'}
    else{
      tt.innerHTML=byYear.map((x,i)=>{const p=byYear[i-1];const d=p&&p.rev>0?Math.round(((x.rev-p.rev)/p.rev)*100):null;return`<tr><td>${x.year}</td><td>${x.count}</td><td>${x.paidCount}</td><td class="mono">${fN(x.rev)}₽</td><td class="mono">${x.avg?fN(x.avg)+'₽':'—'}</td><td class="mono" style="color:${d==null?'var(--text3)':d>=0?'var(--green)':'var(--red)'}">${d==null?'—':(d>0?'+':'')+d+'%'}</td></tr>`}).join('');
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
document.getElementById('crmStockSearch')?.addEventListener('input',()=>crmRenderStock());
document.getElementById('crmYearFilter')?.addEventListener('change',e=>{crmYearFilter=Number(e.target.value)||0;crmRenderOrders()});
document.getElementById('crmStartDate')?.addEventListener('change',crmHandleStartDateChange);
document.getElementById('crmEndDate')?.addEventListener('change',()=>{crmSyncDateRange(true)});
window.canCloseModal=(id)=>id==='crmOrderModal'?crmCanCloseOrderDialog():true;
// Init CRM on page switch
const origSwitchPage=switchPage;
switchPage=function(p){origSwitchPage(p);if(p==='crm'||p==='crmstock'||p==='crmdash'){if(!crmOrders.length&&!crmStock.length)crmInit();else crmRenderAll()}}
