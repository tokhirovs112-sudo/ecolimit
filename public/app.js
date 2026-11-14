/* EcoLimit frontend — vanilla JS SPA */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const pct = (n, d = 1) => ((Number(n) || 0) * 100).toFixed(d) + "%";
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const monthName = (m) => { const [y, mo] = m.split("-"); return `${MONTHS[+mo - 1]} ${y}`; };
const monthShort = (m) => MONTHS[+m.split("-")[1] - 1].slice(0, 3);
const shiftMonth = (m, k) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };
const STATUS = { ok: ["ok", "Limit doirasida"], warn: ["warn", "Limitga yaqin"], bad: ["bad", "Limitdan oshish xavfi"] };
const ISSUE_CLS = { "Yangi": "bad", "Ko'rib chiqilmoqda": "warn", "Hal qilindi": "ok" };
const REQ = { pending: ["warn", "Kutilmoqda"], approved: ["ok", "Tasdiqlangan"], rejected: ["bad", "Rad etilgan"] };
const CATS = ["Limit hisobi noto'g'ri", "Qo'shimcha limit so'rovi", "Hisobotdagi xato", "Ish vaqti jadvali", "Login / parol", "Texnik muammo (sayt)", "Boshqa"];

let ME = null, TG = "saidalokhonn", charts = [];

/* ------------------------------ API ------------------------------ */
async function api(path, opts = {}) {
  const o = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined) { o.headers["content-type"] = "application/json"; o.body = JSON.stringify(opts.body); }
  else if (o.method !== "GET") { o.headers["content-type"] = "application/json"; o.body = "{}"; }
  let r;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), opts.timeout || 20000);
  o.signal = ctl.signal;
  try { r = await fetch("/api/" + path, o); }
  catch { throw new Error("Server bilan aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring"); }
  finally { clearTimeout(tm); }
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== "login" && ME) { ME = null; boot(); throw new Error("Sessiya tugadi"); }
  if (!r.ok) throw new Error(data.error || "Xatolik (" + r.status + ")");
  return data;
}
function toast(t) {
  const d = document.createElement("div"); d.className = "toast"; d.textContent = t;
  document.body.appendChild(d); setTimeout(() => d.remove(), 3000);
}
function setMsg(el, text, ok) { el.className = "msg " + (ok ? "ok" : "bad"); el.textContent = text; }
async function withBtn(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}
function modal(html, onMount) {
  const bg = document.createElement("div"); bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  document.body.appendChild(bg);
  $$("[data-close]", bg).forEach((b) => (b.onclick = close));
  onMount && onMount(bg, close);
  const f = $("input,select,textarea", bg); f && f.focus();
}
function confirmBox(text, okLabel = "Ha") {
  return new Promise((res) => modal(`<h3>Tasdiqlang</h3><p class="note" style="margin-top:8px">${esc(text)}</p>
    <div class="acts"><button class="ghost" data-close>Bekor qilish</button><button class="btn red sm" id="cy">${esc(okLabel)}</button></div>`,
    (bg, close) => { $("#cy", bg).onclick = () => { close(); res(true); }; $$("[data-close]", bg).forEach((b) => b.addEventListener("click", () => res(false))); }));
}
function killCharts() { charts.forEach((c) => c.destroy()); charts = []; }
function chart(el, cfg) {
  if (!window.Chart) return;
  Chart.defaults.font.family = "Manrope, system-ui, sans-serif";
  charts.push(new Chart(el, cfg));
}

/* ------------------------------ boot ------------------------------ */
async function boot() {
  killCharts();
  try {
    const st = await api("status");
    TG = st.telegram || TG;
    if (st.needsSetup) return renderSetup();
  } catch (e) {
    $("#root").innerHTML = `<div class="loading">⚠ ${esc(e.message)}<br><span class="note">D1 baza ulanganini va migratsiya bajarilganini tekshiring.</span></div>`;
    return;
  }
  try { ME = await api("me"); TG = ME.telegram || TG; } catch { ME = null; }
  if (!ME) return renderLogin();
  renderShell();
  window.onhashchange = route;
  route();
}

const HERO = `<div class="hero">
  <a class="logo" href="#"><i></i>EcoLimit</a>
  <div>
    <h1>Havo ifloslanishini oldindan tahlil qilib, oldini olamiz.</h1>
    <p>Har bir korxonaga mahsulotiga bo'lgan talab va limitdan haqiqiy foydalanishini hisobga olib, individual CO₂ limiti ajratiladi.</p>
    <div class="pts">
      <div><b>1</b>Katta talabli kompaniyalar — odamlar ehtiyoji qondirilishi uchun yetarli limit.</div>
      <div><b>2</b>Kichik kompaniyalar — ishlata olmaydigan ortiqcha limit berilmaydi, tahlil aniq bo'ladi.</div>
      <div><b>3</b>Ajratilgan ish vaqtlari — emissiya grafigi oldindan ma'lum.</div>
    </div>
  </div>
  <div style="font-size:12px;opacity:.6">© EcoLimit</div>
</div>`;
const tgLink = () => `<a href="https://t.me/${esc(TG)}" target="_blank" rel="noopener" style="font-weight:700">@${esc(TG)}</a>`;

function renderSetup() {
  $("#root").innerHTML = `<section id="auth">${HERO}<div class="authform"><div>
    <h2>Birinchi sozlash</h2>
    <div class="sub">Tizimda hali administrator yo'q. Regulyator (admin) akkauntini yarating.</div>
    <form id="sf">
      <label for="su">Admin login</label><input id="su" autocomplete="username" required minlength="3" maxlength="32" placeholder="admin">
      <label for="sp">Parol (kamida 8 belgi)</label><input id="sp" type="password" autocomplete="new-password" required minlength="8">
      <label for="sp2">Parolni takrorlang</label><input id="sp2" type="password" autocomplete="new-password" required minlength="8">
      <button class="btn full">Admin yaratish</button><div class="msg" id="sm"></div>
    </form></div></div></section>`;
  $("#sf").onsubmit = (e) => {
    e.preventDefault();
    if ($("#sp").value !== $("#sp2").value) return setMsg($("#sm"), "Parollar mos emas");
    withBtn($("#sf .btn"), async () => {
      try { await api("setup", { method: "POST", body: { login: $("#su").value.trim(), password: $("#sp").value } }); location.hash = ""; boot(); }
      catch (er) { setMsg($("#sm"), er.message); }
    });
  };
}

function renderLogin() {
  $("#root").innerHTML = `<section id="auth">${HERO}<div class="authform"><div>
    <h2>Tizimga kirish</h2>
    <div class="sub">Korxonangizga ajratilgan login va parolni kiriting</div>
    <form id="lf">
      <label for="lu">Login</label><input id="lu" autocomplete="username" required placeholder="masalan: ZAV-001">
      <label for="lp">Parol</label><input id="lp" type="password" autocomplete="current-password" required placeholder="••••••••">
      <button class="btn full">Kirish</button><div class="msg" id="lm"></div>
    </form>
    <p class="note" style="margin-top:24px">Login berilmaganmi yoki kirishda muammo bormi? Telegram: ${tgLink()}</p>
  </div></div></section>`;
  $("#lf").onsubmit = (e) => {
    e.preventDefault();
    withBtn($("#lf .btn"), async () => {
      try { await api("login", { method: "POST", body: { login: $("#lu").value.trim(), password: $("#lp").value } }); location.hash = ""; boot(); }
      catch (er) { setMsg($("#lm"), er.message); }
    });
  };
}

/* ------------------------------ shell ------------------------------ */
const NAV = {
  factory: [["home", "Bosh sahifa"], ["issues", "Muammolar"], ["account", "Akkaunt"]],
  admin: [["overview", "Umumiy"], ["factories", "Korxonalar"], ["reports", "Hisobotlar"], ["requests", "So'rovlar"], ["issues", "Muammolar"], ["settings", "Sozlamalar"]],
};
function renderShell() {
  const who = ME.role === "admin" ? `<b>Regulyator</b> · <span class="mono">${esc(ME.login)}</span>` : `<b>${esc(ME.factory?.name || "")}</b> · <span class="mono">${esc(ME.factory?.id || "")}</span>`;
  $("#root").innerHTML = `<header>
    <a class="logo" href="#"><i></i>EcoLimit</a>
    <nav class="top">${NAV[ME.role].map(([k, t]) => `<a href="#${k}" data-k="${k}">${t}<span class="badge hidden" data-badge="${k}"></span></a>`).join("")}</nav>
    <div class="who"><span>${who}</span><button class="logout" id="logout">⎋ Chiqish</button></div>
  </header><main id="view"></main>`;
  $("#logout").onclick = () => {
    const b = $("#logout"); b.disabled = true; b.textContent = "Chiqilmoqda…";
    ME = null;
    location.replace("/api/logout"); // server cookie'ni o'chiradi va bosh sahifaga qaytaradi
  };
}
function badge(k, n) { const b = $(`[data-badge="${k}"]`); if (!b) return; b.textContent = n; b.classList.toggle("hidden", !n); }

async function route() {
  if (!ME) return;
  killCharts();
  const list = NAV[ME.role].map((x) => x[0]);
  let k = location.hash.slice(1);
  if (ME.role === "admin" && k === "account") k = "settings";
  if (!list.includes(k)) k = list[0];
  $$("nav.top a").forEach((a) => a.classList.toggle("act", a.dataset.k === k));
  const v = $("#view");
  v.innerHTML = `<div class="loading">Yuklanmoqda…</div>`;
  const views = ME.role === "admin"
    ? { overview: adminOverview, factories: adminFactories, reports: adminReports, requests: adminRequests, issues: issuesView, settings: adminSettings }
    : { home: factoryHome, issues: issuesView, account: accountView };
  try { await views[k](v); }
  catch (e) { v.innerHTML = `<div class="card empty">⚠ ${esc(e.message)}</div>`; }
}

/* =========================== FACTORY =========================== */
async function factoryHome(v) {
  const d = await api("dashboard");
  const f = d.factory;
  const total = d.limit;
  const usedP = total ? Math.min(100, (d.used / total) * 100) : 0;
  const foreP = total ? Math.min(100, (d.forecast / total) * 100) : 0;
  const [cls, txt] = STATUS[d.status];
  const col = cls === "ok" ? "var(--green2)" : cls === "warn" ? "var(--amber)" : "var(--red)";
  const hist = d.history.filter((h) => h.month < d.month);
  const first = hist[0]?.co2, last = hist.at(-1)?.co2, prev = hist.at(-2)?.co2;
  const prog = first && last ? ((first - last) / first) * 100 : null;
  const chg = prev && last ? ((last - prev) / prev) * 100 : null;
  const maxExtra = (d.base_limit * d.tiers.at(-1).upto) / 100;
  const slots = Array.from({ length: 24 }, (_, h) => `<div class="${h >= f.hour_start && h < f.hour_end ? "on" : ""}" title="${h}:00"></div>`).join("");
  const pendingReq = d.requests.filter((r) => r.status === "pending").length;

  v.innerHTML = `
  <div class="title"><div><h2>${esc(f.name)}</h2><p>${esc(f.sector || "—")} · ${esc(f.size)} korxona · ${monthName(d.month)}, ${d.day}-kun holati${d.updated_at ? " · hisobot yangilangan: " + esc(d.updated_at.slice(0, 16)) : ""}</p></div>
    <span class="tag ${cls}">${txt}</span></div>
  ${d.finalized ? "" : `<div class="card note" style="margin-bottom:18px;background:#fffaf0;border-color:#f1e1bd">ℹ ${monthName(d.month)} limitlari regulyator tomonidan hali tasdiqlanmagan — ko'rsatilgan limit dastlabki hisob.</div>`}
  <div class="grid g4">
    <div class="card kpi"><div class="l">Oylik limit</div><div class="v">${fmt(total)} <small>t CO₂</small></div>
      <div class="d">${d.approved ? `asosiy ${fmt(d.base_limit)} + qo'shimcha ${fmt(d.approved)}` : "individual ajratilgan"}</div></div>
    <div class="card kpi"><div class="l">Ishlatildi</div><div class="v">${fmt(d.used)} <small>t</small></div>
      <div class="d">${usedP.toFixed(1)}% · ${d.day}/${d.days} kun</div></div>
    <div class="card kpi"><div class="l">Qoldiq</div><div class="v">${fmt(Math.max(0, total - d.used))} <small>t</small></div>
      <div class="d">Oy oxiri prognozi: ${fmt(d.forecast)} t</div></div>
    <div class="card kpi"><div class="l">Progress (${hist.length} oy)</div>
      <div class="v" style="color:${prog == null ? "var(--mute)" : prog >= 0 ? "var(--green)" : "var(--red)"}">${prog == null ? "—" : (prog > 0.05 ? "−" : prog < -0.05 ? "+" : "") + Math.abs(prog).toFixed(1) + "%"}</div>
      <div class="d">${chg == null ? "Ma'lumot yetarli emas" : `Oxirgi oy: ${chg > 0 ? "+" : ""}${chg.toFixed(1)}% o'tgan oyga nisbatan`}</div></div>
  </div>

  <div class="card mt">
    <h3>Limitdan foydalanish <small>to'q — ishlatilgan, och — oy oxiri prognozi</small></h3>
    <div class="bar"><div style="width:${foreP}%;background:${col};opacity:.25"></div><div style="width:${usedP}%;background:${col}"></div></div>
    <div class="row"><span>0 t</span><span>${fmt(total)} t</span></div>
  </div>

  <div class="grid g2 mt">
    <div class="card"><h3>Oxirgi hisobot: CO₂ chiqarish <small>tonna / oy</small></h3>
      ${d.history.length ? `<canvas id="ch" height="140"></canvas>` : `<div class="empty">Hali hisobot kiritilmagan</div>`}</div>
    <div class="card"><h3>Qo'shimcha limit narxlari</h3>
      <div class="tbl"><table><tr><th>Bosqich</th><th class="num">Narx, $/t</th><th class="num">Hajm, t</th></tr>
      ${d.tiers.map((t, i) => { const lo = i ? d.tiers[i - 1].upto : 0; return `<tr><td>${lo}–${t.upto}%</td><td class="num">${fmt(t.price, 2)}</td><td class="num">${fmt((d.base_limit * (t.upto - lo)) / 100)}</td></tr>`; }).join("")}
      <tr><td>${d.tiers.at(-1).upto}% dan ortiq</td><td class="num" colspan="2" style="color:var(--red)">ruxsat berilmaydi</td></tr>
      </table></div>
      <form class="buy" id="bf"><div><label for="ex" style="margin-top:6px;color:var(--ink)">Qancha kerak (tonna)</label>
        <input id="ex" type="number" min="1" step="1" inputmode="numeric" value="${Math.max(100, Math.ceil(Math.max(0, d.forecast - total) / 100) * 100)}"></div>
        <button class="btn">So'rov yuborish</button></form>
      <div class="msg" id="exMsg"></div>
      <p class="note" style="margin-top:6px">Maksimum: ${fmt(Math.max(0, maxExtra - d.approved - d.pending))} t qoldi${d.pending ? ` · ${fmt(d.pending)} t kutilmoqda` : ""}. So'rov regulyator tasdiqlagach limitga qo'shiladi.</p>
    </div>
  </div>

  <div class="grid g2e mt">
    <div class="card"><h3>Ajratilgan ish vaqti <small>${f.hour_start}:00 – ${f.hour_end}:00</small></h3>
      <div class="slots">${slots}</div><div class="hrs">${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 == 0 ? h : ""}</span>`).join("")}</div>
      <p class="note" style="margin-top:12px">Belgilangan vaqtlarda ishlash emissiya grafigini oldindan ma'lum qiladi va hudud bo'yicha prognoz aniqligini oshiradi.</p></div>
    <div class="card"><h3>Limit qanday hisoblandi</h3>
      <div class="formula">Mahsulotga talab: <b>${fmt(f.demand)}</b> birlik/oy<br>
      Limitdan foydalanish koeffitsienti: <b>${pct(d.util, 0)}</b><br>
      Ball = talab × koeffitsient = <b>${fmt(d.score)}</b><br>
      Hudud umumiy limitidagi ulush: <b>${pct(d.share)}</b> (${fmt(d.total_cap)} t dan)</div>
      <p class="note">${d.util < 0.7 ? "Oldingi oylarda limitingizning katta qismi ishlatilmagan, shuning uchun limit haqiqiy ehtiyojga moslashtirildi." : "Limitdan yaxshi foydalanasiz — limit talabni qondirish darajasida saqlangan."}</p></div>
  </div>

  <div class="card mt"><h3>Qo'shimcha limit so'rovlari ${pendingReq ? `<span class="tag warn">${pendingReq} kutilmoqda</span>` : ""}</h3>
    ${d.requests.length ? `<div class="tbl"><table><tr><th>Sana</th><th>Oy</th><th class="num">Hajm, t</th><th class="num">Narx, $</th><th>Holat</th></tr>
      ${d.requests.map((r) => `<tr><td>${esc(r.created_at.slice(0, 16))}</td><td>${monthName(r.month)}</td><td class="num">${fmt(r.tons)}</td><td class="num">${fmt(r.cost, 2)}</td><td><span class="tag ${REQ[r.status][0]}">${REQ[r.status][1]}</span></td></tr>`).join("")}
    </table></div>` : `<div class="empty">So'rovlar yo'q</div>`}</div>`;

  if (d.history.length) {
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(d.month, i - 5));
    const by = Object.fromEntries(d.history.map((h) => [h.month, h]));
    chart($("#ch"), {
      type: "bar",
      data: {
        labels: months.map((m) => monthShort(m) + (m === d.month ? " (prog.)" : "")),
        datasets: [
          { label: "CO₂, t", data: months.map((m) => (m === d.month ? d.forecast : by[m]?.co2 ?? null)), backgroundColor: months.map((m) => (m === d.month ? "rgba(47,163,107,.35)" : "#2fa36b")), borderRadius: 6 },
          { type: "line", label: "Limit", data: months.map((m) => (m === d.month ? total : by[m]?.base_limit != null ? by[m].base_limit + by[m].extra : null)), borderColor: "#c2412d", borderDash: [5, 4], pointRadius: 3, borderWidth: 2, spanGaps: true },
        ],
      },
      options: { plugins: { legend: { labels: { boxWidth: 12 } } }, scales: { y: { beginAtZero: true, grid: { color: "#eef1ec" } }, x: { grid: { display: false } } } },
    });
  }

  let qt;
  const quote = () => {
    clearTimeout(qt);
    qt = setTimeout(async () => {
      const t = +$("#ex").value;
      if (!(t > 0)) return setMsg($("#exMsg"), "Hajmni kiriting");
      try {
        const q = await api("extra/quote", { method: "POST", body: { tons: t } });
        if (q.cost == null) setMsg($("#exMsg"), `Bu hajm chegaradan oshadi (maks. ${fmt(q.max)} t)`);
        else { $("#exMsg").className = "msg"; $("#exMsg").style.color = "var(--mute)"; $("#exMsg").textContent = `Taxminiy narx: $${fmt(q.cost, 2)}`; }
      } catch (e) { setMsg($("#exMsg"), e.message); }
    }, 250);
  };
  $("#ex").oninput = quote; quote();
  $("#bf").onsubmit = (e) => {
    e.preventDefault();
    withBtn($("#bf .btn"), async () => {
      try { const r = await api("extra", { method: "POST", body: { tons: +$("#ex").value } }); toast(`So'rov yuborildi ($${fmt(r.cost, 2)})`); route(); }
      catch (er) { $("#exMsg").style.color = ""; setMsg($("#exMsg"), er.message); }
    });
  };
}

function accountView(v) {
  v.innerHTML = `<div class="title"><div><h2>Akkaunt</h2><p>Login: <span class="mono">${esc(ME.login)}</span></p></div></div>
  <div class="grid g2e"><div class="card"><h3>Parolni o'zgartirish</h3>
    <form id="pf"><label for="po">Joriy parol</label><input id="po" type="password" autocomplete="current-password" required>
    <label for="pn">Yangi parol (kamida 8 belgi)</label><input id="pn" type="password" autocomplete="new-password" required minlength="8">
    <label for="pn2">Yangi parolni takrorlang</label><input id="pn2" type="password" autocomplete="new-password" required minlength="8">
    <button class="btn full">Saqlash</button><div class="msg" id="pm"></div></form></div>
    <div>${tgCard()}</div></div>`;
  $("#pf").onsubmit = (e) => {
    e.preventDefault();
    if ($("#pn").value !== $("#pn2").value) return setMsg($("#pm"), "Parollar mos emas");
    withBtn($("#pf .btn"), async () => {
      try { await api("password", { method: "POST", body: { old: $("#po").value, new: $("#pn").value } }); setMsg($("#pm"), "✓ Parol o'zgartirildi", true); $("#pf").reset(); }
      catch (er) { setMsg($("#pm"), er.message); }
    });
  };
}
const tgCard = () => `<a class="tg" href="https://t.me/${esc(TG)}" target="_blank" rel="noopener">
  <div class="ic">✈</div><div><b>@${esc(TG)}</b><br><span>Shoshilinch masala bo'lsa, to'g'ridan-to'g'ri Telegram'da yozing</span></div></a>`;

/* ============================ ISSUES ============================ */
async function issuesView(v) {
  const admin = ME.role === "admin";
  const { issues } = await api("issues");
  const open = issues.filter((i) => i.status !== "Hal qilindi").length;
  badge("issues", open);
  v.innerHTML = `<div class="title"><div><h2>Muammolar</h2><p>${admin ? "Korxonalardan kelgan barcha murojaatlar" : "Muammo haqida yozib qoldiring — regulyator ko'rib chiqadi"}</p></div>
    ${admin ? `<select id="flt" style="width:auto"><option value="">Barchasi (${issues.length})</option>${Object.keys(ISSUE_CLS).map((s) => `<option>${s}</option>`).join("")}</select>` : ""}</div>
  <div class="grid ${admin ? "" : "g2"}">
    <div class="card"><h3>${admin ? "Murojaatlar" : "Mening murojaatlarim"}</h3><div id="il"></div></div>
    ${admin ? "" : `<div><div class="card"><h3>Yangi murojaat</h3>
      <form id="if"><label for="ic">Mavzu</label><select id="ic">${CATS.map((c) => `<option>${c}</option>`).join("")}</select>
      <label for="it">Muammo tavsifi</label><textarea id="it" placeholder="Muammoni batafsil yozing..." maxlength="3000" required></textarea>
      <label for="ik">Aloqa uchun (telefon yoki Telegram, ixtiyoriy)</label><input id="ik" placeholder="+998 ... yoki @username" maxlength="100">
      <button class="btn full">Yuborish</button><div class="msg" id="im"></div></form></div>
      <div class="mt">${tgCard()}</div></div>`}
  </div>`;
  const draw = () => {
    const f = admin ? $("#flt").value : "";
    const list = issues.filter((i) => !f || i.status === f);
    $("#il").innerHTML = list.length ? list.map((i) => `<div class="issue"><div class="h"><b>${esc(i.category)}</b><span class="tag ${ISSUE_CLS[i.status] || "neutral"}">${esc(i.status)}</span></div>
      <p>${esc(i.text)}</p>
      <div class="m">${admin ? `<b>${esc(i.factory || i.factory_id)}</b> · ` : ""}${esc(i.created_at.slice(0, 16))}${i.contact ? " · aloqa: " + esc(i.contact) : ""}</div>
      ${i.admin_note ? `<div class="reply"><b>Regulyator javobi:</b> ${esc(i.admin_note)}</div>` : ""}
      ${admin ? `<div class="acts"><button class="ghost sm" data-ans="${i.id}">Javob / holat</button></div>` : ""}</div>`).join("")
      : `<div class="empty">Murojaatlar yo'q</div>`;
    $$("[data-ans]").forEach((b) => (b.onclick = () => {
      const it = issues.find((x) => x.id == b.dataset.ans);
      modal(`<h3>Murojaat</h3><p class="note">${esc(it.factory || "")} · ${esc(it.category)}</p>
        <label for="ms">Holat</label><select id="ms">${Object.keys(ISSUE_CLS).map((s) => `<option ${s === it.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label for="mn">Javob (korxonaga ko'rinadi)</label><textarea id="mn" maxlength="1000">${esc(it.admin_note)}</textarea>
        <div class="msg" id="mm"></div>
        <div class="acts"><button class="ghost" data-close>Bekor</button><button class="btn sm" id="msv">Saqlash</button></div>`,
        (bg, close) => { $("#msv", bg).onclick = () => withBtn($("#msv", bg), async () => {
          try { await api("admin/issues/" + it.id, { method: "PUT", body: { status: $("#ms", bg).value, admin_note: $("#mn", bg).value } }); close(); route(); }
          catch (e) { setMsg($("#mm", bg), e.message); } }); });
    }));
  };
  draw();
  if (admin) $("#flt").onchange = draw;
  else $("#if").onsubmit = (e) => {
    e.preventDefault();
    withBtn($("#if .btn"), async () => {
      try { await api("issues", { method: "POST", body: { category: $("#ic").value, text: $("#it").value, contact: $("#ik").value } }); toast("Murojaat yuborildi"); route(); }
      catch (er) { setMsg($("#im"), er.message); }
    });
  };
}

/* ============================= ADMIN ============================= */
let adminMonth = null;
async function adminOverview(v) {
  const d = await api("admin/overview" + (adminMonth ? "?month=" + adminMonth : ""));
  adminMonth = d.month;
  badge("requests", d.pending.length); badge("issues", d.openIssues);
  const forecast = d.factories.reduce((s, f) => s + f.forecast, 0);
  const risk = d.factories.filter((f) => f.status !== "ok").length;
  v.innerHTML = `
  <div class="title"><div><h2>Hudud bo'yicha limit taqsimoti</h2><p>${monthName(d.month)} · ${d.finalized ? `<span class="tag ok">Limitlar tasdiqlangan</span>` : `<span class="tag warn">Dastlabki hisob (tasdiqlanmagan)</span>`}</p></div>
    <div class="acts"><input type="month" id="mo" value="${d.month}" style="width:auto">
    ${d.finalized ? `<button class="ghost" id="unfin">Tasdiqni bekor qilish</button><button class="btn" id="fin">Qayta hisoblash</button>` : `<button class="btn" id="fin">Oy limitlarini tasdiqlash</button>`}</div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="l">Umumiy limit</div><div class="v">${fmt(d.total_cap)} <small>t</small></div><div class="d"><a href="#settings">o'zgartirish</a></div></div>
    <div class="card kpi"><div class="l">Oy oxiri prognozi</div><div class="v">${fmt(forecast)} <small>t</small></div><div class="d">${d.total_cap ? pct(forecast / d.total_cap) : "—"} umumiy limitdan</div></div>
    <div class="card kpi"><div class="l">Faol korxonalar</div><div class="v">${d.factories.length}</div><div class="d"><a href="#factories">boshqarish</a></div></div>
    <div class="card kpi"><div class="l">Xavf ostida</div><div class="v" style="color:${risk ? "var(--red)" : "var(--green)"}">${risk}</div><div class="d">${d.pending.length} ta so'rov · ${d.openIssues} ta ochiq murojaat</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><h3>Korxonalar <small>Ball = Talab × Foydalanish</small></h3>
      ${d.factories.length ? `<div class="tbl"><table><tr><th>Korxona</th><th class="num">Talab</th><th class="num">Foydal.</th><th class="num">Limit, t</th><th class="num">Ishlatildi</th><th class="num">Prognoz</th><th>Holat</th></tr>
      ${d.factories.map((f) => `<tr><td><b>${esc(f.name)}</b><br><span class="note mono">${esc(f.id)} · ${esc(f.size)}</span></td><td class="num">${fmt(f.demand)}</td><td class="num">${pct(f.util, 0)}</td>
        <td class="num"><b>${fmt(f.limit)}</b>${f.approved ? `<br><span class="note">+${fmt(f.approved)} qo'sh.</span>` : ""}</td><td class="num">${fmt(f.used)}</td><td class="num">${fmt(f.forecast)}</td><td><span class="tag ${STATUS[f.status][0]}">${STATUS[f.status][1]}</span></td></tr>`).join("")}
      </table></div>` : `<div class="empty">Hali korxona qo'shilmagan. <a href="#factories">Korxona qo'shish →</a></div>`}</div>
    <div class="card"><h3>Algoritm</h3>
      <div class="formula mono" style="font-size:12px">Ball<sub>i</sub> = Talab<sub>i</sub> × Foydalanish<sub>i</sub><br>Limit<sub>i</sub> = UmumiyLimit × Ball<sub>i</sub> / Σ Ball</div>
      <p class="note"><b>Talab</b> — korxona mahsulotiga oylik talab. Katta talab — katta limit, aks holda odamlar ehtiyoji qondirilmaydi.<br><br>
      <b>Foydalanish</b> — oxirgi 3 oyda tasdiqlangan limitning haqiqatda ishlatilgan ulushi (0.3–1.0). Kichik korxona limitni tugata olmasa, ulushi kamayadi va ortiqcha limit boshqalarga o'tadi.<br><br>
      Oy boshida <b>«Oy limitlarini tasdiqlash»</b> tugmasini bosing — limitlar qotiriladi va keyingi oylar uchun foydalanish koeffitsienti shu asosda hisoblanadi.</p>
      ${d.factories.length ? `<canvas id="ch" height="220" style="margin-top:14px"></canvas>` : ""}</div>
  </div>`;
  $("#mo").onchange = (e) => { adminMonth = e.target.value; route(); };
  $("#fin").onclick = async () => {
    if (!(await confirmBox(`${monthName(d.month)} uchun limitlar joriy formula bo'yicha qotiriladi.`, "Tasdiqlash"))) return;
    try { await api("admin/allocate", { method: "POST", body: { month: d.month } }); toast("Limitlar tasdiqlandi"); route(); } catch (e) { toast(e.message); }
  };
  if ($("#unfin")) $("#unfin").onclick = async () => {
    if (!(await confirmBox("Tasdiqlangan limitlar o'chiriladi va dastlabki hisobga qaytiladi.", "Bekor qilish"))) return;
    try { await api("admin/allocate?month=" + d.month, { method: "DELETE" }); route(); } catch (e) { toast(e.message); }
  };
  if (d.factories.length) chart($("#ch"), {
    type: "doughnut",
    data: { labels: d.factories.map((f) => f.name), datasets: [{ data: d.factories.map((f) => f.base_limit), backgroundColor: ["#1f7a4d", "#2fa36b", "#6cc495", "#a8dfc0", "#c7861a", "#e3b866", "#5d6b63", "#9aa7a0", "#22577a", "#38a3a5"], borderWidth: 2 }] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
  });
}

async function adminFactories(v) {
  const d = await api("admin/overview");
  v.innerHTML = `<div class="title"><div><h2>Korxonalar</h2><p>Korxona qo'shish, talab va ish vaqtini o'zgartirish, login/parol berish</p></div>
    <button class="btn" id="add">+ Korxona qo'shish</button></div>
    <div class="card">${d.factories.length ? `<div class="tbl"><table><tr><th>ID</th><th>Nomi</th><th>Soha</th><th>Hajm</th><th class="num">Talab</th><th>Ish vaqti</th><th>Login</th><th></th></tr>
    ${d.factories.map((f) => `<tr><td class="mono">${esc(f.id)}</td><td><b>${esc(f.name)}</b></td><td>${esc(f.sector)}</td><td>${esc(f.size)}</td><td class="num">${fmt(f.demand)}</td><td>${f.hour_start}:00–${f.hour_end}:00</td><td class="mono">${esc(f.login || "—")}</td>
      <td><div class="acts"><button class="ghost sm" data-ed="${esc(f.id)}">Tahrirlash</button><button class="ghost sm" data-pw="${esc(f.id)}">Parol</button><button class="ghost sm" data-del="${esc(f.id)}" style="color:var(--red)">O'chirish</button></div></td></tr>`).join("")}
    </table></div>` : `<div class="empty">Korxonalar yo'q</div>`}</div>`;

  const form = (f = {}) => `
    <div class="frow"><div><label for="fid">ID</label><input id="fid" value="${esc(f.id || "")}" ${f.id ? "disabled" : ""} placeholder="ZAV-001" required></div>
    <div><label for="fsz">Hajm</label><select id="fsz">${["Kichik", "O'rta", "Katta"].map((s) => `<option ${s === f.size ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>
    <label for="fnm">Nomi</label><input id="fnm" value="${esc(f.name || "")}" required>
    <label for="fsc">Soha</label><input id="fsc" value="${esc(f.sector || "")}" placeholder="Sement, metallurgiya...">
    <div class="frow3"><div><label for="fdm">Oylik talab</label><input id="fdm" type="number" min="0" value="${f.demand ?? ""}" required></div>
    <div><label for="fhs">Ish boshl. (soat)</label><input id="fhs" type="number" min="0" max="23" value="${f.hour_start ?? 8}"></div>
    <div><label for="fhe">Tugashi (soat)</label><input id="fhe" type="number" min="1" max="24" value="${f.hour_end ?? 20}"></div></div>`;
  const vals = (bg) => ({ id: $("#fid", bg).value.trim(), name: $("#fnm", bg).value.trim(), sector: $("#fsc", bg).value.trim(), size: $("#fsz", bg).value,
    demand: +$("#fdm", bg).value, hour_start: +$("#fhs", bg).value, hour_end: +$("#fhe", bg).value });

  $("#add").onclick = () => modal(`<h3>Yangi korxona</h3>${form()}
    <div class="frow"><div><label for="flg">Login (bo'sh — ID)</label><input id="flg" autocomplete="off"></div>
    <div><label for="fpw">Parol (kamida 8)</label><input id="fpw" type="text" autocomplete="off" value="${genPass()}"></div></div>
    <p class="note" style="margin-top:8px">Login va parolni korxonaga xavfsiz yo'l bilan bering.</p>
    <div class="msg" id="fm"></div><div class="acts"><button class="ghost" data-close>Bekor</button><button class="btn sm" id="fsv">Qo'shish</button></div>`,
    (bg, close) => { $("#fsv", bg).onclick = () => withBtn($("#fsv", bg), async () => {
      try { await api("admin/factories", { method: "POST", body: { ...vals(bg), login: $("#flg", bg).value.trim(), password: $("#fpw", bg).value } }); close(); toast("Korxona qo'shildi"); route(); }
      catch (e) { setMsg($("#fm", bg), e.message); } }); });

  $$("[data-ed]").forEach((b) => (b.onclick = () => {
    const f = d.factories.find((x) => x.id === b.dataset.ed);
    modal(`<h3>Tahrirlash</h3>${form(f)}<div class="msg" id="fm"></div><div class="acts"><button class="ghost" data-close>Bekor</button><button class="btn sm" id="fsv">Saqlash</button></div>`,
      (bg, close) => { $("#fsv", bg).onclick = () => withBtn($("#fsv", bg), async () => {
        try { await api("admin/factories/" + encodeURIComponent(f.id), { method: "PUT", body: vals(bg) }); close(); toast("Saqlandi"); route(); }
        catch (e) { setMsg($("#fm", bg), e.message); } }); });
  }));
  $$("[data-pw]").forEach((b) => (b.onclick = () => modal(`<h3>Yangi parol: ${esc(b.dataset.pw)}</h3>
    <label for="np">Yangi parol</label><input id="np" type="text" value="${genPass()}" autocomplete="off">
    <div class="msg" id="nm"></div><div class="acts"><button class="ghost" data-close>Bekor</button><button class="btn sm" id="nsv">O'rnatish</button></div>`,
    (bg, close) => { $("#nsv", bg).onclick = () => withBtn($("#nsv", bg), async () => {
      try { await api(`admin/factories/${encodeURIComponent(b.dataset.pw)}/password`, { method: "POST", body: { password: $("#np", bg).value } }); close(); toast("Parol yangilandi"); }
      catch (e) { setMsg($("#nm", bg), e.message); } }); })));
  $$("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox(`${b.dataset.del} va uning barcha hisobotlari, so'rovlari, murojaatlari o'chiriladi. Buni qaytarib bo'lmaydi.`, "O'chirish"))) return;
    try { await api("admin/factories/" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); toast("O'chirildi"); route(); } catch (e) { toast(e.message); }
  }));
}
function genPass() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map((x) => a[x % a.length]).join("");
}

async function adminReports(v) {
  const d = await api("admin/overview");
  if (!d.factories.length) { v.innerHTML = `<div class="card empty">Avval <a href="#factories">korxona qo'shing</a></div>`; return; }
  v.innerHTML = `<div class="title"><div><h2>CO₂ hisobotlari</h2><p>Korxonalarning oylik CO₂ chiqarishini kiriting. Joriy oy uchun — oy boshidan hozirgacha bo'lgan miqdor.</p></div></div>
  <div class="grid g2e">
    <div class="card"><h3>Hisobot kiritish</h3>
      <form id="rf"><label for="rfac">Korxona</label><select id="rfac">${d.factories.map((f) => `<option value="${esc(f.id)}">${esc(f.id)} — ${esc(f.name)}</option>`).join("")}</select>
      <div class="frow"><div><label for="rmo">Oy</label><input id="rmo" type="month" value="${d.current}" required></div>
      <div><label for="rco">CO₂, tonna</label><input id="rco" type="number" min="0" step="0.01" required></div></div>
      <button class="btn full">Saqlash</button><div class="msg" id="rm"></div></form></div>
    <div class="card"><h3>Tarix <small id="rfn"></small></h3><div id="rh"></div></div>
  </div>`;
  const load = async () => {
    const id = $("#rfac").value;
    $("#rfn").textContent = id;
    $("#rh").innerHTML = `<div class="note">Yuklanmoqda…</div>`;
    const { reports } = await api(`admin/factories/${encodeURIComponent(id)}/reports`);
    $("#rh").innerHTML = reports.length ? `<div class="tbl"><table><tr><th>Oy</th><th class="num">CO₂, t</th><th>Yangilangan</th><th></th></tr>
      ${reports.map((r) => `<tr><td>${monthName(r.month)}</td><td class="num">${fmt(r.co2, 2)}</td><td class="note">${esc(r.updated_at.slice(0, 16))}</td>
      <td><div class="acts"><button class="ghost sm" data-e="${r.month}" data-v="${r.co2}">Tahrir</button><button class="ghost sm" data-x="${r.month}" style="color:var(--red)">×</button></div></td></tr>`).join("")}</table></div>`
      : `<div class="empty">Hisobot yo'q</div>`;
    $$("[data-e]", $("#rh")).forEach((b) => (b.onclick = () => { $("#rmo").value = b.dataset.e; $("#rco").value = b.dataset.v; $("#rco").focus(); }));
    $$("[data-x]", $("#rh")).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox(`${monthName(b.dataset.x)} hisoboti o'chiriladi.`, "O'chirish"))) return;
      try { await api(`admin/reports?factory_id=${encodeURIComponent(id)}&month=${b.dataset.x}`, { method: "DELETE" }); load(); } catch (e) { toast(e.message); }
    }));
  };
  $("#rfac").onchange = load; load();
  $("#rf").onsubmit = (e) => {
    e.preventDefault();
    withBtn($("#rf .btn"), async () => {
      try { await api("admin/reports", { method: "PUT", body: { factory_id: $("#rfac").value, month: $("#rmo").value, co2: +$("#rco").value } }); setMsg($("#rm"), "✓ Saqlandi", true); $("#rco").value = ""; load(); }
      catch (er) { setMsg($("#rm"), er.message); }
    });
  };
}

async function adminRequests(v) {
  const d = await api("admin/overview");
  badge("requests", d.pending.length);
  v.innerHTML = `<div class="title"><div><h2>Qo'shimcha limit so'rovlari</h2><p>Tasdiqlangan hajm korxonaning shu oydagi limitiga qo'shiladi</p></div></div>
  <div class="card">${d.pending.length ? `<div class="tbl"><table><tr><th>Sana</th><th>Korxona</th><th>Oy</th><th class="num">Hajm, t</th><th class="num">Narx, $</th><th></th></tr>
    ${d.pending.map((r) => `<tr><td>${esc(r.created_at.slice(0, 16))}</td><td><b>${esc(r.factory)}</b><br><span class="note mono">${esc(r.factory_id)}</span></td><td>${monthName(r.month)}</td>
      <td class="num">${fmt(r.tons)}</td><td class="num">${fmt(r.cost, 2)}</td>
      <td><div class="acts"><button class="btn sm" data-ok="${r.id}">Tasdiqlash</button><button class="ghost sm" data-no="${r.id}" style="color:var(--red)">Rad etish</button></div></td></tr>`).join("")}
  </table></div>` : `<div class="empty">Kutilayotgan so'rovlar yo'q</div>`}</div>`;
  const act = (id, status) => async (e) => withBtn(e.target, async () => {
    try { await api("admin/extra/" + id, { method: "POST", body: { status } }); toast(status === "approved" ? "Tasdiqlandi" : "Rad etildi"); route(); } catch (er) { toast(er.message); }
  });
  $$("[data-ok]").forEach((b) => (b.onclick = act(b.dataset.ok, "approved")));
  $$("[data-no]").forEach((b) => (b.onclick = act(b.dataset.no, "rejected")));
}

async function adminSettings(v) {
  const d = await api("admin/overview");
  v.innerHTML = `<div class="title"><div><h2>Sozlamalar</h2></div></div>
  <div class="grid g2e">
    <div class="card"><h3>Umumiy hudud limiti</h3>
      <form id="cf"><label for="cap">Oylik umumiy CO₂ limiti, tonna</label><input id="cap" type="number" min="1" value="${d.total_cap}">
      <label for="tg">Yordam uchun Telegram</label><input id="tg" value="@${esc(d.telegram)}">
      <button class="btn full">Saqlash</button><div class="msg" id="cm"></div></form>
      <p class="note" style="margin-top:10px">Tasdiqlanmagan oylar limiti darhol qayta hisoblanadi. Tasdiqlangan oylar o'zgarmaydi.</p></div>
    <div class="card"><h3>Qo'shimcha limit tariflari</h3>
      <form id="tf"><div class="tbl"><table id="tt"><tr><th>Asosiy limitdan, % gacha</th><th>Narx, $/t</th><th></th></tr></table></div>
      <button type="button" class="ghost sm" id="tadd" style="margin-top:10px">+ Bosqich</button>
      <button class="btn full">Tariflarni saqlash</button><div class="msg" id="tm"></div></form>
      <p class="note" style="margin-top:10px">Oxirgi bosqichdan yuqori qo'shimcha limitga ruxsat berilmaydi.</p></div>
    <div class="card"><h3>Admin paroli</h3>
      <form id="pf"><label for="po">Joriy parol</label><input id="po" type="password" autocomplete="current-password" required>
      <label for="pn">Yangi parol (kamida 8)</label><input id="pn" type="password" autocomplete="new-password" required minlength="8">
      <button class="btn full">O'zgartirish</button><div class="msg" id="pm"></div></form></div>
  </div>`;
  const addRow = (t = { upto: "", price: "" }) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input type="number" min="1" max="100" step="0.1" value="${t.upto}" class="tu"></td><td><input type="number" min="0" step="0.01" value="${t.price}" class="tp"></td><td><button type="button" class="ghost sm">×</button></td>`;
    $("button", tr).onclick = () => tr.remove();
    $("#tt").appendChild(tr);
  };
  d.tiers.forEach(addRow);
  $("#tadd").onclick = () => addRow();
  $("#cf").onsubmit = (e) => { e.preventDefault(); withBtn($("#cf .btn"), async () => {
    try { await api("admin/settings", { method: "PUT", body: { total_cap: +$("#cap").value, telegram: $("#tg").value } }); TG = $("#tg").value.replace(/^@/, ""); setMsg($("#cm"), "✓ Saqlandi", true); }
    catch (er) { setMsg($("#cm"), er.message); } }); };
  $("#tf").onsubmit = (e) => { e.preventDefault(); withBtn($("#tf .btn"), async () => {
    const tiers = $$("#tt tr").slice(1).map((tr) => ({ upto: +$(".tu", tr).value, price: +$(".tp", tr).value }));
    try { await api("admin/settings", { method: "PUT", body: { tiers } }); setMsg($("#tm"), "✓ Saqlandi", true); }
    catch (er) { setMsg($("#tm"), er.message); } }); };
  $("#pf").onsubmit = (e) => { e.preventDefault(); withBtn($("#pf .btn"), async () => {
    try { await api("password", { method: "POST", body: { old: $("#po").value, new: $("#pn").value } }); setMsg($("#pm"), "✓ Parol o'zgartirildi", true); $("#pf").reset(); }
    catch (er) { setMsg($("#pm"), er.message); } }); };
}

boot();
