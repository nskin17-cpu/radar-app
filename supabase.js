/**
 * Supabase: конфиг, миграция данных из Google Таблиц, дублирование записей.
 * Подключение: задайте window.SUPABASE_URL и window.SUPABASE_ANON_KEY перед загрузкой скрипта
 * или передайте в migrateGoogleToSupabase({ url, anonKey }).
 */
(function () {
  'use strict';

  function getSupabase(opts) {
    var url = (opts && opts.url) || (typeof window !== 'undefined' && window.SUPABASE_URL);
    var key = (opts && opts.anonKey) || (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY);
    if (!url || !key) return null;
    if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient)
      return window.supabase.createClient(url, key);
    return null;
  }

  function toSnake(str) {
    return String(str).replace(/[A-Z]/g, function (c) { return '_' + c.toLowerCase(); });
  }

  function mapCompetitorOrCompanyRow(row) {
    if (!row) return null;
    var str = ['name', 'city', 'website', 'instagram', 'phone', 'notes'];
    var num = ['nepal', 'loren', 'modern', 'plasticChair', 'woodChair', 'metalChair', 'plateSnack', 'plateDinner', 'plateSub', 'glassWine', 'glassFlute', 'glassMartini', 'glassRocks', 'cutlerySet', 'delivery', 'deliveryKm', 'setupPlates', 'setupGlasses', 'setupCutlery', 'setupMetalChair', 'setupPlasticChair', 'setupCushionChair', 'proDiscount'];
    var out = { id: row.id || 'MY' };
    str.forEach(function (k) { out[k] = row[k] != null ? row[k] : null; });
    num.forEach(function (k) {
      var col = toSnake(k);
      out[col] = row[k] != null && row[k] !== '' ? Number(row[k]) : 0;
    });
    return out;
  }

  function mapHistoryRow(h) {
    return {
      month: h.month || '',
      company_id: h.companyId || h.company_id || '',
      company_name: h.companyName || h.company_name || null,
      nepal: h.nepal != null ? Number(h.nepal) : null,
      loren: h.loren != null ? Number(h.loren) : null,
      modern: h.modern != null ? Number(h.modern) : null
    };
  }

  function mapOrderRow(o) {
    var items = o.items;
    if (typeof items === 'string') try { items = JSON.parse(items); } catch (e) { items = []; }
    if (!Array.isArray(items)) items = [];
    return {
      id: o.id || '',
      client_name: o.clientName || o.client_name || '',
      client_phone: o.clientPhone || o.client_phone || null,
      company_name: o.companyName || o.company_name || null,
      start_date: o.startDate || o.start_date || null,
      end_date: o.endDate || o.end_date || null,
      order_amount: Number(o.orderAmount || o.order_amount || 0),
      budget_amount: Number(o.budgetAmount || o.budget_amount || 0),
      deposit_amount: Number(o.depositAmount || o.deposit_amount || 0),
      delivery_cost: Number(o.deliveryCost || o.delivery_cost || 0),
      setup_cost: Number(o.setupCost || o.setup_cost || 0),
      discount: Number(o.discount || 0),
      paid_amount: Number(o.paidAmount || o.paid_amount || 0),
      remaining_amount: Number(o.remainingAmount || o.remaining_amount || 0),
      status: o.status || 'preparing',
      payment_status: o.paymentStatus || o.payment_status || 'pending_confirmation',
      delivery_type: o.deliveryType || o.delivery_type || 'pickup',
      delivery_address: o.deliveryAddress || o.delivery_address || null,
      setup_required: o.setupRequired || o.setup_required || 'no',
      carry_floor: o.carryFloor || o.carry_floor || 'no',
      deposit_status: o.depositStatus || o.deposit_status || 'pending',
      compensation_amount: Number(o.compensationAmount || o.compensation_amount || 0),
      compensation_note: o.compensationNote || o.compensation_note || null,
      items: items,
      comment: o.comment || null
    };
  }

  function mapStockRow(s) {
    return {
      name: s.name || '',
      category: s.category || '',
      price: Number(s.price || 0),
      setup_rate: Number(s.setupRate || s.setup_rate || 0),
      qty: Number(s.qty || 0),
      unit: s.unit || 'шт'
    };
  }
  function mapCategoryRow(c) {
    return {
      id: c.id || '',
      name: c.name || '',
      setup_rate: Number(c.setupRate || c.setup_rate || 0)
    };
  }
  function mapClientRow(c) {
    return {
      id: c.id || '',
      name: c.name || c.clientName || '',
      company: c.company || c.companyName || null,
      phone: c.phone || c.clientPhone || null,
      pro_discount: Number(c.proDiscount || c.pro_discount || 0),
      total_orders: Number(c.totalOrders || c.total_orders || 0),
      total_turnover: Number(c.totalTurnover || c.total_turnover || 0),
      total_revenue: Number(c.totalRevenue || c.total_revenue || 0)
    };
  }

  /**
   * Переносит все данные из Google Таблиц (через текущий api) в Supabase.
   * apiFn — функция вида function(action, data) { return fetch(...).then(r=>r.json()) }
   * supabaseOpts — { url, anonKey } или не передавать (берутся из window).
   * Возвращает Promise<{ success: boolean, results: {}, error?: string }>
   */
  async function migrateGoogleToSupabase(apiFn, supabaseOpts) {
    var supabase = getSupabase(supabaseOpts);
    if (!supabase) return { success: false, error: 'Задайте SUPABASE_URL и SUPABASE_ANON_KEY' };
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };

    var results = { competitors: 0, myCompany: false, history: 0, orders: 0, stock: 0, clients: 0, categories: 0, pricing: 0 };

    try {
      // Конкуренты
      var compRes = await apiFn('getCompetitors');
      if (compRes && compRes.success) {
        var entries = compRes.entries || compRes.competitors || [];
        for (var i = 0; i < entries.length; i++) {
          var row = mapCompetitorOrCompanyRow(entries[i]);
          if (row && row.id) {
            var cr = await supabase.from('competitors').upsert(row, { onConflict: 'id' });
            if (cr.error) console.warn('[migration] competitor upsert error:', cr.error.message);
            else results.competitors++;
          }
        }
      }

      // Моя компания
      var myRes = await apiFn('getMyCompany');
      if (myRes && myRes.success && myRes.company) {
        var myRow = mapCompetitorOrCompanyRow(myRes.company);
        if (myRow) {
          myRow.id = 'MY';
          var mr = await supabase.from('my_company').upsert(myRow, { onConflict: 'id' });
          if (mr.error) console.warn('[migration] my_company upsert error:', mr.error.message);
          else results.myCompany = true;
        }
      }

      // История — upsert по (month, company_id), требует UNIQUE(month, company_id) в схеме
      var histRes = await apiFn('getHistory');
      if (histRes && histRes.success && Array.isArray(histRes.history)) {
        for (var j = 0; j < histRes.history.length; j++) {
          var hRow = mapHistoryRow(histRes.history[j]);
          var hr = await supabase.from('history').upsert(hRow, { onConflict: 'month,company_id' });
          if (hr.error) console.warn('[migration] history upsert error:', hr.error.message);
          else results.history++;
        }
      }

      // Заказы
      var ordRes = await apiFn('getOrders');
      if (ordRes && ordRes.success && Array.isArray(ordRes.orders)) {
        for (var k = 0; k < ordRes.orders.length; k++) {
          var oRow = mapOrderRow(ordRes.orders[k]);
          if (oRow.id) {
            var or = await supabase.from('orders').upsert(oRow, { onConflict: 'id' });
            if (or.error) console.warn('[migration] order upsert error:', or.error.message);
            else results.orders++;
          }
        }
      }

      // Склад — upsert по (name, category), требует UNIQUE(name, category) в схеме
      var stockRes = await apiFn('getStock');
      if (stockRes && stockRes.success && Array.isArray(stockRes.stock)) {
        for (var s = 0; s < stockRes.stock.length; s++) {
          var stRow = mapStockRow(stockRes.stock[s]);
          var sr = await supabase.from('stock').upsert(stRow, { onConflict: 'name,category' });
          if (sr.error) console.warn('[migration] stock upsert error:', sr.error.message);
          else results.stock++;
        }
      }

      // Клиенты
      var clientsRes = await apiFn('getClients');
      if (clientsRes && clientsRes.success && Array.isArray(clientsRes.clients)) {
        for (var c = 0; c < clientsRes.clients.length; c++) {
          var clRow = mapClientRow(clientsRes.clients[c]);
          if (clRow.id) {
            var clr = await supabase.from('clients').upsert(clRow, { onConflict: 'id' });
            if (clr.error) console.warn('[migration] clients upsert error:', clr.error.message);
            else results.clients++;
          }
        }
      }

      // Категории
      var categoriesRes = await apiFn('getCategories');
      if (categoriesRes && categoriesRes.success && Array.isArray(categoriesRes.categories)) {
        for (var g = 0; g < categoriesRes.categories.length; g++) {
          var catRow = mapCategoryRow(categoriesRes.categories[g]);
          if (catRow.id) {
            var cgr = await supabase.from('categories').upsert(catRow, { onConflict: 'id' });
            if (cgr.error) console.warn('[migration] categories upsert error:', cgr.error.message);
            else results.categories++;
          }
        }
      }

      // Pricing config
      var priceRes = await apiFn('getPricingConfig');
      if (priceRes && priceRes.success) {
        var config = (priceRes.config && typeof priceRes.config === 'object') ? priceRes.config : null;
        if (!config && Array.isArray(priceRes.rows)) {
          config = {};
          priceRes.rows.forEach(function (r) {
            var key = r && (r.key || r.name || r.param);
            if (key != null) config[key] = r.value ?? r.val ?? r.amount ?? 0;
          });
        }
        if (config && typeof config === 'object') {
          for (var key in config) {
            if (config.hasOwnProperty(key)) {
              var pr = await supabase.from('pricing_config').upsert({ key: key, value: Number(config[key]) || 0 }, { onConflict: 'key' });
              if (pr.error) console.warn('[migration] pricing upsert error:', pr.error.message);
              else results.pricing++;
            }
          }
        }
      }

      return { success: true, results: results };
    } catch (err) {
      return { success: false, error: err.message, results: results };
    }
  }

  async function pruneDeletedOrdersFromSupabase(apiFn, supabaseOpts) {
    var supabase = getSupabase(supabaseOpts);
    if (!supabase) return { success: false, error: 'Задайте SUPABASE_URL и SUPABASE_ANON_KEY' };
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };

    try {
      var ordRes = await apiFn('getOrders');
      if (!ordRes || !ordRes.success || !Array.isArray(ordRes.orders)) {
        return { success: false, error: 'Не удалось получить заказы из Google' };
      }

      var googleIds = new Set(
        ordRes.orders
          .map(function (o) { return o && o.id ? String(o.id) : ''; })
          .filter(Boolean)
      );

      var from = 0;
      var pageSize = 1000;
      var deleted = 0;
      while (true) {
        var res = await supabase
          .from('orders')
          .select('id')
          .range(from, from + pageSize - 1);
        if (res.error) return { success: false, error: res.error.message };
        var rows = Array.isArray(res.data) ? res.data : [];
        if (!rows.length) break;

        for (var i = 0; i < rows.length; i++) {
          var id = rows[i] && rows[i].id ? String(rows[i].id) : '';
          if (id && !googleIds.has(id)) {
            var delRes = await supabase.from('orders').delete().eq('id', id);
            if (delRes.error) console.warn('[prune] delete order:', delRes.error.message);
            else deleted++;
          }
        }

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      return { success: true, deleted: deleted };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function pruneDeletedClientsFromSupabase(apiFn, supabaseOpts) {
    var supabase = getSupabase(supabaseOpts);
    if (!supabase) return { success: false, error: 'Задайте SUPABASE_URL и SUPABASE_ANON_KEY' };
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };

    try {
      var clientsRes = await apiFn('getClients');
      if (!clientsRes || !clientsRes.success || !Array.isArray(clientsRes.clients)) {
        return { success: false, error: 'Не удалось получить клиентов из Google' };
      }

      var googleIds = new Set(
        clientsRes.clients
          .map(function (c) { return c && c.id ? String(c.id) : ''; })
          .filter(Boolean)
      );

      var from = 0;
      var pageSize = 1000;
      var deleted = 0;
      while (true) {
        var res = await supabase
          .from('clients')
          .select('id')
          .range(from, from + pageSize - 1);
        if (res.error) return { success: false, error: res.error.message };
        var rows = Array.isArray(res.data) ? res.data : [];
        if (!rows.length) break;

        for (var i = 0; i < rows.length; i++) {
          var id = rows[i] && rows[i].id ? String(rows[i].id) : '';
          if (id && !googleIds.has(id)) {
            var delRes = await supabase.from('clients').delete().eq('id', id);
            if (delRes.error) console.warn('[prune] delete client:', delRes.error.message);
            else deleted++;
          }
        }

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      return { success: true, deleted: deleted };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function pruneDeletedStockFromSupabase(apiFn, supabaseOpts) {
    var supabase = getSupabase(supabaseOpts);
    if (!supabase) return { success: false, error: 'Задайте SUPABASE_URL и SUPABASE_ANON_KEY' };
    if (typeof apiFn !== 'function') return { success: false, error: 'Нужна функция api(action, data)' };

    try {
      var stockRes = await apiFn('getStock');
      if (!stockRes || !stockRes.success || !Array.isArray(stockRes.stock)) {
        return { success: false, error: 'Не удалось получить склад из Google' };
      }

      var googlePairs = {};
      stockRes.stock.forEach(function (s) {
        var key = String(s.category || '') + '||' + String(s.name || '');
        if (s && s.name) googlePairs[key] = true;
      });

      var from = 0;
      var pageSize = 1000;
      var deleted = 0;
      while (true) {
        var res = await supabase
          .from('stock')
          .select('name,category')
          .range(from, from + pageSize - 1);
        if (res.error) return { success: false, error: res.error.message };
        var rows = Array.isArray(res.data) ? res.data : [];
        if (!rows.length) break;

        for (var i = 0; i < rows.length; i++) {
          var name = rows[i] && rows[i].name ? String(rows[i].name) : '';
          var category = rows[i] && rows[i].category ? String(rows[i].category) : '';
          var key = category + '||' + name;
          if (name && !googlePairs[key]) {
            var delRes = await supabase.from('stock').delete().eq('name', name).eq('category', category);
            if (delRes.error) console.warn('[prune] delete stock:', delRes.error.message);
            else deleted++;
          }
        }

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      return { success: true, deleted: deleted };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Дублирование отдельных записей в Supabase (вызывается из основного приложения).
   * Используется для двойного хранения данных: Google Sheets (основное) + Supabase (резервное).
   * Тихо игнорирует ошибки — если Supabase недоступен, основное хранилище (GS) не затрагивается.
   *
   * action: 'upsertCompetitors' | 'deleteCompetitor' | 'upsertMyCompany' | 'upsertOrder' | 'deleteOrder' | 'upsertClient' | 'deleteClient' | 'upsertCategory' | 'deleteCategory' | 'upsertPricingConfig'
   * payload: данные в camelCase формате (как в основном приложении)
   */
  async function supabaseWrite(action, payload) {
    var sb = getSupabase();
    if (!sb) return; // Supabase не настроен — пропускаем без ошибки

    try {
      if (action === 'upsertCompetitors') {
        if (!Array.isArray(payload)) return;
        for (var i = 0; i < payload.length; i++) {
          var row = mapCompetitorOrCompanyRow(payload[i]);
          if (row && row.id) {
            var res = await sb.from('competitors').upsert(row, { onConflict: 'id' });
            if (res.error) console.warn('[backup] competitor:', res.error.message);
          }
        }
      } else if (action === 'deleteCompetitor') {
        if (payload && payload.id) {
          var res = await sb.from('competitors').delete().eq('id', payload.id);
          if (res.error) console.warn('[backup] deleteCompetitor:', res.error.message);
        }
      } else if (action === 'upsertMyCompany') {
        var myRow = mapCompetitorOrCompanyRow(payload);
        if (myRow) {
          myRow.id = 'MY';
          var res = await sb.from('my_company').upsert(myRow, { onConflict: 'id' });
          if (res.error) console.warn('[backup] my_company:', res.error.message);
        }
      } else if (action === 'upsertOrder') {
        var oRow = mapOrderRow(payload);
        if (oRow && oRow.id) {
          var res = await sb.from('orders').upsert(oRow, { onConflict: 'id' });
          if (res.error) console.warn('[backup] order:', res.error.message);
        }
      } else if (action === 'deleteOrder') {
        if (payload && payload.id) {
          var res = await sb.from('orders').delete().eq('id', payload.id);
          if (res.error) console.warn('[backup] deleteOrder:', res.error.message);
        }
      } else if (action === 'upsertStockItem') {
        var stRow = mapStockRow(payload);
        if (stRow && stRow.name) {
          var res = await sb.from('stock').upsert(stRow, { onConflict: 'name,category' });
          if (res.error) console.warn('[backup] upsertStockItem:', res.error.message);
        }
      } else if (action === 'deleteStockItem') {
        if (payload && payload.name) {
          var res = await sb.from('stock').delete().eq('name', payload.name).eq('category', payload.category || '');
          if (res.error) console.warn('[backup] deleteStockItem:', res.error.message);
        }
      } else if (action === 'upsertClient') {
        var cRow = mapClientRow(payload);
        if (cRow && cRow.id) {
          var res = await sb.from('clients').upsert(cRow, { onConflict: 'id' });
          if (res.error) console.warn('[backup] upsertClient:', res.error.message);
        }
      } else if (action === 'deleteClient') {
        if (payload && payload.id) {
          var res = await sb.from('clients').delete().eq('id', payload.id);
          if (res.error) console.warn('[backup] deleteClient:', res.error.message);
        }
      } else if (action === 'upsertCategory') {
        var catRow = mapCategoryRow(payload);
        if (catRow && catRow.id) {
          var res = await sb.from('categories').upsert(catRow, { onConflict: 'id' });
          if (res.error) console.warn('[backup] upsertCategory:', res.error.message);
        }
      } else if (action === 'deleteCategory') {
        if (payload && payload.id) {
          var res = await sb.from('categories').delete().eq('id', payload.id);
          if (res.error) console.warn('[backup] deleteCategory:', res.error.message);
        }
      } else if (action === 'upsertPricingConfig') {
        if (payload && payload.key) {
          var res = await sb.from('pricing_config').upsert({ key: payload.key, value: Number(payload.value) || 0 }, { onConflict: 'key' });
          if (res.error) console.warn('[backup] upsertPricingConfig:', res.error.message);
        }
      }
    } catch (e) {
      console.warn('[Supabase backup]', action, e.message);
    }
  }

  if (typeof window !== 'undefined') {
    window.getSupabase = getSupabase;
    window.migrateGoogleToSupabase = migrateGoogleToSupabase;
    window.pruneDeletedOrdersFromSupabase = pruneDeletedOrdersFromSupabase;
    window.pruneDeletedClientsFromSupabase = pruneDeletedClientsFromSupabase;
    window.pruneDeletedStockFromSupabase = pruneDeletedStockFromSupabase;
    window.supabaseWrite = supabaseWrite;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getSupabase: getSupabase,
      migrateGoogleToSupabase: migrateGoogleToSupabase,
      pruneDeletedOrdersFromSupabase: pruneDeletedOrdersFromSupabase,
      pruneDeletedClientsFromSupabase: pruneDeletedClientsFromSupabase,
      pruneDeletedStockFromSupabase: pruneDeletedStockFromSupabase,
      supabaseWrite: supabaseWrite
    };
  }
})();
