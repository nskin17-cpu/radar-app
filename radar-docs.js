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
    pickupAddress: 'Ростов-на-Дону, ул. Таганрогская, 106Б',
    // Надпись из макета № 14, Syne Bold 19 пт. Кривые не зависят от шрифтов устройства.
    wordmark: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"126.11\" height=\"19\" viewBox=\"0 0 126.11 19\"><path fill=\"#1a1a1a\" d=\"M13.93 12.49 13.13 12.81V2.71H15.66V15H13.13L3.19 5.29L3.99 4.97V15H1.46V2.71H3.99ZM20.38 12.32V10.21H28.51V12.32ZM17.32 15 23.1 2.71H25.83L31.67 15H28.91L23.86 3.92H25.07L20.06 15ZM45.8 12.49 45 12.81V2.71H47.53V15H45L35.06 5.29L35.86 4.97V15H33.33V2.71H35.86ZM57.36 2.71Q59.43 2.71 60.82 3.2Q62.21 3.7 63.03 4.54Q63.86 5.39 64.21 6.49Q64.56 7.59 64.56 8.81Q64.56 10.02 64.17 11.14Q63.78 12.26 62.94 13.13Q62.09 13.99 60.72 14.5Q59.34 15 57.36 15H50.33V2.71ZM52.86 12.83H57.3Q58.67 12.83 59.58 12.5Q60.48 12.17 61.01 11.6Q61.54 11.03 61.77 10.31Q62 9.59 62 8.81Q62 8.03 61.77 7.32Q61.54 6.62 61.01 6.07Q60.48 5.52 59.58 5.2Q58.67 4.87 57.3 4.87H52.86ZM66.91 15V2.71H75.25Q76.68 2.71 77.73 3.1Q78.79 3.49 79.38 4.31Q79.97 5.14 79.97 6.43Q79.97 7.31 79.66 7.91Q79.36 8.52 78.82 8.9Q78.28 9.28 77.57 9.48Q76.87 9.68 76.07 9.74L75.81 9.59Q77.14 9.6 77.99 9.8Q78.84 10 79.27 10.53Q79.7 11.05 79.7 12.07V15H77.17V12.25Q77.17 11.54 76.93 11.15Q76.68 10.76 76.04 10.61Q75.41 10.46 74.21 10.46H69.44V15ZM69.44 8.48H75.25Q76.32 8.48 76.88 7.97Q77.44 7.46 77.44 6.58Q77.44 5.75 76.88 5.31Q76.32 4.87 75.25 4.87H69.44ZM85.01 9.87V12.89H94.5V15H82.49V2.71H94.48V4.82H85.01V7.88H92.77V9.87ZM109.44 12.49 108.64 12.81V2.71H111.17V15H108.64L98.71 5.29L99.5 4.97V15H96.98V2.71H99.5ZM112.89 2.71H125.85V4.82H112.89ZM118.12 4.55H120.65V15H118.12Z\"/></svg>",
    tagline: 'Аренда посуды и мебели',
    phone: '+7 (966) 866-86-66',
    termsUrl: 'https://nandrent.ru/uslovia',
    termsLabel: 'nandrent.ru/uslovia'
  };

  function n(v) { return Math.round(Number(v) || 0).toLocaleString('ru-RU'); }
  function money(v) { return n(v) + ' ₽'; }
  function cleanName(name) {
    return String(name || '').replace(/\s*[—-]\s*\d[\d\s]*\s*₽\s*$/, '').trim();
  }
  function displayName(item) {
    return cleanName(item && (item.documentName || item.name)) || String((item && item.category) || '').trim() || '—';
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
  function deliveryCell(order) {
    if (order.deliveryType === 'pickup') return metaCell('Самовывоз со склада', COMPANY.pickupAddress);
    var distance = order.deliveryZone === 'outside' && order.deliveryKm > 0 ? order.deliveryKm + ' км от города\n' : '';
    return metaCell('Доставка', distance + (order.deliveryAddress || '—'));
  }

  function productPhoto(item) {
    if (item && item.catalogVariant) return window.RadarDocumentPhotos && window.RadarDocumentPhotos[item.catalogVariant];
    var name = cleanName(item && item.name).toLowerCase().replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, ' ').trim();
    return window.RadarDocumentPhotos && window.RadarDocumentPhotos[name];
  }

  function itemCell(item) {
    var setup = item.setup !== false;
    var caption = { stack: [
      { text: displayName(item), fontSize: 9.5, color: INK },
      { text: setup ? 'Сетап включён' : 'Без сетапа', fontSize: 8, color: setup ? '#42654c' : '#686868', margin: [0, 2, 0, 0] }
    ] };
    if (item.material) caption.stack.splice(1, 0, { text: 'Материал: ' + item.material, fontSize: 8, color: '#626a70', margin: [0, 2, 0, 0] });
    var photo = productPhoto(item);
    return { columns: [photo ? { image: photo, fit: [36, 36], width: 36 } : { text: '', width: 36 }, caption], columnGap: 8 };
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
              { svg: COMPANY.wordmark, width: 126.11 },
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

  /**
   * Позиции для клиента. Неоплачиваемые строки (billable===false — изделия
   * партнёра в его собственном заказе) в документ не попадают: клиент за них
   * не платит, и в итогах расчёта их тоже нет. В заказе стороннего клиента
   * партнёрские позиции печатаются как обычные.
   */
  function clientItems(calc) {
    return (calc && calc.items || []).filter(function (i) { return i.billable !== false; });
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

    clientItems(calc).forEach(function (i) {
      body.push([
        itemCell(i),
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
      var color = style.color || '#777777';
      var caption = { text: text, fontSize: style.size || 9.5, color: color, bold: !!style.bold };
      return [
        caption,
        { text: value, fontSize: style.size || 9.5, color: style.color || '#777777', bold: !!style.bold, alignment: 'right', noWrap: true }
      ];
    }
    var totalsBody = [totalRow('Сумма товаров', money(calc.itemsGross))];
    if (hasDiscount) {
      totalsBody.push(totalRow('Профессиональная скидка ' + calc.discountPct + '%', '− ' + money(calc.discountAmount), { color: '#5f9265', bold: true }));
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
    // Перевод на карту частного лица из сметы убран: клиенту предлагаются
    // только расчёты с компанией. Номера счёта здесь намеренно нет — счёт
    // выставляется под конкретный заказ, а в шаблоне устарел бы молча.
    payCells.push(metaCell('Способы оплаты', 'Безналичный расчёт по счёту или СБП\nСчёт на оплату пришлём по запросу'));

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
      deliveryCell(order),
      metaCell('Сетап', calc.setupCost > 0 ? 'Предусмотрен' : 'Не предусмотрен')
    ];
    if (order.depositAmount > 0) metaRows.push(metaCell('Залог', money(order.depositAmount)));
    metaRows.push(metaCell('Пронос / Подъём на этаж', order.carryFloor === 'yes' ? 'Предусмотрен' : 'Не предусмотрен'));
    if (hasDiscount) {
      metaRows.push({ stack: [
        { text: ['Профессиональная скидка  ', { text: calc.discountPct + '%', bold: true, color: '#42654c' }], fontSize: 9.5 },
        { text: 'Ваша экономия — ' + money(calc.discountAmount), fontSize: 9, color: '#505650', margin: [0, 3, 0, 0] }
      ] });
    }
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
        { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 42, 62, 74], body: body }, layout: ITEMS_LAYOUT },
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
    clientItems(calc).forEach(function (i) {
      body.push([
        itemCell(i),
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
      deliveryCell(order),
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
        { table: { headerRows: 1, dontBreakRows: true, widths: ['*', 70, 90], body: body }, layout: ITEMS_LAYOUT },
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
    productPhoto: productPhoto,
    COMPANY: COMPANY
  };
})();
