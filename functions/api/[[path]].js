// EcoLimit API — Cloudflare Pages Functions + D1
// Barcha /api/* so'rovlari shu fayl orqali o'tadi.

const SESSION_DAYS = 7;
const PBKDF2_ITER = 100000;
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const TZ_OFFSET_H = 5; // Asia/Tashkent

/* ------------------------------ helpers ------------------------------ */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const err = (msg, status = 400) => json({ error: msg }, status);

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(s) { return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256);
  return toHex(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function getCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
async function body(req) {
  try { return await req.json(); } catch { return {}; }
}
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

function nowLocal() { return new Date(Date.now() + TZ_OFFSET_H * 3600e3); }
function monthKey(d = nowLocal()) { return d.toISOString().slice(0, 7); }
function shiftMonth(m, k) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + k, 1));
  return d.toISOString().slice(0, 7);
}
function daysInMonth(m) { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const validFactoryId = (id) => /^[A-Z0-9][A-Z0-9-]{1,31}$/.test(id);

async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  let tiers;
  try { tiers = JSON.parse(s.tiers); } catch { tiers = [{ upto: 5, price: 18 }, { upto: 10, price: 27 }, { upto: 20, price: 45 }]; }
  return { total_cap: Number(s.total_cap) || 0, tiers, telegram: s.telegram || "saidalokhonn" };
}

/* --------------------------- limit algoritmi ---------------------------
   Ball_i  = Talab_i × Foydalanish_i
   Limit_i = UmumiyLimit × Ball_i / Σ Ball
   Foydalanish_i — oxirgi 3 oyda tasdiqlangan limitning haqiqatda ishlatilgan
   ulushi (0.3–1.0). Tarixi yo'q yangi korxona uchun 1.0.               */
async function computeLimits(db, month) {
  const { total_cap } = await getSettings(db);
  const { results: facs } = await db.prepare("SELECT * FROM factories WHERE active = 1 ORDER BY id").all();

  const { results: alloc } = await db.prepare("SELECT * FROM allocations WHERE month = ?").bind(month).all();
  const allocMap = Object.fromEntries(alloc.map((a) => [a.factory_id, a]));
  const finalized = alloc.length > 0;

  const from = shiftMonth(month, -3);
  const { results: past } = await db.prepare(
    `SELECT a.factory_id, a.month, a.base_limit,
            COALESCE((SELECT SUM(tons) FROM extra_requests e WHERE e.factory_id=a.factory_id AND e.month=a.month AND e.status='approved'),0) AS extra,
            r.co2
     FROM allocations a JOIN reports r ON r.factory_id=a.factory_id AND r.month=a.month
     WHERE a.month >= ? AND a.month < ?`
  ).bind(from, month).all();

  const utilMap = {};
  for (const p of past) {
    const lim = p.base_limit + p.extra;
    if (lim <= 0) continue;
    (utilMap[p.factory_id] ||= []).push(Math.min(1, p.co2 / lim));
  }

  const rows = facs.map((f) => {
    const u = utilMap[f.id];
    let util = u && u.length ? u.reduce((a, b) => a + b, 0) / u.length : 1;
    util = Math.max(0.3, Math.min(1, util));
    return { ...f, util, score: f.demand * util };
  });
  const sum = rows.reduce((s, r) => s + r.score, 0) || 1;
  for (const r of rows) {
    if (finalized && allocMap[r.id]) {
      r.base_limit = allocMap[r.id].base_limit;
      r.util = allocMap[r.id].util;
      r.score = allocMap[r.id].demand * r.util;
    } else {
      r.base_limit = Math.round((total_cap * r.score) / sum / 100) * 100;
    }
    r.share = total_cap ? r.base_limit / total_cap : 0;
  }
  return { rows, finalized, total_cap };
}

async function usage(db, factoryId, month) {
  const rep = await db.prepare("SELECT co2, updated_at FROM reports WHERE factory_id=? AND month=?").bind(factoryId, month).first();
  const ex = await db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status='approved' THEN tons END),0) AS approved, COALESCE(SUM(CASE WHEN status='pending' THEN tons END),0) AS pending FROM extra_requests WHERE factory_id=? AND month=?"
  ).bind(factoryId, month).first();
  const used = rep ? rep.co2 : 0;
  const isCurrent = month === monthKey();
  const day = isCurrent ? nowLocal().getUTCDate() : daysInMonth(month);
  const days = daysInMonth(month);
  const forecast = day > 0 ? Math.round((used / day) * days) : used;
  return { used, forecast, day, days, approved: ex.approved, pending: ex.pending, updated_at: rep?.updated_at || null };
}

function extraCost(tiers, base, already, tons) {
  let left = tons, cost = 0, cursor = already, lo = 0;
  for (const t of tiers) {
    const hi = (base * t.upto) / 100;
    const room = Math.max(0, hi - Math.max(lo, cursor));
    const take = Math.min(left, room);
    cost += take * t.price; left -= take; cursor += take; lo = hi;
    if (left <= 1e-9) break;
  }
  return left > 1e-9 ? null : Math.round(cost * 100) / 100;
}

function status(limit, forecast) {
  if (!limit) return "ok";
  const r = forecast / limit;
  return r <= 0.95 ? "ok" : r <= 1 ? "warn" : "bad";
}

/* ------------------------------- auth -------------------------------- */
async function currentUser(env, req) {
  const tok = getCookie(req, "eco_session");
  if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return null;
  const h = await sha256(tok);
  const row = await env.DB.prepare(
    "SELECT u.id, u.login, u.role, u.factory_id, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?"
  ).bind(h).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}
async function createSession(env, userId, secure) {
  const tok = randHex(32);
  const exp = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").bind(await sha256(tok), userId, exp).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  return `eco_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
async function createUser(db, login, password, role, factoryId = null) {
  const salt = randHex(16);
  const hash = await hashPassword(password, salt);
  return db.prepare("INSERT INTO users (login, pass_hash, salt, role, factory_id) VALUES (?,?,?,?,?)").bind(login, hash, salt, role, factoryId).run();
}
const validLogin = (l) => /^[A-Za-z0-9._-]{3,32}$/.test(l);
const validPass = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128;

/* ------------------------------ routes ------------------------------- */
async function route(req, env, path, method) {
  const db = env.DB;
  const secure = new URL(req.url).protocol === "https:";

  // CSRF himoyasi: o'zgartiruvchi so'rovlar faqat JSON bilan
  if (method !== "GET" && !(req.headers.get("content-type") || "").includes("application/json")) {
    return err("Content-Type application/json bo'lishi kerak", 415);
  }

  if (path === "status" && method === "GET") {
    const c = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
    const s = await getSettings(db);
    return json({ needsSetup: c.n === 0, telegram: s.telegram });
  }

  if (path === "setup" && method === "POST") {
    const c = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
    if (c.n > 0) return err("Admin allaqachon yaratilgan", 403);
    const b = await body(req);
    const login = str(b.login, 32);
    if (!validLogin(login)) return err("Login 3–32 belgi: harf, raqam, . _ -");
    if (!validPass(b.password)) return err("Parol kamida 8 belgi bo'lishi kerak");
    const r = await createUser(db, login, b.password, "admin");
    return json({ ok: true }, 200, { "set-cookie": await createSession(env, r.meta.last_row_id, secure) });
  }

  if (path === "login" && method === "POST") {
    const b = await body(req);
    const login = str(b.login, 32);
    const password = String(b.password ?? "");
    if (!login || !password) return err("Login va parolni kiriting");
    const att = await db.prepare("SELECT * FROM login_attempts WHERE login=?").bind(login).first();
    if (att && att.locked_until > Date.now()) {
      const mins = Math.ceil((att.locked_until - Date.now()) / 60000);
      return err(`Juda ko'p urinish. ${mins} daqiqadan keyin qayta urinib ko'ring`, 429);
    }
    const u = await db.prepare("SELECT * FROM users WHERE login=?").bind(login).first();
    const ok = u && safeEqual(await hashPassword(password, u.salt), u.pass_hash);
    if (!ok) {
      const fails = (att?.fails || 0) + 1;
      const lock = fails >= MAX_FAILS ? Date.now() + LOCK_MIN * 60000 : 0;
      await db.prepare(
        "INSERT INTO login_attempts (login, fails, locked_until) VALUES (?,?,?) ON CONFLICT(login) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until"
      ).bind(login, lock ? 0 : fails, lock).run();
      return err("Login yoki parol noto'g'ri", 401);
    }
    await db.prepare("DELETE FROM login_attempts WHERE login=?").bind(login).run();
    return json({ ok: true, role: u.role }, 200, { "set-cookie": await createSession(env, u.id, secure) });
  }

  const user = await currentUser(env, req);
  if (!user) return err("Tizimga kiring", 401);

  if (path === "logout" && method === "POST") {
    const tok = getCookie(req, "eco_session");
    if (tok) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { "set-cookie": "eco_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }

  if (path === "me" && method === "GET") {
    let factory = null;
    if (user.factory_id) factory = await db.prepare("SELECT id, name FROM factories WHERE id=?").bind(user.factory_id).first();
    const s = await getSettings(db);
    return json({ login: user.login, role: user.role, factory, telegram: s.telegram });
  }

  if (path === "password" && method === "POST") {
    const b = await body(req);
    const u = await db.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first();
    if (!safeEqual(await hashPassword(String(b.old ?? ""), u.salt), u.pass_hash)) return err("Joriy parol noto'g'ri", 403);
    if (!validPass(b.new)) return err("Yangi parol kamida 8 belgi bo'lishi kerak");
    const salt = randHex(16);
    await db.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(await hashPassword(b.new, salt), salt, user.id).run();
    await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id).run();
    return json({ ok: true }, 200, { "set-cookie": await createSession(env, user.id, secure) });
  }

  /* ----------------------------- issues ----------------------------- */
  if (path === "issues" && method === "GET") {
    const q = user.role === "admin"
      ? db.prepare("SELECT i.*, f.name AS factory FROM issues i LEFT JOIN factories f ON f.id=i.factory_id ORDER BY i.id DESC LIMIT 500")
      : db.prepare("SELECT * FROM issues WHERE factory_id=? ORDER BY id DESC LIMIT 200").bind(user.factory_id);
    return json({ issues: (await q.all()).results });
  }
  if (path === "issues" && method === "POST") {
    if (user.role !== "factory") return err("Faqat korxonalar murojaat yuboradi", 403);
    const b = await body(req);
    const category = str(b.category, 80), text = str(b.text, 3000), contact = str(b.contact, 100);
    if (!category || text.length < 5) return err("Mavzu va tavsifni to'ldiring");
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM issues WHERE factory_id=? AND created_at > datetime('now','-1 hour')").bind(user.factory_id).first();
    if (recent.n >= 10) return err("Bir soatda ko'pi bilan 10 ta murojaat", 429);
    await db.prepare("INSERT INTO issues (factory_id, category, text, contact) VALUES (?,?,?,?)").bind(user.factory_id, category, text, contact).run();
    return json({ ok: true });
  }

  /* ---------------------------- factory ----------------------------- */
  if (user.role === "factory") {
    const fid = user.factory_id;
    if (path === "dashboard" && method === "GET") {
      const month = monthKey();
      const f = await db.prepare("SELECT * FROM factories WHERE id=?").bind(fid).first();
      if (!f) return err("Korxona topilmadi", 404);
      const { rows, finalized, total_cap } = await computeLimits(db, month);
      const me = rows.find((r) => r.id === fid) || { base_limit: 0, util: 1, score: 0, share: 0 };
      const u = await usage(db, fid, month);
      const s = await getSettings(db);
      const from = shiftMonth(month, -5);
      const { results: hist } = await db.prepare(
        `SELECT r.month, r.co2, a.base_limit,
                COALESCE((SELECT SUM(tons) FROM extra_requests e WHERE e.factory_id=r.factory_id AND e.month=r.month AND e.status='approved'),0) AS extra
         FROM reports r LEFT JOIN allocations a ON a.factory_id=r.factory_id AND a.month=r.month
         WHERE r.factory_id=? AND r.month>=? AND r.month<=? ORDER BY r.month`
      ).bind(fid, from, month).all();
      const { results: requests } = await db.prepare("SELECT * FROM extra_requests WHERE factory_id=? ORDER BY id DESC LIMIT 20").bind(fid).all();
      const limit = me.base_limit + u.approved;
      return json({
        month, finalized, total_cap,
        factory: f,
        base_limit: me.base_limit, util: me.util, score: me.score, share: me.share,
        limit, ...u, status: status(limit, u.forecast),
        tiers: s.tiers, history: hist, requests,
      });
    }
    if (path === "extra/quote" && method === "POST") {
      const b = await body(req); const tons = num(b.tons);
      if (!(tons > 0)) return err("Hajmni kiriting");
      const month = monthKey();
      const { rows } = await computeLimits(db, month);
      const me = rows.find((r) => r.id === fid);
      const u = await usage(db, fid, month);
      const s = await getSettings(db);
      const cost = extraCost(s.tiers, me.base_limit, u.approved + u.pending, tons);
      return json({ cost, max: Math.max(0, (me.base_limit * s.tiers.at(-1).upto) / 100 - u.approved - u.pending) });
    }
    if (path === "extra" && method === "POST") {
      const b = await body(req); const tons = Math.round(num(b.tons));
      if (!(tons > 0) || tons > 1e7) return err("Hajm noto'g'ri");
      const month = monthKey();
      const { rows } = await computeLimits(db, month);
      const me = rows.find((r) => r.id === fid);
      if (!me) return err("Korxona faol emas", 403);
      const u = await usage(db, fid, month);
      const s = await getSettings(db);
      const cost = extraCost(s.tiers, me.base_limit, u.approved + u.pending, tons);
      if (cost == null) return err(`Qo'shimcha limit asosiy limitning ${s.tiers.at(-1).upto}% idan oshmasligi kerak`);
      await db.prepare("INSERT INTO extra_requests (factory_id, month, tons, cost) VALUES (?,?,?,?)").bind(fid, month, tons, cost).run();
      return json({ ok: true, cost });
    }
    return path.startsWith("admin") ? err("Ruxsat yo'q", 403) : err("Topilmadi", 404);
  }

  /* ----------------------------- admin ------------------------------ */
  if (user.role !== "admin") return err("Ruxsat yo'q", 403);
  const parts = path.split("/"); // admin/...
  if (parts[0] !== "admin") return err("Topilmadi", 404);
  const sub = parts.slice(1);

  if (sub[0] === "overview" && method === "GET") {
    const month = new URL(req.url).searchParams.get("month") || monthKey();
    if (!validMonth(month)) return err("Oy formati noto'g'ri");
    const { rows, finalized, total_cap } = await computeLimits(db, month);
    const s = await getSettings(db);
    const out = [];
    for (const r of rows) {
      const u = await usage(db, r.id, month);
      const limit = r.base_limit + u.approved;
      const login = await db.prepare("SELECT login FROM users WHERE factory_id=?").bind(r.id).first();
      out.push({ ...r, login: login?.login || null, limit, ...u, status: status(limit, u.forecast) });
    }
    const { results: pending } = await db.prepare(
      "SELECT e.*, f.name AS factory FROM extra_requests e JOIN factories f ON f.id=e.factory_id WHERE e.status='pending' ORDER BY e.id"
    ).all();
    const oi = await db.prepare("SELECT COUNT(*) AS n FROM issues WHERE status != 'Hal qilindi'").first();
    return json({ month, current: monthKey(), finalized, total_cap, tiers: s.tiers, telegram: s.telegram, factories: out, pending, openIssues: oi.n });
  }

  if (sub[0] === "settings" && method === "PUT") {
    const b = await body(req);
    if (b.total_cap !== undefined) {
      const c = num(b.total_cap);
      if (!(c > 0)) return err("Umumiy limit musbat son bo'lishi kerak");
      await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('total_cap',?)").bind(String(c)).run();
    }
    if (b.tiers !== undefined) {
      if (!Array.isArray(b.tiers) || !b.tiers.length || b.tiers.length > 10) return err("Tariflar noto'g'ri");
      let prev = 0;
      const t = b.tiers.map((x) => ({ upto: num(x.upto), price: num(x.price) }));
      for (const x of t) { if (!(x.upto > prev) || !(x.price >= 0) || x.upto > 100) return err("Tarif foizlari o'sib borishi kerak (≤100)"); prev = x.upto; }
      await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('tiers',?)").bind(JSON.stringify(t)).run();
    }
    if (b.telegram !== undefined) {
      const tg = str(b.telegram, 40).replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{3,40}$/.test(tg)) return err("Telegram username noto'g'ri");
      await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('telegram',?)").bind(tg).run();
    }
    return json({ ok: true });
  }

  if (sub[0] === "allocate" && method === "POST") {
    const b = await body(req); const month = str(b.month, 7);
    if (!validMonth(month)) return err("Oy formati noto'g'ri");
    await db.prepare("DELETE FROM allocations WHERE month=?").bind(month).run();
    const { rows } = await computeLimits(db, month);
    const stmts = rows.map((r) =>
      db.prepare("INSERT INTO allocations (factory_id, month, base_limit, demand, util) VALUES (?,?,?,?,?)").bind(r.id, month, r.base_limit, r.demand, r.util)
    );
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, count: stmts.length });
  }
  if (sub[0] === "allocate" && method === "DELETE") {
    const month = new URL(req.url).searchParams.get("month");
    if (!validMonth(month || "")) return err("Oy formati noto'g'ri");
    await db.prepare("DELETE FROM allocations WHERE month=?").bind(month).run();
    return json({ ok: true });
  }

  if (sub[0] === "factories") {
    const id = sub[1] ? decodeURIComponent(sub[1]).toUpperCase() : null;
    if (!id && method === "POST") {
      const b = await body(req);
      const fid = str(b.id, 32).toUpperCase();
      if (!validFactoryId(fid)) return err("ID: katta harf, raqam va '-' (masalan ZAV-001)");
      const name = str(b.name, 120); if (!name) return err("Nomini kiriting");
      const login = str(b.login, 32) || fid;
      if (!validLogin(login)) return err("Login 3–32 belgi: harf, raqam, . _ -");
      if (!validPass(b.password)) return err("Parol kamida 8 belgi bo'lishi kerak");
      if (await db.prepare("SELECT 1 FROM factories WHERE id=?").bind(fid).first()) return err("Bu ID band");
      if (await db.prepare("SELECT 1 FROM users WHERE login=?").bind(login).first()) return err("Bu login band");
      const f = factoryFields(b); if (f.error) return err(f.error);
      await db.prepare("INSERT INTO factories (id,name,sector,size,demand,hour_start,hour_end) VALUES (?,?,?,?,?,?,?)")
        .bind(fid, name, f.sector, f.size, f.demand, f.hour_start, f.hour_end).run();
      await createUser(db, login, b.password, "factory", fid);
      return json({ ok: true });
    }
    if (id && !sub[2] && method === "PUT") {
      const b = await body(req);
      const name = str(b.name, 120); if (!name) return err("Nomini kiriting");
      const f = factoryFields(b); if (f.error) return err(f.error);
      const r = await db.prepare("UPDATE factories SET name=?, sector=?, size=?, demand=?, hour_start=?, hour_end=?, active=? WHERE id=?")
        .bind(name, f.sector, f.size, f.demand, f.hour_start, f.hour_end, b.active === false ? 0 : 1, id).run();
      if (!r.meta.changes) return err("Topilmadi", 404);
      return json({ ok: true });
    }
    if (id && !sub[2] && method === "DELETE") {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE factory_id=?)").bind(id),
        db.prepare("DELETE FROM users WHERE factory_id=?").bind(id),
        db.prepare("DELETE FROM reports WHERE factory_id=?").bind(id),
        db.prepare("DELETE FROM allocations WHERE factory_id=?").bind(id),
        db.prepare("DELETE FROM extra_requests WHERE factory_id=?").bind(id),
        db.prepare("DELETE FROM issues WHERE factory_id=?").bind(id),
        db.prepare("DELETE FROM factories WHERE id=?").bind(id),
      ]);
      return json({ ok: true });
    }
    if (id && sub[2] === "password" && method === "POST") {
      const b = await body(req);
      if (!validPass(b.password)) return err("Parol kamida 8 belgi bo'lishi kerak");
      const u = await db.prepare("SELECT id FROM users WHERE factory_id=?").bind(id).first();
      if (!u) return err("Foydalanuvchi topilmadi", 404);
      const salt = randHex(16);
      await db.batch([
        db.prepare("UPDATE users SET pass_hash=?, salt=? WHERE id=?").bind(await hashPassword(b.password, salt), salt, u.id),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
      ]);
      return json({ ok: true });
    }
    if (id && sub[2] === "reports" && method === "GET") {
      const { results } = await db.prepare("SELECT month, co2, updated_at FROM reports WHERE factory_id=? ORDER BY month DESC LIMIT 36").bind(id).all();
      return json({ reports: results });
    }
  }

  if (sub[0] === "reports" && method === "PUT") {
    const b = await body(req);
    const fid = str(b.factory_id, 32).toUpperCase(), month = str(b.month, 7), co2 = num(b.co2);
    if (!validMonth(month)) return err("Oy formati noto'g'ri (YYYY-MM)");
    if (!(co2 >= 0)) return err("CO₂ qiymati noto'g'ri");
    if (!(await db.prepare("SELECT 1 FROM factories WHERE id=?").bind(fid).first())) return err("Korxona topilmadi", 404);
    await db.prepare(
      "INSERT INTO reports (factory_id, month, co2, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(factory_id,month) DO UPDATE SET co2=excluded.co2, updated_at=excluded.updated_at"
    ).bind(fid, month, co2).run();
    return json({ ok: true });
  }
  if (sub[0] === "reports" && method === "DELETE") {
    const sp = new URL(req.url).searchParams;
    await db.prepare("DELETE FROM reports WHERE factory_id=? AND month=?").bind(String(sp.get("factory_id")).toUpperCase(), sp.get("month")).run();
    return json({ ok: true });
  }

  if (sub[0] === "extra" && sub[1] && method === "POST") {
    const b = await body(req);
    if (!["approved", "rejected"].includes(b.status)) return err("Holat noto'g'ri");
    const r = await db.prepare("UPDATE extra_requests SET status=? WHERE id=? AND status='pending'").bind(b.status, Number(sub[1])).run();
    if (!r.meta.changes) return err("So'rov topilmadi yoki allaqachon ko'rib chiqilgan", 404);
    return json({ ok: true });
  }

  if (sub[0] === "issues" && sub[1] && method === "PUT") {
    const b = await body(req);
    const st = str(b.status, 40);
    if (!["Yangi", "Ko'rib chiqilmoqda", "Hal qilindi"].includes(st)) return err("Holat noto'g'ri");
    await db.prepare("UPDATE issues SET status=?, admin_note=? WHERE id=?").bind(st, str(b.admin_note, 1000), Number(sub[1])).run();
    return json({ ok: true });
  }

  return err("Topilmadi", 404);
}

function factoryFields(b) {
  const demand = num(b.demand), hs = Math.trunc(num(b.hour_start)), he = Math.trunc(num(b.hour_end));
  if (!(demand >= 0)) return { error: "Talab manfiy bo'lmasligi kerak" };
  if (!(hs >= 0 && hs <= 23 && he >= 1 && he <= 24 && he > hs)) return { error: "Ish vaqti noto'g'ri (0–24, tugash > boshlanish)" };
  const size = ["Kichik", "O'rta", "Katta"].includes(b.size) ? b.size : "O'rta";
  return { demand, hour_start: hs, hour_end: he, size, sector: str(b.sector, 80) };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.DB) return err("D1 baza ulanmagan (DB binding yo'q)", 500);
  const path = (Array.isArray(params.path) ? params.path.join("/") : params.path || "").replace(/\/+$/, "");
  try {
    return await route(request, env, path, request.method);
  } catch (e) {
    console.error(e);
    return err("Server xatosi", 500);
  }
}
