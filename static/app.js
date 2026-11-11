const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmt = (n, d = 2) => n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n) => n == null ? "–" : n.toLocaleString("en-US");
const fmtCap = (n) => {
  if (n == null) return "–";
  for (const [div, unit] of [[1e12, "T"], [1e9, "B"], [1e6, "M"]]) if (n >= div) return "$" + (n / div).toFixed(2) + unit;
  return "$" + fmtInt(n);
};
const pct = (n) => n == null ? "–" : (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const dir = (n) => n == null ? "" : n >= 0 ? "up" : "down";

async function api(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
  return body;
}

/* ---------- Tabs ---------- */
function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
}
$$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

/* ---------- Stocks tab ---------- */
let currentPeriod = "6mo";

async function loadSectors() {
  const sectors = await api("/api/sectors");
  const chips = $("#sector-chips");
  chips.innerHTML = "";
  sectors.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (i === 0 ? " active" : "");
    b.textContent = s.name;
    b.addEventListener("click", () => {
      $$(".chip").forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      loadQuotes(s.key);
    });
    chips.append(b);
  });
  if (sectors.length) loadQuotes(sectors[0].key);
}

async function loadQuotes(key) {
  const tbody = $("#quotes tbody"), status = $("#quotes-status");
  tbody.innerHTML = "";
  status.className = "status";
  status.textContent = "Loading quotes…";
  try {
    const { quotes } = await api(`/api/sectors/${key}/quotes`);
    status.textContent = "";
    for (const q of quotes) {
      const tr = document.createElement("tr");
      tr.innerHTML = q.error
        ? `<td><strong>${q.ticker}</strong></td><td colspan="5" class="status">unavailable</td>`
        : `<td><strong>${q.ticker}</strong></td>
           <td class="num">$${fmt(q.price)}</td>
           <td class="num ${dir(q.changePct)}">${pct(q.changePct)}</td>
           <td class="num">${fmtCap(q.marketCap)}</td>
           <td class="num">${fmt(q.yearLow)} – ${fmt(q.yearHigh)}</td>
           <td class="num"><button class="link" data-options="${q.ticker}">Options</button></td>`;
      tr.addEventListener("click", (e) => {
        if (e.target.dataset.options) return openOptions(e.target.dataset.options);
        $$("#quotes tbody tr").forEach((r) => r.classList.remove("selected"));
        tr.classList.add("selected");
        loadDetail(q.ticker);
      });
      tbody.append(tr);
    }
  } catch (err) {
    status.className = "status error";
    status.textContent = err.message;
  }
}

async function loadDetail(ticker) {
  const el = $("#detail");
  el.innerHTML = `<p class="status">Loading ${ticker}…</p>`;
  try {
    const { quote: q, history } = await api(`/api/stocks/${ticker}?period=${currentPeriod}`);
    const periods = ["1mo", "3mo", "6mo", "1y", "5y"];
    el.innerHTML = `
      <h2>${ticker}</h2>
      <div><span class="big">$${fmt(q.price)}</span> <span class="${dir(q.changePct)}">${pct(q.changePct)}</span></div>
      <div class="periods">${periods.map((p) => `<button class="${p === currentPeriod ? "active" : ""}" data-period="${p}">${p}</button>`).join("")}</div>
      <canvas></canvas>
      <div class="stats">
        <div><span>Day range</span><br>${fmt(q.dayLow)} – ${fmt(q.dayHigh)}</div>
        <div><span>52-week range</span><br>${fmt(q.yearLow)} – ${fmt(q.yearHigh)}</div>
        <div><span>Market cap</span><br>${fmtCap(q.marketCap)}</div>
        <div><span>Volume</span><br>${fmtInt(q.volume)}</div>
      </div>`;
    $$("[data-period]", el).forEach((b) => b.addEventListener("click", () => { currentPeriod = b.dataset.period; loadDetail(ticker); }));
    drawChart($("canvas", el), history.map((h) => h.close).filter((v) => v != null));
  } catch (err) {
    el.innerHTML = `<p class="status error">${err.message}</p>`;
  }
}

function drawChart(canvas, values) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  if (values.length < 2) return;
  const min = Math.min(...values), max = Math.max(...values), pad = 6;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => pad + (1 - (v - min) / (max - min || 1)) * (h - pad * 2);
  const color = values.at(-1) >= values[0] ? "#2fbf71" : "#ef5b5b";
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color; ctx.lineWidth = 1.75; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill();
}

/* ---------- Options tab ---------- */
let currentTerm = "short";

function openOptions(ticker) {
  $("#options-ticker").value = ticker;
  showTab("options");
  loadOptions();
}

$$(".seg").forEach((b) => b.addEventListener("click", () => {
  $$(".seg").forEach((s) => s.classList.remove("active"));
  b.classList.add("active");
  currentTerm = b.dataset.term;
  loadOptions();
}));
$("#options-form").addEventListener("submit", (e) => { e.preventDefault(); loadOptions(); });

async function loadOptions() {
  const ticker = $("#options-ticker").value.trim().toUpperCase();
  const out = $("#options-results");
  if (!ticker) return;
  out.innerHTML = `<p class="status">Loading ${ticker} calls…</p>`;
  try {
    const data = await api(`/api/options/${encodeURIComponent(ticker)}/calls?term=${currentTerm}`);
    if (!data.expirations.length) {
      out.innerHTML = `<p class="status">No ${currentTerm}-term call expirations listed for ${ticker}.</p>`;
      return;
    }
    out.innerHTML = `<p class="status">${ticker} last price: <strong>$${fmt(data.spot)}</strong>. Highlighted rows are in the money.</p>` +
      data.expirations.map((g) => `
        <div class="card expiry">
          <h2>${g.expiration} <span class="status">· ${g.daysToExpiry} days</span></h2>
          <table>
            <thead><tr><th class="num">Strike</th><th class="num">Last</th><th class="num">Bid</th><th class="num">Ask</th>
              <th class="num">Breakeven</th><th class="num">Volume</th><th class="num">Open int.</th><th class="num">Implied vol</th></tr></thead>
            <tbody>${g.contracts.map((c) => `
              <tr class="${c.inTheMoney ? "itm" : ""}" title="${c.contract || ""}">
                <td class="num"><strong>${fmt(c.strike)}</strong></td><td class="num">${fmt(c.last)}</td>
                <td class="num">${fmt(c.bid)}</td><td class="num">${fmt(c.ask)}</td>
                <td class="num">${fmt(c.breakeven)}</td><td class="num">${fmtInt(c.volume)}</td>
                <td class="num">${fmtInt(c.openInterest)}</td><td class="num">${c.impliedVol == null ? "–" : c.impliedVol + "%"}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>`).join("");
  } catch (err) {
    out.innerHTML = `<p class="status error">${err.message}</p>`;
  }
}

loadSectors().catch((err) => { $("#quotes-status").className = "status error"; $("#quotes-status").textContent = err.message; });
