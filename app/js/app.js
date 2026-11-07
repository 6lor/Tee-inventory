import * as db from './db.js';

/* ---------- constants & helpers ---------- */

const TEE_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const ONE = 'OS'; // tote bags: one size
const KIND_LABEL = { tee: 'T-shirt', tote: 'Tote bag' };
const TYPE_LABEL = { sale: 'Sale', count: 'Count fix', restock: 'Received' };
const TITLES = { sell: 'Sell', stock: 'Stock', products: 'Designs', stats: 'Stats' };
const PERIODS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']];

const sizesFor = (p) => (p.kind === 'tote' ? [ONE] : TEE_SIZES);
const sizeLabel = (s) => (s === ONE ? 'One size' : s);
const $ = (sel) => document.querySelector(sel);
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: ignore */
  }
}

const currency = () => lsGet('tee-currency', '$');
const money = (n) => `${currency()}${(Math.round(n * 100) / 100).toFixed(2)}`;

/* ---------- state ---------- */

const state = {
  products: [],
  events: [],
  tab: lsGet('tee-tab', 'sell'),
  basket: lsGet('tee-basket', []), // [{productId, size, qty}]
  sheet: null,
  period: '7d',
};

const prod = (id) => state.products.find((p) => p.id === id);
const activeProducts = () => [...state.products].sort((a, b) => a.name.localeCompare(b.name));
const total = (p) => sizesFor(p).reduce((a, s) => a + (p.stock[s] || 0), 0);
const basketQty = (pid, size) =>
  state.basket.filter((l) => l.productId === pid && (size == null || l.size === size)).reduce((a, l) => a + l.qty, 0);
const basketCount = () => state.basket.reduce((a, l) => a + l.qty, 0);
const saveBasket = () => lsSet('tee-basket', state.basket);

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}
function thumb(p, cls = 'thumb') {
  if (p.image) return `<img class="${cls}" src="${p.image}" alt="">`;
  return `<div class="${cls} ph" style="--h:${hue(p.name || '')}">${esc(initials(p.name || ''))}</div>`;
}

/* ---------- persistence ---------- */

async function load() {
  const [products, events] = await Promise.all([db.getAll('products'), db.getAll('events')]);
  state.products = products;
  state.events = events.sort((a, b) => a.ts - b.ts);
  // drop basket lines for designs that no longer exist
  state.basket = state.basket.filter((l) => prod(l.productId));
}

async function persist(change) {
  try {
    await db.commit(change);
  } catch (err) {
    alert('Could not save: ' + (err?.message || err) + '\nReloading data from the device.');
    await load();
    render();
    throw err;
  }
}

/* ---------- toast ---------- */

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  toast.action = action?.fn;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2500);
}

/* ---------- views ---------- */

function emptyState() {
  return `<div class="empty">
    <div class="empty-icon">👕</div>
    <p>No designs yet.</p>
    <button class="btn primary big" data-act="go-new-product">+ Add your first design</button>
  </div>`;
}

function sizeStrip(p, minusBasket) {
  return sizesFor(p)
    .map((s) => {
      const n = (p.stock[s] || 0) - (minusBasket ? basketQty(p.id, s) : 0);
      const cls = n <= 0 ? 'zero' : n <= 2 ? 'low' : '';
      return `<span class="chip ${cls}">${p.kind === 'tote' ? '' : `<b>${s}</b> `}${n}</span>`;
    })
    .join('');
}

function productGrid(act, forSell) {
  const ps = activeProducts();
  if (!ps.length) return emptyState();
  return `<div class="grid">${ps
    .map((p) => {
      const inBasket = forSell ? basketQty(p.id) : 0;
      return `<button class="card" data-act="${act}" data-id="${p.id}">
        <div class="card-img">${thumb(p)}${inBasket ? `<span class="badge">${inBasket}</span>` : ''}</div>
        <div class="card-body">
          <div class="card-name">${esc(p.name)}</div>
          <div class="chips">${sizeStrip(p, forSell)}</div>
        </div>
      </button>`;
    })
    .join('')}</div>`;
}

const VIEWS = {
  sell: () =>
    `<p class="hint">Tap a design, then tap a size for each item sold.</p>${productGrid('open-sell', true)}`,

  stock: () =>
    `<p class="hint">Tap a design to count it or add received stock. Nothing is saved until you press Save.</p>${productGrid(
      'open-count',
      false,
    )}`,

  products: () => `
    <button class="btn primary big block" data-act="new-product">+ New design</button>
    <div class="list">${activeProducts()
      .map(
        (p) => `<button class="row" data-act="edit-product" data-id="${p.id}">
          ${thumb(p, 'thumb sm')}
          <div class="row-main">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-sub">${KIND_LABEL[p.kind]}${p.price ? ` · ${money(p.price)}` : ''} · ${total(p)} in stock</div>
          </div>
          <span class="chev">›</span>
        </button>`,
      )
      .join('')}</div>
    <section class="panel">
      <h3>Data &amp; backup</h3>
      <p class="hint">Everything is stored on this device only. Export a backup now and then (e.g. to Files or iCloud Drive).</p>
      <div class="btn-col">
        <button class="btn" data-act="export-json">Export backup</button>
        <button class="btn" data-act="import-json">Import backup</button>
        <button class="btn" data-act="export-csv">Export history (CSV)</button>
      </div>
      <label class="field"><span>Currency symbol</span>
        <input data-setting="currency" value="${esc(currency())}" maxlength="4" autocomplete="off"></label>
    </section>`,

  stats: statsView,
};

function periodStart(key) {
  const now = new Date();
  if (key === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (key === '7d') return now.getTime() - 7 * 864e5;
  if (key === '30d') return now.getTime() - 30 * 864e5;
  return 0;
}

function statsView() {
  const since = periodStart(state.period);
  const sales = state.events.filter((e) => e.type === 'sale' && e.ts >= since);
  const items = sales.reduce((a, e) => a + -e.delta, 0);
  const txCount = new Set(sales.map((e) => e.saleId)).size;
  const revenue = sales.reduce((a, e) => a + -e.delta * (e.price || 0), 0);

  const byProduct = new Map();
  const bySize = {};
  for (const e of sales) {
    const key = e.productId;
    if (!byProduct.has(key)) byProduct.set(key, { id: key, name: e.productName, kind: e.kind, qty: 0, sizes: {} });
    const g = byProduct.get(key);
    g.qty += -e.delta;
    g.sizes[e.size] = (g.sizes[e.size] || 0) + -e.delta;
    if (e.kind === 'tee') bySize[e.size] = (bySize[e.size] || 0) + -e.delta;
  }
  const top = [...byProduct.values()].sort((a, b) => b.qty - a.qty);
  const maxQ = top[0]?.qty || 1;
  const maxS = Math.max(1, ...Object.values(bySize));

  const chips = PERIODS.map(
    ([k, l]) => `<button class="${state.period === k ? 'on' : ''}" data-act="period" data-period="${k}">${l}</button>`,
  ).join('');

  const topHtml = top.length
    ? top
        .map((g) => {
          const p = prod(g.id);
          const sizeOrder = g.kind === 'tote' ? [ONE] : TEE_SIZES;
          const sizes = sizeOrder.filter((s) => g.sizes[s]).map((s) => `${sizeLabel(s)} ${g.sizes[s]}`).join(' · ');
          return `<div class="rank">
            ${p ? thumb(p, 'thumb xs') : `<div class="thumb xs ph" style="--h:${hue(g.name)}">${esc(initials(g.name))}</div>`}
            <div class="rank-main">
              <div class="rank-top"><span class="rank-name">${esc(p?.name || g.name)}</span><b>${g.qty}</b></div>
              <div class="bar"><i style="width:${(g.qty / maxQ) * 100}%"></i></div>
              <div class="rank-sizes">${sizes}</div>
            </div>
          </div>`;
        })
        .join('')
    : '<p class="hint">No sales in this period.</p>';

  const sizeHtml = TEE_SIZES.map(
    (s) => `<div class="srow"><span>${s}</span><div class="bar"><i style="width:${((bySize[s] || 0) / maxS) * 100}%"></i></div><b>${
      bySize[s] || 0
    }</b></div>`,
  ).join('');

  return `
    <div class="seg wide">${chips}</div>
    <div class="tiles">
      <div class="tile"><b>${items}</b><span>items sold</span></div>
      <div class="tile"><b>${txCount}</b><span>sales</span></div>
      ${revenue ? `<div class="tile"><b>${money(revenue)}</b><span>revenue</span></div>` : ''}
    </div>
    <section class="panel"><h3>Best sellers</h3>${topHtml}</section>
    <section class="panel"><h3>T-shirt sizes sold</h3>${sizeHtml}</section>
    <section class="panel"><h3>Activity</h3>${activityHtml()}</section>`;
}

function activityHtml() {
  const evs = [...state.events].sort((a, b) => b.ts - a.ts).slice(0, 150);
  if (!evs.length) return '<p class="hint">Nothing recorded yet.</p>';
  let lastDay = '';
  let out = '';
  for (const e of evs) {
    const d = new Date(e.ts);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (day !== lastDay) {
      out += `<div class="day">${day}</div>`;
      lastDay = day;
    }
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dcls = e.delta > 0 ? 'up' : 'down';
    out += `<div class="act">
      <span class="act-time">${time}</span>
      <span class="act-type t-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
      <span class="act-name">${esc(e.productName)} <small>${sizeLabel(e.size)}</small></span>
      <span class="act-delta ${dcls}">${e.delta > 0 ? '+' : ''}${e.delta}</span>
      <button class="act-del" data-act="delete-event" data-id="${e.id}" aria-label="Undo this entry">✕</button>
    </div>`;
  }
  return out;
}

/* ---------- sheets ---------- */

const sheetHead = (title, sub = '') => `<div class="sheet-head">
  <button class="back" data-act="close-sheet" aria-label="Back">‹</button>
  <div class="sheet-title"><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
</div>`;

const SHEETS = {
  sell(s) {
    const p = prod(s.productId);
    const n = basketCount();
    return `${sheetHead(p.name, KIND_LABEL[p.kind] + (p.price ? ' · ' + money(p.price) : ''))}
    <div class="sheet-body">
      <div class="hero">${thumb(p, 'hero-img')}</div>
      <div class="size-grid ${p.kind === 'tote' ? 'single' : ''}">${sizesFor(p)
        .map((sz) => {
          const inB = basketQty(p.id, sz);
          const left = (p.stock[sz] || 0) - inB;
          return `<button class="size-btn ${left <= 0 ? 'out' : ''}" data-act="add-basket" data-id="${p.id}" data-size="${sz}">
            <span class="size-lbl">${sizeLabel(sz)}</span>
            <span class="size-left">${left <= 0 ? 'none left' : left + ' left'}</span>
            ${inB ? `<span class="badge">${inB}</span>` : ''}
          </button>`;
        })
        .join('')}</div>
      ${basketQty(p.id) ? `<button class="btn subtle block" data-act="clear-product-basket" data-id="${p.id}">Remove this design from the sale</button>` : ''}
    </div>
    <div class="sheet-foot two">
      <button class="btn big" data-act="close-sheet">‹ Back</button>
      <button class="btn primary big" data-act="open-basket" ${n ? '' : 'disabled'}>Review sale${n ? ` (${n})` : ''}</button>
    </div>`;
  },

  basket() {
    const lines = state.basket.map((l) => ({ ...l, p: prod(l.productId) })).filter((l) => l.p);
    const sum = lines.reduce((a, l) => a + l.qty * (l.p.price || 0), 0);
    const n = basketCount();
    return `${sheetHead('Current sale', plural(n, 'item'))}
    <div class="sheet-body">
      ${
        lines.length
          ? lines
              .map(
                (l, i) => `<div class="bline">
          ${thumb(l.p, 'thumb xs')}
          <div class="bline-main"><div class="row-title">${esc(l.p.name)}</div>
            <div class="row-sub">${sizeLabel(l.size)}${l.p.price ? ' · ' + money(l.p.price) : ''}</div></div>
          <div class="stepper small">
            <button data-act="basket-step" data-i="${i}" data-d="-1" aria-label="One less">−</button>
            <span>${l.qty}</span>
            <button data-act="basket-step" data-i="${i}" data-d="1" aria-label="One more">+</button>
          </div>
        </div>`,
              )
              .join('')
          : '<p class="hint">The sale is empty.</p>'
      }
      ${sum ? `<div class="sum-line"><span>Total</span><b>${money(sum)}</b></div>` : ''}
      ${lines.length ? `<button class="btn subtle block" data-act="clear-basket">Clear sale</button>` : ''}
    </div>
    <div class="sheet-foot two">
      <button class="btn big" data-act="close-sheet">Add more</button>
      <button class="btn primary big" data-act="complete-sale" ${n ? '' : 'disabled'}>Complete sale</button>
    </div>`;
  },

  count(s) {
    const p = prod(s.productId);
    const counting = s.mode === 'count';
    const last = p.lastCountAt ? 'Last counted ' + new Date(p.lastCountAt).toLocaleDateString() : 'Never counted';
    return `${sheetHead(p.name, last)}
    <div class="sheet-body">
      <div class="seg wide">
        <button class="${counting ? 'on' : ''}" data-act="count-mode" data-mode="count">Count totals</button>
        <button class="${!counting ? 'on' : ''}" data-act="count-mode" data-mode="receive">Add received</button>
      </div>
      <p class="hint">${
        counting
          ? 'Enter how many you <b>actually have</b> of every size. Differences are saved as a count fix, never as sales.'
          : 'Enter how many <b>new</b> items arrived per size. Leave blank for none.'
      }</p>
      <div class="count-list">${sizesFor(p)
        .map(
          (sz) => `<div class="count-row" data-row="${sz}">
          <div class="cr-size">${sizeLabel(sz)}</div>
          <div class="cr-info"><span class="cr-was">now ${p.stock[sz] || 0}</span><span class="cr-delta"></span></div>
          <div class="stepper">
            <button data-act="step" data-size="${sz}" data-d="-1" aria-label="Minus one">−</button>
            <input data-count="${sz}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
              value="${esc(s.values[sz] ?? '')}" placeholder="${counting ? '?' : '0'}" aria-label="${sizeLabel(sz)}">
            <button data-act="step" data-size="${sz}" data-d="1" aria-label="Plus one">+</button>
          </div>
        </div>`,
        )
        .join('')}</div>
      ${
        counting && p.kind !== 'tote'
          ? `<button class="btn subtle block" data-act="fill-unchanged">Mark empty sizes as unchanged</button>`
          : ''
      }
    </div>
    <div class="sheet-foot"><button id="count-save" class="btn primary big block" data-act="save-count" disabled></button></div>`;
  },

  edit(s) {
    const d = s.draft;
    const isNew = !s.productId;
    return `${sheetHead(isNew ? 'New design' : 'Edit design')}
    <div class="sheet-body">
      <label class="photo-pick">
        ${d.image ? `<img src="${d.image}" alt="">` : `<div class="photo-ph"><span>📷</span>Add photo</div>`}
        <input type="file" accept="image/*" data-photo class="vh">
      </label>
      ${d.image ? `<button class="btn subtle block" data-act="remove-photo">Remove photo</button>` : ''}
      <label class="field"><span>Name</span>
        <input data-field="name" value="${esc(d.name)}" placeholder="e.g. Skull logo – black" autocomplete="off"></label>
      <div class="field"><span>Type</span>${
        isNew
          ? `<div class="seg wide">${['tee', 'tote']
              .map((k) => `<button class="${d.kind === k ? 'on' : ''}" data-act="set-kind" data-kind="${k}">${KIND_LABEL[k]}</button>`)
              .join('')}</div>`
          : `<div class="static">${KIND_LABEL[d.kind]} <small>(${d.kind === 'tote' ? 'one size' : 'S – 3XL'})</small></div>`
      }</div>
      <label class="field"><span>Price (optional)</span>
        <input data-field="price" type="text" inputmode="decimal" value="${esc(d.price ?? '')}" placeholder="0.00" autocomplete="off"></label>
      ${
        isNew
          ? `<div class="field"><span>Starting stock</span><div class="init-grid ${d.kind === 'tote' ? 'single' : ''}">${sizesFor(d)
              .map(
                (sz) => `<label class="init"><span>${sizeLabel(sz)}</span>
                <input data-init="${sz}" type="text" inputmode="numeric" pattern="[0-9]*" value="${esc(d.initial[sz] ?? '')}" placeholder="0"></label>`,
              )
              .join('')}</div></div>`
          : ''
      }
      ${!isNew ? `<button class="btn danger block" data-act="delete-product">Delete design</button>` : ''}
    </div>
    <div class="sheet-foot"><button class="btn primary big block" data-act="save-product">Save</button></div>`;
  },
};

/* ---------- rendering ---------- */

function render() {
  document.body.dataset.mode = state.tab;
  $('#title').textContent = TITLES[state.tab];
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  $('#view').innerHTML = VIEWS[state.tab]();
  renderBasketBar();
  renderSheet();
}

function renderBasketBar() {
  const n = basketCount();
  const bar = $('#basketbar');
  const show = state.tab === 'sell' && n > 0;
  bar.classList.toggle('show', show);
  document.body.classList.toggle('has-basket', show);
  if (show) {
    const sum = state.basket.reduce((a, l) => a + l.qty * (prod(l.productId)?.price || 0), 0);
    bar.innerHTML = `<button class="btn primary big block" data-act="open-basket">
      <span>🛒 ${plural(n, 'item')}${sum ? ' · ' + money(sum) : ''}</span><span>Review sale ›</span></button>`;
  }
}

function renderSheet() {
  const el = $('#sheet');
  const s = state.sheet;
  document.body.classList.toggle('sheet-open', !!s);
  if (!s) {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  const oldBody = el.querySelector('.sheet-body');
  const keepScroll = oldBody && el.dataset.key === sheetKey(s) ? oldBody.scrollTop : 0;
  el.innerHTML = SHEETS[s.type](s);
  el.dataset.key = sheetKey(s);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  const body = el.querySelector('.sheet-body');
  if (body) body.scrollTop = keepScroll;
  if (s.type === 'count') updateCountUI();
}
const sheetKey = (s) => s.type + ':' + (s.productId || '');

function openSheet(s) {
  state.sheet = s;
  renderSheet();
}
function closeSheet() {
  state.sheet = null;
  render();
}

/* ---------- selling ---------- */

function addToBasket(pid, size) {
  const line = state.basket.find((l) => l.productId === pid && l.size === size);
  if (line) line.qty++;
  else state.basket.push({ productId: pid, size, qty: 1 });
  saveBasket();
  if (navigator.vibrate) navigator.vibrate(15);
  renderSheet();
}

async function completeSale() {
  const saleId = uid();
  const ts = Date.now();
  const events = [];
  const changed = new Map();
  for (const l of state.basket) {
    const p = prod(l.productId);
    if (!p || l.qty <= 0) continue;
    p.stock[l.size] = (p.stock[l.size] || 0) - l.qty;
    changed.set(p.id, p);
    events.push({
      id: uid(), ts, type: 'sale', saleId, productId: p.id, productName: p.name, kind: p.kind,
      size: l.size, delta: -l.qty, price: Number(p.price) || 0,
    });
  }
  if (!events.length) return;
  await persist({ products: [...changed.values()], events });
  state.events.push(...events);
  const n = basketCount();
  state.basket = [];
  saveBasket();
  state.sheet = null;
  render();
  toast(`Sold ${plural(n, 'item')}`, { label: 'Undo', fn: () => removeEvents(events.map((e) => e.id)) });
}

/* Removing history entries puts the stock back the way it was before them. */
async function removeEvents(ids) {
  const evs = state.events.filter((e) => ids.includes(e.id));
  const changed = new Map();
  for (const e of evs) {
    const p = prod(e.productId);
    if (!p) continue;
    p.stock[e.size] = (p.stock[e.size] || 0) - e.delta;
    changed.set(p.id, p);
  }
  await persist({ products: [...changed.values()], deleteEvents: ids });
  state.events = state.events.filter((e) => !ids.includes(e.id));
  render();
  toast(evs.length === 1 ? 'Entry undone, stock restored' : 'Undone, stock restored');
}

/* ---------- counting / receiving ---------- */

function countStatus(s, p) {
  const sizes = sizesFor(p);
  const filled = sizes.filter((sz) => s.values[sz] !== '' && s.values[sz] != null);
  if (s.mode === 'count') {
    const missing = sizes.length - filled.length;
    return missing
      ? { ready: false, label: `Enter ${missing} more size${missing === 1 ? '' : 's'}` }
      : { ready: true, label: 'Save count' };
  }
  const sum = filled.reduce((a, sz) => a + Number(s.values[sz] || 0), 0);
  return sum > 0 ? { ready: true, label: `Add ${sum} to stock` } : { ready: false, label: 'Enter quantities' };
}

function updateCountUI() {
  const s = state.sheet;
  const p = prod(s.productId);
  for (const sz of sizesFor(p)) {
    const row = document.querySelector(`[data-row="${sz}"]`);
    if (!row) continue;
    const v = s.values[sz];
    const cur = p.stock[sz] || 0;
    const deltaEl = row.querySelector('.cr-delta');
    let txt = '';
    let cls = '';
    if (v !== '' && v != null) {
      const n = Number(v);
      const after = s.mode === 'count' ? n : cur + n;
      const d = after - cur;
      txt = s.mode === 'count' ? (d === 0 ? '✓ same' : (d > 0 ? '+' : '') + d) : `→ ${after}`;
      cls = d > 0 ? 'up' : d < 0 ? 'down' : 'same';
    }
    deltaEl.textContent = txt;
    deltaEl.className = 'cr-delta ' + cls;
    row.classList.toggle('filled', v !== '' && v != null);
  }
  const st = countStatus(s, p);
  const btn = $('#count-save');
  btn.disabled = !st.ready;
  btn.textContent = st.label;
}

function countDirty(s) {
  return Object.values(s.values).some((v) => v !== '' && v != null);
}

async function saveCount() {
  const s = state.sheet;
  const p = prod(s.productId);
  if (!countStatus(s, p).ready) return;
  const ts = Date.now();
  const events = [];
  for (const sz of sizesFor(p)) {
    const v = s.values[sz];
    if (v === '' || v == null) continue;
    const n = Number(v);
    const cur = p.stock[sz] || 0;
    const delta = s.mode === 'count' ? n - cur : n;
    if (delta === 0) continue;
    events.push({
      id: uid(), ts, type: s.mode === 'count' ? 'count' : 'restock', productId: p.id, productName: p.name,
      kind: p.kind, size: sz, delta, from: cur, to: cur + delta,
    });
    p.stock[sz] = cur + delta;
  }
  if (s.mode === 'count') p.lastCountAt = ts;
  await persist({ products: [p], events });
  state.events.push(...events);
  state.sheet = null;
  render();
  if (s.mode === 'count') {
    toast(events.length ? `Count saved · ${plural(events.length, 'size')} adjusted` : 'Count matches, nothing changed', events.length ? { label: 'Undo', fn: () => removeEvents(events.map((e) => e.id)) } : null);
  } else {
    toast(`Added ${events.reduce((a, e) => a + e.delta, 0)} to stock`, { label: 'Undo', fn: () => removeEvents(events.map((e) => e.id)) });
  }
}

/* ---------- designs ---------- */

function newDraft() {
  return { name: '', kind: 'tee', price: '', image: null, initial: {} };
}

async function resizeImage(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parsePrice(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

async function saveProduct() {
  const s = state.sheet;
  const d = s.draft;
  const name = d.name.trim();
  if (!name) {
    alert('Please give the design a name.');
    return;
  }
  if (s.productId) {
    const p = prod(s.productId);
    Object.assign(p, { name, price: parsePrice(d.price), image: d.image });
    await persist({ products: [p] });
    toast('Design updated');
  } else {
    const ts = Date.now();
    const p = { id: uid(), name, kind: d.kind, price: parsePrice(d.price), image: d.image, stock: {}, createdAt: ts };
    const events = [];
    for (const sz of sizesFor(p)) {
      const n = parseInt(d.initial[sz], 10) || 0;
      p.stock[sz] = Math.max(0, n);
      if (n > 0) {
        events.push({ id: uid(), ts, type: 'restock', productId: p.id, productName: name, kind: p.kind, size: sz, delta: n, from: 0, to: n });
      }
    }
    await persist({ products: [p], events });
    state.products.push(p);
    state.events.push(...events);
    toast('Design added');
  }
  closeSheet();
}

async function deleteProduct() {
  const p = prod(state.sheet.productId);
  if (!confirm(`Delete "${p.name}"?\n\nIts sales stay in your stats and history.`)) return;
  await persist({ deleteProducts: [p.id] });
  state.products = state.products.filter((x) => x.id !== p.id);
  state.basket = state.basket.filter((l) => l.productId !== p.id);
  saveBasket();
  closeSheet();
  toast('Design deleted');
}

/* ---------- backup / export ---------- */

async function shareOrDownload(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function exportJSON() {
  const data = {
    app: 'tee-inventory', version: 1, exportedAt: new Date().toISOString(),
    settings: { currency: currency() }, products: state.products, events: state.events,
  };
  shareOrDownload(`tee-inventory-backup-${stamp()}.json`, JSON.stringify(data), 'application/json');
}

function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'type', 'design', 'kind', 'size', 'change', 'unit_price', 'sale_id']];
  for (const e of state.events) {
    rows.push([
      new Date(e.ts).toISOString(), e.type, e.productName, e.kind, sizeLabel(e.size), e.delta,
      e.type === 'sale' ? e.price || '' : '', e.saleId || '',
    ]);
  }
  shareOrDownload(`tee-inventory-history-${stamp()}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'tee-inventory' || !Array.isArray(data.products) || !Array.isArray(data.events)) {
        throw new Error('This is not a Tee Inventory backup file.');
      }
      if (!confirm(`Replace everything on this device with the backup from ${data.exportedAt?.slice(0, 10) || 'file'}?\n\n${plural(data.products.length, 'design')}, ${plural(data.events.length, 'history entry')}.`)) return;
      await db.replaceAll(data);
      if (data.settings?.currency) lsSet('tee-currency', data.settings.currency);
      state.basket = [];
      saveBasket();
      await load();
      render();
      toast('Backup restored');
    } catch (err) {
      alert('Import failed: ' + (err?.message || err));
    }
  };
  input.click();
}

/* ---------- event wiring ---------- */

const ACTIONS = {
  tab: (el) => {
    state.tab = el.dataset.tab;
    lsSet('tee-tab', state.tab);
    state.sheet = null;
    render();
    window.scrollTo(0, 0);
  },
  'close-sheet': () => {
    if (state.sheet?.type === 'count' && countDirty(state.sheet) && !confirm('Discard this count? Nothing has been saved.')) return;
    closeSheet();
  },
  'toast-action': () => {
    $('#toast').classList.remove('show');
    toast.action?.();
    toast.action = null;
  },
  'go-new-product': () => {
    state.tab = 'products';
    lsSet('tee-tab', state.tab);
    render();
    openSheet({ type: 'edit', productId: null, draft: newDraft() });
  },

  // sell
  'open-sell': (el) => openSheet({ type: 'sell', productId: el.dataset.id }),
  'add-basket': (el) => addToBasket(el.dataset.id, el.dataset.size),
  'clear-product-basket': (el) => {
    state.basket = state.basket.filter((l) => l.productId !== el.dataset.id);
    saveBasket();
    renderSheet();
  },
  'open-basket': () => openSheet({ type: 'basket' }),
  'basket-step': (el) => {
    const line = state.basket[+el.dataset.i];
    if (!line) return;
    line.qty += +el.dataset.d;
    if (line.qty <= 0) state.basket.splice(+el.dataset.i, 1);
    saveBasket();
    renderSheet();
  },
  'clear-basket': () => {
    if (!confirm('Clear the current sale?')) return;
    state.basket = [];
    saveBasket();
    closeSheet();
  },
  'complete-sale': () => completeSale(),

  // stock
  'open-count': (el) => openSheet({ type: 'count', productId: el.dataset.id, mode: 'count', values: {} }),
  'count-mode': (el) => {
    const s = state.sheet;
    if (s.mode === el.dataset.mode) return;
    if (countDirty(s) && !confirm('Switch mode? The numbers you entered will be cleared.')) return;
    s.mode = el.dataset.mode;
    s.values = {};
    renderSheet();
  },
  step: (el) => {
    const s = state.sheet;
    const p = prod(s.productId);
    const sz = el.dataset.size;
    const v = s.values[sz];
    const base = v === '' || v == null ? (s.mode === 'count' ? Math.max(0, p.stock[sz] || 0) : 0) : Number(v);
    const n = Math.max(0, base + Number(el.dataset.d));
    s.values[sz] = String(n);
    document.querySelector(`[data-count="${sz}"]`).value = n;
    updateCountUI();
  },
  'fill-unchanged': () => {
    const s = state.sheet;
    const p = prod(s.productId);
    for (const sz of sizesFor(p)) {
      if (s.values[sz] === '' || s.values[sz] == null) s.values[sz] = String(Math.max(0, p.stock[sz] || 0));
    }
    renderSheet();
  },
  'save-count': () => saveCount(),

  // designs
  'new-product': () => openSheet({ type: 'edit', productId: null, draft: newDraft() }),
  'edit-product': (el) => {
    const p = prod(el.dataset.id);
    openSheet({
      type: 'edit', productId: p.id,
      draft: { name: p.name, kind: p.kind, price: p.price || '', image: p.image, initial: {} },
    });
  },
  'set-kind': (el) => {
    state.sheet.draft.kind = el.dataset.kind;
    state.sheet.draft.initial = {};
    renderSheet();
  },
  'remove-photo': () => {
    state.sheet.draft.image = null;
    renderSheet();
  },
  'save-product': () => saveProduct(),
  'delete-product': () => deleteProduct(),
  'export-json': exportJSON,
  'export-csv': exportCSV,
  'import-json': importJSON,

  // stats
  period: (el) => {
    state.period = el.dataset.period;
    render();
  },
  'delete-event': (el) => {
    const e = state.events.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const what = `${TYPE_LABEL[e.type]}: ${e.productName} ${sizeLabel(e.size)} (${e.delta > 0 ? '+' : ''}${e.delta})`;
    if (!confirm(`Undo this entry?\n\n${what}\n\nStock will be adjusted back.`)) return;
    removeEvents([e.id]);
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) {
    ev.preventDefault();
    Promise.resolve(fn(el)).catch((err) => console.error(err));
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  const s = state.sheet;
  if (t.dataset.field && s?.type === 'edit') {
    s.draft[t.dataset.field] = t.value;
  } else if (t.dataset.init && s?.type === 'edit') {
    s.draft.initial[t.dataset.init] = t.value.replace(/\D/g, '');
    if (t.value !== s.draft.initial[t.dataset.init]) t.value = s.draft.initial[t.dataset.init];
  } else if (t.dataset.count && s?.type === 'count') {
    const clean = t.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (clean !== t.value) t.value = clean;
    s.values[t.dataset.count] = clean;
    updateCountUI();
  } else if (t.dataset.setting === 'currency') {
    lsSet('tee-currency', t.value);
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.matches('[data-photo]') && t.files?.[0] && state.sheet?.type === 'edit') {
    try {
      state.sheet.draft.image = await resizeImage(t.files[0]);
      renderSheet();
    } catch (err) {
      alert(err.message || err);
    }
  }
});

// Select the whole number when tapping a count field, so typing replaces it.
document.addEventListener('focusin', (ev) => {
  if (ev.target.matches('input[data-count], input[data-init]')) setTimeout(() => ev.target.select(), 0);
});

/* ---------- start ---------- */

(async function start() {
  if (!TITLES[state.tab]) state.tab = 'sell';
  try {
    await load();
  } catch (err) {
    $('#view').innerHTML = `<p class="hint">Could not open storage: ${esc(err?.message || err)}</p>`;
    return;
  }
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
