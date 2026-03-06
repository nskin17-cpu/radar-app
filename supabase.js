/**
 * Supabase: конфиг и миграция данных из Google Таблиц.
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
      remaining_amount: Number(o.remainingAmount || o.remaining_amount || 0),
      status: o.status || 'preparing',
      payment_status: o.paymentStatus || o.payment_status || 'pending_confirmation',
      delivery_type: o.deliveryType || o.delivery_type || 'pickup',
      delivery_address: o.deliveryAddress || o.delivery_address || null,
      setup_required: o.setupRequired || o.setup_required || 'no',
      items: items,
      comment: o.comment || null
    };
  }

  function mapStockRow(s) {
    return {
      name: s.name || '',
      category: s.category || '',
      price: Number(s.price || 0),
      qty: Number(s.qty || 0),
      unit: s.unit || 'шт'
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

    var results = { competitors: 0, myCompany: false, history: 0, orders: 0, stock: 0, pricing: 0 };

    try {
      // Конкуренты
      var compRes = await apiFn('getCompetitors');
      if (compRes && compRes.success) {
        var entries = compRes.entries || compRes.competitors || [];
        for (var i = 0; i < entries.length; i++) {
          var row = mapCompetitorOrCompanyRow(entries[i]);
          if (row && row.id) {
            await supabase.from('competitors').upsert(row, { onConflict: 'id' });
            results.competitors++;
          }
        }
      }

      // Моя компания
      var myRes = await apiFn('getMyCompany');
      if (myRes && myRes.success && myRes.company) {
        var myRow = mapCompetitorOrCompanyRow(myRes.company);
        if (myRow) {
          myRow.id = 'MY';
          await supabase.from('my_company').upsert(myRow, { onConflict: 'id' });
          results.myCompany = true;
        }
      }

      // История
      var histRes = await apiFn('getHistory');
      if (histRes && histRes.success && Array.isArray(histRes.history)) {
        for (var j = 0; j < histRes.history.length; j++) {
          var hRow = mapHistoryRow(histRes.history[j]);
          await supabase.from('history').insert(hRow);
          results.history++;
        }
      }

      // Заказы
      var ordRes = await apiFn('getOrders');
      if (ordRes && ordRes.success && Array.isArray(ordRes.orders)) {
        for (var k = 0; k < ordRes.orders.length; k++) {
          var oRow = mapOrderRow(ordRes.orders[k]);
          if (oRow.id) {
            await supabase.from('orders').upsert(oRow, { onConflict: 'id' });
            results.orders++;
          }
        }
      }

      // Склад (при повторном запуске строки добавятся ещё раз; при необходимости очистите таблицу stock в SQL)
      var stockRes = await apiFn('getStock');
      if (stockRes && stockRes.success && Array.isArray(stockRes.stock)) {
        for (var s = 0; s < stockRes.stock.length; s++) {
          var stRow = mapStockRow(stockRes.stock[s]);
          await supabase.from('stock').insert(stRow);
          results.stock++;
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
              await supabase.from('pricing_config').upsert({ key: key, value: Number(config[key]) || 0 }, { onConflict: 'key' });
              results.pricing++;
            }
          }
        }
      }

      return { success: true, results: results };
    } catch (err) {
      return { success: false, error: err.message, results: results };
    }
  }

  if (typeof window !== 'undefined') {
    window.getSupabase = getSupabase;
    window.migrateGoogleToSupabase = migrateGoogleToSupabase;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getSupabase: getSupabase, migrateGoogleToSupabase: migrateGoogleToSupabase };
  }
})();
