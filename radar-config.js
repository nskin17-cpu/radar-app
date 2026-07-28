/**
 * Radar NR — конфигурация источников данных.
 *
 * Единственное место, где включается/выключается Google Sheets.
 * Меняете флаг -> меняется поведение всего приложения. Код интеграции не удаляется.
 *
 * Значения можно переопределить из localStorage (ключ radar.config.v1),
 * чтобы переключаться без правки файла — см. RadarConfig.set().
 */
(function () {
  'use strict';

  var DEFAULTS = {
    // Основной источник данных: 'supabase' | 'google'
    // 'supabase' — читаем и пишем только в Supabase (текущий режим).
    // 'google'   — старое поведение: Google Sheets основной, Supabase дублирует.
    dataSource: 'supabase',

    googleSheets: {
      // Полностью выключает обращения к Google Apps Script для данных
      // (заказы, клиенты, склад, категории, цены).
      enabled: false,
      // Зеркалировать записи в Sheets параллельно с Supabase.
      // Включается вместе с enabled, когда захотите вернуть синхронизацию.
      mirrorWrites: false,
      // Авторизация и AI-прокси всегда идут через Apps Script:
      // в Supabase таблица users пустая, своего бэкенда нет.
      // Выключение выше на эти два действия не влияет.
      allowedActionsWhenDisabled: ['login', 'aiAnalysis']
    },

    autosave: {
      enabled: true,
      // Пауза после последнего нажатия клавиши перед отправкой, мс.
      debounceMs: 900,
      // Через сколько повторять неудачную отправку (экспоненциально), мс.
      retryBaseMs: 2000,
      retryMaxMs: 60000
    },

    outbox: {
      storageKey: 'radar.outbox.v1',
      // Сколько операций держим в очереди максимум (защита от переполнения localStorage).
      maxOps: 500
    },

    cache: {
      ordersKey: 'radar.cache.orders.v1',
      clientsKey: 'radar.cache.clients.v1',
      stockKey: 'radar.cache.stock.v1',
      categoriesKey: 'radar.cache.categories.v1',
      pricingKey: 'radar.cache.pricing.v1',
      draftKey: 'radar.draft.order.v1',
      sessionKey: 'radar.session.v1'
    },

    documents: {
      // 'pdfmake' — векторный PDF, одинаковый на всех устройствах (по умолчанию).
      // 'legacy'  — старый растровый рендер html2canvas + jsPDF (запасной вариант).
      engine: 'pdfmake'
    }
  };

  function deepMerge(base, extra) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      var b = base[k];
      var e = extra ? extra[k] : undefined;
      if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = deepMerge(b, e && typeof e === 'object' ? e : {});
      else out[k] = e !== undefined ? e : b;
    });
    if (extra) Object.keys(extra).forEach(function (k) { if (!(k in out)) out[k] = extra[k]; });
    return out;
  }

  var override = {};
  try {
    var raw = localStorage.getItem('radar.config.v1');
    if (raw) override = JSON.parse(raw) || {};
  } catch (e) { override = {}; }

  var cfg = deepMerge(DEFAULTS, override);

  cfg.isGoogleEnabled = function () {
    return !!(cfg.googleSheets && cfg.googleSheets.enabled);
  };
  cfg.isGoogleActionAllowed = function (action) {
    if (cfg.isGoogleEnabled()) return true;
    return (cfg.googleSheets.allowedActionsWhenDisabled || []).indexOf(action) !== -1;
  };
  cfg.isSupabasePrimary = function () {
    return cfg.dataSource === 'supabase';
  };
  /** Сохранить переопределение в localStorage (переживает перезагрузку). */
  cfg.set = function (patch) {
    var next = deepMerge(override, patch || {});
    localStorage.setItem('radar.config.v1', JSON.stringify(next));
    return next;
  };
  cfg.reset = function () {
    localStorage.removeItem('radar.config.v1');
  };

  window.RadarConfig = cfg;
})();
