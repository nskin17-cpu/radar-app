// Автономные представления используют последнюю копию заказов, сохранённую RadarStore.
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const links = [...document.querySelectorAll('nav a')];
  const search = el('orderSearch');
  const month = el('orderMonth');
  const result = el('orderResults');
  const status = el('orderStatus');
  const board = RadarWarehouse;
  const labels = {orders:'Заказы', assembly:'Выдача заказов', files:'Файлы'};
  const stages = {preparing:'Подготовка', assembly:'Сборка', in_progress:'В работе', completed:'Выполнен'};
  let orders = [], view = '', userName = '', expires;
  const months = {orders:'', assembly:board.currentMonthKey()};

  function node(tag, text) {
    const elem = document.createElement(tag);
    elem.textContent = text;
    return elem;
  }
  function date(value) {
    const parts = String(value || '').slice(0, 10).split('-');
    return parts.length === 3 ? parts.reverse().join('.') : '—';
  }
  function card(order) {
    const details = document.createElement('details');
    const title = (order.orderNumber || order.id) + ' · ' + (order.clientName || 'Без заказчика');
    details.append(node('summary', title + ' · ' + date(order.startDate)));
    details.append(node('p', 'Выдача ' + date(order.startDate) + ' · Возврат ' + date(order.endDate)));
    const delivery = board.deliveryOf(order);
    details.append(node('p', [delivery.label, delivery.address].filter(Boolean).join(' · ')));
    const wh = board.whGet(order);
    if (view === 'orders') {
      details.append(node('p', [stages[order.status] || order.status, order.clientPhone,
        Number(order.orderAmount || 0).toLocaleString('ru-RU') + ' ₽'].filter(Boolean).join(' · ')));
    }
    details.append(node('strong', 'Состав заказа'));
    const items = document.createElement('ul');
    for (const [i, item] of (order.items || []).entries()) {
      const check = view === 'assembly' && wh.checklist[i] ? '✓ ' : '';
      items.append(node('li', check + (item.name || item.documentName || item.category || 'Изделие') + ' × ' + item.qty));
    }
    details.append(items.children.length ? items : node('p', 'Состав не заполнен'));
    if (view === 'orders' && order.comment) details.append(node('p', order.comment));
    return details;
  }
  function draw() {
    result.replaceChildren();
    result.classList.toggle('board', view === 'assembly');
    if (view === 'assembly') {
      const groups = board.buildColumns(orders, month.value, search.value);
      for (const column of board.columns) {
        const list = groups[column.key];
        const section = document.createElement('section');
        section.append(node('h2', column.title + ' · ' + list.length));
        for (const order of list) section.append(card(order));
        result.append(section);
      }
    } else {
      const query = search.value.trim().toLowerCase();
      const filtered = orders.filter(order => (!month.value || order.startDate?.startsWith(month.value)) &&
        [order.orderNumber, order.id, order.clientName].join(' ').toLowerCase().includes(query));
      filtered.sort((a,b) => String(a.startDate).localeCompare(String(b.startDate)));
      for (const order of filtered) result.append(card(order));
      if (!filtered.length) result.append(node('p', 'Нет заказов'));
    }
  }
  function render() {
    clearTimeout(expires);
    const user = RadarConfig.readSession();
    const allowed = area => user && (user.role === 'admin' || !user.perms || ['view','edit'].includes(user.perms[area]));
    const sections = ['orders','assembly'].filter(allowed);
    if (sections.length) sections.push('files');
    const notification = new URLSearchParams(location.search).get('nl');
    const requested = location.hash.slice(1) || (notification === 'page:warehouse' ? 'assembly' : 'orders');
    const next = sections.includes(requested) ? requested : sections[0];
    if (view !== next || userName !== user?.username) search.value = '';
    view = next;
    userName = user?.username;
    for (const link of links) {
      link.hidden = !sections.includes(link.hash.slice(1));
      if (link.hash === '#' + view) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    orders = [];
    result.replaceChildren();
    el('offlineTitle').textContent = labels[view] || 'Просмотр без связи';
    el('offlineFiles').hidden = view !== 'files';
    el('offlineOrders').hidden = view === 'files';
    el('orderFilters').hidden = true;
    if (!view) {
      status.textContent = 'Для просмотра нужен действующий вход в Radar с доступом к разделу.';
      return;
    }
    const session = JSON.parse(localStorage.getItem(RadarConfig.cache.sessionKey));
    expires = setTimeout(render, Math.max(50, session.at + RadarConfig.sessionTTL - Date.now() + 1));
    if (view === 'files') return;
    let snapshot;
    try { snapshot = JSON.parse(localStorage.getItem(RadarConfig.cache.ordersKey)); } catch (error) {}
    if (!snapshot || snapshot.owner !== user.username || !Array.isArray(snapshot.orders)) {
      status.textContent = 'На устройстве пока нет сохранённых заказов. Откройте этот раздел при подключении к интернету.';
      return;
    }
    orders = snapshot.orders;
    status.textContent = snapshot.at ? 'Только просмотр · Данные с сервера на ' + new Date(snapshot.at).toLocaleString('ru-RU') :
      'Только просмотр · На устройстве сохранены отдельные заказы';
    const options = new Set(orders.map(o => o.startDate?.slice(0,7)).filter(Boolean));
    options.add(board.currentMonthKey());
    const selected = months[view];
    month.replaceChildren();
    if (view === 'orders') month.add(new Option('Все месяцы', ''));
    for (const key of [...options].sort()) month.add(new Option(board.monthLabel(key), key));
    month.value = options.has(selected) ? selected : view === 'assembly' ? board.currentMonthKey() : '';
    el('orderFilters').hidden = false;
    draw();
  }
  month.onchange = () => { months[view] = month.value; draw(); };
  search.oninput = draw;
  window.addEventListener('pageshow', render);
  window.addEventListener('hashchange', render);
  window.addEventListener('storage', event => {
    if (!event.key || [RadarConfig.cache.sessionKey, RadarConfig.cache.ordersKey].includes(event.key)) render();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
})();
