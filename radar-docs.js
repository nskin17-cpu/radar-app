/**
 * Radar NR — генерация смет и актов (pdfmake).
 *
 * Почему pdfmake, а не прежний html2canvas + jsPDF:
 *  • html2canvas снимал «фотографию» DOM — результат зависел от шрифтов устройства,
 *    масштаба и devicePixelRatio, поэтому в коде жили костыли вроде transform:scale(0.9)
 *    для мобильных и по два размера шрифта на каждый элемент;
 *  • разбивка на страницы считалась вручную (itemRowH=48, headerMetaH=310…) — длинное
 *    название позиции переносилось на вторую строку, и блок уезжал за край листа;
 *  • на выходе был растр: текст нельзя выделить и найти, файл весил мегабайты.
 *
 * pdfmake строит настоящий вектор: разметку считает сама библиотека, одинаково в Safari
 * на iPhone, в Chrome на Windows и в macOS. Таблицы переносятся автоматически, шапка
 * повторяется на каждой странице, итоговый блок не рвётся пополам.
 *
 * Лицензия MIT, проект живой, кириллица и ₽ есть в штатном шрифте Roboto —
 * дополнительные файлы шрифтов не нужны.
 */
(function () {
  'use strict';

  var INK = '#1a1a1a';
  var MUTED = '#8a8a8a';
  var LINE = '#e6e6e6';
  var ACCENT = '#3478f6';

  var COMPANY = {
    name: 'NANDRENT',
    tagline: 'Аренда посуды и мебели',
    phone: '+7 (966) 866-86-66',
    card: '+7 (906) 060-40-60',
    cardOwner: 'Андрей Г. · Альфа-Банк',
    termsUrl: 'https://nandrent.ru/uslovia',
    termsLabel: 'nandrent.ru/uslovia'
  };

  function n(v) { return Math.round(Number(v) || 0).toLocaleString('ru-RU'); }
  function money(v) { return n(v) + ' ₽'; }
  function cleanName(name) {
    return String(name || '').replace(/\s*[—-]\s*\d[\d\s]*\s*₽\s*$/, '').trim();
  }
  function displayName(item) {
    return cleanName(item && item.name) || String((item && item.category) || '').trim() || '—';
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(String(s).slice(0, 10) + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function ready() {
    return !!(window.pdfMake && window.pdfMake.createPdf);
  }

  // ── Строительные блоки ───────────────────────────────────────────────────────────────────
  function label(text) {
    return { text: String(text).toUpperCase(), fontSize: 6.5, characterSpacing: 1.4, color: '#aaaaaa', margin: [0, 0, 0, 3] };
  }
  function metaCell(title, value) {
    return { stack: [label(title), { text: value, fontSize: 10, color: INK, lineHeight: 1.35 }] };
  }
  function sectionTitle(text) {
    return { text: String(text).toUpperCase(), fontSize: 7, characterSpacing: 2, color: '#aaaaaa', margin: [0, 14, 0, 6] };
  }

  var META_LAYOUT = {
    hLineWidth: function (i, node) { return i === 0 || i === node.table.body.length ? 0 : 0.5; },
    vLineWidth: function (i) { return i === 1 ? 0.5 : 0; },
    hLineColor: function () { return LINE; },
    vLineColor: function () { return LINE; },
    paddingLeft: function (i) { return i === 0 ? 0 : 16; },
    paddingRight: function (i) { return i === 0 ? 16 : 0; },
    paddingTop: function () { return 8; },
    paddingBottom: function () { return 8; }
  };

  var ITEMS_LAYOUT = {
    hLineWidth: function (i, node) { return i === 0 ? 0 : (i === 1 ? 0.8 : 0.5); },
    vLineWidth: function () { return 0; },
    hLineColor: function (i) { return i === 1 ? '#cccccc' : '#f0f0f0'; },
    paddingLeft: function () { return 0; },
    paddingRight: function (i, node) { return i === node.table.widths.length - 1 ? 0 : 10; },
    paddingTop: function () { return 6; },
    paddingBottom: function () { return 6; }
  };

  function headerBlock(docTitle, docSubtitle, orderNumber) {
    return {
      margin: [0, 0, 0, 16],
      table: {
        widths: ['*', 'auto'],
        body: [[
          {
            border: [false, false, false, true],
            stack: [
              { text: COMPANY.name, fontSize: 19, bold: true, characterSpacing: 4.5, color: INK },
              { text: COMPANY.tagline.toUpperCase(), fontSize: 6.5, characterSpacing: 2.2, color: '#999999', margin: [0, 3, 0, 0] }
            ]
          },
          {
            border: [false, false, false, true],
            alignment: 'right',
            stack: [
              { text: String(docTitle).toUpperCase(), fontSize: 12, bold: true, characterSpacing: 1, color: INK },
              { text: docSubtitle, fontSize: 8.5, color: '#666666', margin: [0, 3, 0, 0] },
              orderNumber ? { text: '№ ' + orderNumber, fontSize: 8, color: MUTED, margin: [0, 2, 0, 0] } : {}
            ]
          }
        ]]
      },
      layout: {
        hLineWidth: function (i, node) { return i === node.table.body.length ? 1.6 : 0; },
        vLineWidth: function () { return 0; },
        hLineColor: function () { return INK; },
        paddingLeft: function () { return 0; },
        paddingRight: function () { return 0; },
        paddingTop: function () { return 0; },
        paddingBottom: function () { return 14; }
      }
    };
  }

  function metaBlock(rows) {
    var body = [];
    for (var i = 0; i < rows.length; i += 2) {
      body.push([rows[i] || {}, rows[i + 1] || {}]);
    }
    return { table: { widths: ['*', '*'], body: body }, layout: META_LAYOUT, margin: [0, 0, 0, 4] };
  }

  // ── Смета ────────────────────────────────────────────────────────────────────────────────
  function buildEstimateDoc(order, calc, opts) {
    opts = opts || {};
    var withDiscount = !!opts.withDiscount;
    var hasDiscount = withDiscount && calc.discountPct > 0;

    // Позиции + услуги одной таблицей: pdfmake сам перенесёт её на новые страницы
    // и повторит шапку — ручной арифметики по высоте строк больше нет.
    var body = [[
      { text: 'Наименование', fontSize: 7, characterSpacing: 1.2, color: '#999999' },
      { text: 'Кол-во', fontSize: 7, characterSpacing: 1.2, color: '#999999', alignment: 'right' },
      { text: 'Цена', fontSize: 7, characterSpacing: 1.2, color: '#999999', alignment: 'right' },
      { text: 'Сумма', fontSize: 7, characterSpacing: 1.2, color: '#999999', alignment: 'right' }
    ]];

    calc.items.forEach(function (i) {
      body.push([
        { text: displayName(i), fontSize: 9.5, color: INK },
        { text: n(i.qty), fontSize: 9.5, color: '#555555', alignment: 'right', noWrap: true },
        { text: money(i.unitPrice), fontSize: 9.5, color: '#555555', alignment: 'right', noWrap: true },
        { text: money(i.unitTotal), fontSize: 9.5, color: INK, alignment: 'right', noWrap: true }
      ]);
    });

    function serviceRow(name, amount) {
      body.push([
        { text: name, fontSize: 9.5, color: '#777777', italics: true },
        { text: '—', fontSize: 9.5, color: '#aaaaaa', alignment: 'right' },
        { text: '—', fontSize: 9.5, color: '#aaaaaa', alignment: 'right' },
        { text: money(amount), fontSize: 9.5, color: INK, alignment: 'right', noWrap: true }
      ]);
    }
    if (calc.deliveryCost > 0) serviceRow('Доставка', calc.deliveryCost);
    if (calc.setupCost > 0) serviceRow('Сетап', calc.setupCost);
    if (calc.extraCharge > 0) serviceRow(order.extraChargeNote || 'Доп. услуга', calc.extraCharge);

    // Итоги — единым неразрывным блоком
    function totalRow(text, value, style) {
      style = style || {};
      return [
        { text: text, fontSize: style.size || 9.5, color: style.color || '#777777', bold: !!style.bold },
        { text: value, fontSize: style.size || 9.5, color: style.color || '#777777', bold: !!style.bold, alignment: 'right', noWrap: true }
      ];
    }
    var totalsBody = [totalRow('Сумма товаров', money(calc.itemsGross))];
    if (hasDiscount) {
      totalsBody.push(totalRow('↓ Скидка ' + calc.discountPct + '%', '− ' + money(calc.discountAmount), { color: '#5f9265', bold: true }));
      totalsBody.push(totalRow('Товары со скидкой', money(calc.itemsTotal)));
    }
    if (calc.deliveryCost > 0) totalsBody.push(totalRow('Доставка', money(calc.deliveryCost)));
    if (calc.setupCost > 0) totalsBody.push(totalRow('Сетап', money(calc.setupCost)));
    if (calc.extraCharge > 0) totalsBody.push(totalRow(order.extraChargeNote || 'Доп. услуга', money(calc.extraCharge)));
    totalsBody.push([
      { text: 'Итого к оплате', fontSize: 13, bold: true, color: INK, margin: [0, 4, 0, 0] },
      { text: money(calc.orderAmount), fontSize: 13, bold: true, color: INK, alignment: 'right', noWrap: true, margin: [0, 4, 0, 0] }
    ]);

    var totalsBlock = {
      unbreakable: true,
      margin: [0, 16, 0, 0],
      stack: [
        {
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 475, y2: 0, lineWidth: 1.4, lineColor: INK }],
          margin: [0, 0, 0, 10]
        },
        label('Итог'),
        {
          table: { widths: ['*', 'auto'], body: totalsBody },
          layout: {
            hLineWidth: function (i, node) { return i === node.table.body.length - 1 ? 0.5 : 0; },
            vLineWidth: function () { return 0; },
            hLineColor: function () { return '#cccccc'; },
            paddingLeft: function () { return 0; },
            paddingRight: function () { return 0; },
            paddingTop: function () { return 3; },
            paddingBottom: function () { return 3; }
          }
        },
        { text: 'без учёта залога', fontSize: 7.5, color: MUTED, alignment: 'right', margin: [0, 2, 0, 0] }
      ]
    };

    var payCells = [
      metaCell('Предоплата', '50% для бронирования — ' + money(calc.prepay) + '\nОстаток — не позднее чем за 2 дня до получения')
    ];
    if (order.depositAmount > 0) {
      payCells.push(metaCell('Залог', money(order.depositAmount) + '\nВозвращается после возврата и проверки изделий'));
    }
    payCells.push(metaCell('Реквизиты', 'Карта: ' + COMPANY.card + '\nИмя: ' + COMPANY.cardOwner));

    var paymentBlock = {
      unbreakable: true,
      margin: [0, 16, 0, 0],
      table: {
        widths: ['*'],
        body: [[{
          fillColor: '#f8f8f8',
          border: [false, false, false, false],
          stack: [
            { text: 'УСЛОВИЯ ОПЛАТЫ', fontSize: 7, characterSpacing: 1.8, color: '#888888', margin: [0, 0, 0, 8] },
            { columns: payCells, columnGap: 14 }
          ]
        }]]
      },
      layout: {
        paddingLeft: function () { return 14; }, paddingRight: function () { return 14; },
        paddingTop: function () { return 12; }, paddingBottom: function () { return 12; },
        hLineWidth: function () { return 0; },
        vLineWidth: function (i) { return i === 0 ? 2.5 : 0; },
        vLineColor: function () { return INK; }
      }
    };

    var noticeBlock = {
      unbreakable: true,
      margin: [0, 10, 0, 0],
      table: {
        widths: ['*'],
        body: [[{
          fillColor: '#f7f7f7', border: [false, false, false, false],
          text: [
            { text: 'Важно: ', bold: true, color: '#2f2f2f' },
            { text: 'при отмене всего заказа или части позиций менее чем за 2 дня до получения удерживается полная стоимость аренды.', color: '#4f4f4f' }
          ],
          fontSize: 8.5, lineHeight: 1.35
        }]]
      },
      layout: {
        paddingLeft: function () { return 12; }, paddingRight: function () { return 12; },
        paddingTop: function () { return 9; }, paddingBottom: function () { return 9; },
        hLineWidth: function () { return 0; },
        vLineWidth: function (i) { return i === 0 ? 2.5 : 0; },
        vLineColor: function () { return '#8a8a8a'; }
      }
    };

    var termsBlock = {
      unbreakable: true,
      margin: [0, 10, 0, 0],
      table: {
        widths: ['*', 'auto'],
        body: [[
          {
            fillColor: '#fafbfd', border: [false, false, false, false],
            stack: [
              label('Условия работы'),
              { text: 'Подробные условия аренды, оплаты и отмены заказа доступны на сайте.', fontSize: 8.5, color: '#5b6472' }
            ]
          },
          {
            fillColor: '#fafbfd', border: [false, false, false, false], alignment: 'right',
            text: COMPANY.termsLabel, link: COMPANY.termsUrl, fontSize: 8.5, bold: true, color: ACCENT, margin: [0, 6, 0, 0]
          }
        ]]
      },
      layout: {
        paddingLeft: function () { return 12; }, paddingRight: function () { return 12; },
        paddingTop: function () { return 9; }, paddingBottom: function () { return 9; },
        hLineWidth: function () { return 0; }, vLineWidth: function () { return 0; }
      }
    };

    // Мета-блок
    var metaRows = [
      metaCell('Клиент', order.clientName + (order.companyName ? '\n' + order.companyName : '') + (order.clientPhone ? '\n' + order.clientPhone : '')),
      metaCell('Период аренды', fmtDate(order.startDate) + '\n— ' + fmtDate(order.endDate)),
      metaCell('Доставка', order.deliveryType === 'pickup'
        ? 'Самовывоз'
        : ((order.deliveryZone === 'outside' && order.deliveryKm > 0 ? order.deliveryKm + ' км от города\n' : '') + (order.deliveryAddress || '—'))),
      metaCell('Сетап', calc.setupCost > 0 ? 'Предусмотрен' : 'Не предусмотрен')
    ];
    if (order.depositAmount > 0) metaRows.push(metaCell('Залог', money(order.depositAmount)));
    metaRows.push(metaCell('Пронос / Подъём на этаж', order.carryFloor === 'yes' ? 'Предусмотрен' : 'Не предусмотрен'));
    if (hasDiscount) metaRows.push(metaCell('Индивидуальная скидка', calc.discountPct + '%  (− ' + money(calc.discountAmount) + ')'));
    metaRows.push(metaCell('Исполнитель', 'Компания ' + COMPANY.name + '\nтел. ' + COMPANY.phone));

    return {
      pageSize: 'A4',
      pageMargins: [60, 44, 60, 46],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: INK },
      info: {
        title: 'Смета ' + (order.orderNumber || order.id),
        author: COMPANY.name,
        subject: 'Смета на аренду'
      },
      content: [
        headerBlock('Смета', withDiscount ? 'Для профессионала' : 'Стандарт', order.orderNumber),
        metaBlock(metaRows),
        sectionTitle('Состав заказа'),
        { table: { headerRows: 1, widths: ['*', 42, 62, 74], body: body }, layout: ITEMS_LAYOUT },
        totalsBlock,
        paymentBlock,
        noticeBlock,
        termsBlock
      ],
      footer: function (currentPage, pageCount) {
        return {
          margin: [60, 8, 60, 0],
          columns: [
            { text: COMPANY.name, fontSize: 7, characterSpacing: 2, color: '#b0b0b0' },
            { text: 'Пожалуйста, отправьте менеджеру чек после перевода', fontSize: 7.5, color: '#8a8a8a', alignment: 'center' },
            { text: currentPage + ' / ' + pageCount, fontSize: 7.5, color: '#b0b0b0', alignment: 'right' }
          ]
        };
      }
    };
  }

  // ── Акт передачи ─────────────────────────────────────────────────────────────────────────
  function buildActDoc(order, calc) {
    var body = [[
      { text: 'Наименование', fontSize: 7, characterSpacing: 1.2, color: '#999999' },
      { text: 'Получено', fontSize: 7, characterSpacing: 1.2, color: '#999999', alignment: 'right' },
      { text: 'Возвращено', fontSize: 7, characterSpacing: 1.2, color: '#999999', alignment: 'right' }
    ]];
    calc.items.forEach(function (i) {
      body.push([
        { text: displayName(i), fontSize: 9.5, color: INK },
        { text: n(i.qty) + ' шт', fontSize: 9.5, color: '#555555', alignment: 'right', noWrap: true },
        { text: '__________', fontSize: 9.5, color: '#bbbbbb', alignment: 'right' }
      ]);
    });

    function signature(title) {
      return {
        unbreakable: true,
        margin: [0, 0, 0, 22],
        stack: [
          { text: title, fontSize: 9.5, color: '#333333', margin: [0, 0, 0, 12] },
          {
            columns: [
              { width: 'auto', text: 'Клиент', fontSize: 9, color: '#666666', margin: [0, 4, 8, 0] },
              { width: '*', canvas: [{ type: 'line', x1: 0, y1: 10, x2: 150, y2: 10, lineWidth: 0.6, lineColor: INK }] },
              { width: 'auto', text: 'Исполнитель', fontSize: 9, color: '#666666', margin: [16, 4, 8, 0] },
              { width: '*', canvas: [{ type: 'line', x1: 0, y1: 10, x2: 150, y2: 10, lineWidth: 0.6, lineColor: INK }] }
            ]
          }
        ]
      };
    }

    var metaRows = [
      metaCell('Исполнитель', 'Компания ' + COMPANY.name + '\nтел. ' + COMPANY.phone),
      metaCell('Клиент', order.clientName + (order.companyName ? '\n' + order.companyName : '') + (order.clientPhone ? '\n' + order.clientPhone : '')),
      metaCell('Получение / Возврат', fmtDate(order.startDate) + ' — ' + fmtDate(order.endDate)),
      metaCell('Доставка', order.deliveryType === 'pickup'
        ? 'Самовывоз'
        : ((order.deliveryZone === 'outside' && order.deliveryKm > 0 ? order.deliveryKm + ' км от города\n' : '') + (order.deliveryAddress || '—'))),
      metaCell('Сетап', calc.setupCost > 0 ? 'Предусмотрен' : 'Не предусмотрен'),
      metaCell('Пронос / Подъём на этаж', order.carryFloor === 'yes' ? 'Предусмотрен' : 'Не предусмотрен'),
      metaCell('Залог принят', order.depositAmount > 0 ? money(order.depositAmount) : '—'),
      {}
    ];

    return {
      pageSize: 'A4',
      pageMargins: [60, 44, 60, 46],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: INK },
      info: { title: 'Акт передачи ' + (order.orderNumber || order.id), author: COMPANY.name },
      content: [
        headerBlock('Акт передачи', '', order.orderNumber),
        metaBlock(metaRows),
        sectionTitle('Состав заказа'),
        { table: { headerRows: 1, widths: ['*', 70, 90], body: body }, layout: ITEMS_LAYOUT },
        { margin: [0, 26, 0, 0], stack: [signature('«Получено» подтверждаю:'), signature('«Возвращено» подтверждаю:')] },
        {
          unbreakable: true,
          columns: [
            { width: 'auto', text: 'С условиями ознакомлен/а. Услуга оказана в полном объёме', fontSize: 9, color: '#333333', margin: [0, 4, 10, 0] },
            { width: '*', canvas: [{ type: 'line', x1: 0, y1: 10, x2: 180, y2: 10, lineWidth: 0.6, lineColor: INK }] }
          ]
        }
      ],
      footer: function (currentPage, pageCount) {
        return {
          margin: [60, 8, 60, 0],
          columns: [
            { text: COMPANY.name, fontSize: 7, characterSpacing: 2, color: '#b0b0b0' },
            { text: 'Залог возвращается после возврата и проверки изделий.', fontSize: 7.5, color: '#8a8a8a', alignment: 'center' },
            { text: currentPage + ' / ' + pageCount, fontSize: 7.5, color: '#b0b0b0', alignment: 'right' }
          ]
        };
      }
    };
  }

  // ── Точки входа ──────────────────────────────────────────────────────────────────────────
  function build(kind, order, calc, opts) {
    return kind === 'act' ? buildActDoc(order, calc) : buildEstimateDoc(order, calc, opts);
  }

  function createPdf(kind, order, calc, opts) {
    if (!ready()) throw new Error('Библиотека pdfmake не загрузилась');
    return window.pdfMake.createPdf(build(kind, order, calc, opts));
  }

  function toBlob(kind, order, calc, opts) {
    return new Promise(function (resolve, reject) {
      try {
        createPdf(kind, order, calc, opts).getBlob(function (blob) { resolve(blob); });
      } catch (e) { reject(e); }
    });
  }

  function fileName(kind, order, opts) {
    var num = order.orderNumber || order.id || 'NEW';
    if (kind === 'act') return 'Акт_' + num + '.pdf';
    return (opts && opts.withDiscount ? 'Смета_профессионал_' : 'Смета_') + num + '.pdf';
  }

  function download(kind, order, calc, opts) {
    createPdf(kind, order, calc, opts).download(fileName(kind, order, opts));
  }

  function open(kind, order, calc, opts) {
    createPdf(kind, order, calc, opts).open();
  }

  async function share(kind, order, calc, opts) {
    var blob = await toBlob(kind, order, calc, opts);
    var name = fileName(kind, order, opts);
    var file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return { shared: true };
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { shared: false };
  }

  window.RadarDocs = {
    ready: ready,
    build: build,
    createPdf: createPdf,
    toBlob: toBlob,
    download: download,
    open: open,
    share: share,
    fileName: fileName,
    displayName: displayName,
    COMPANY: COMPANY
  };
})();
