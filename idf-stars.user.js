// ==UserScript==
// @name         הכוכבים שלי — ממשק חדש לאתר הכוכבים
// @namespace    idf-stars
// @version      1.2
// @description  ממשק עברי מודרני עם חיפוש לאתר הכוכבים של מולטיפאס, ושמירת הקוד מה-SMS
// @match        https://idf.mltp.co.il/
// @match        https://idf.mltp.co.il/?*
// @match        https://idf.mltp.co.il/Account/Login*
// @match        https://idf.mltp.co.il/Account/Transactions*
// @match        https://idf.mltp.co.il/Account/RetailChains*
// @homepageURL  https://github.com/lidanthedev/idf-stars
// @downloadURL  https://raw.githubusercontent.com/lidanthedev/idf-stars/main/idf-stars.user.js
// @updateURL    https://raw.githubusercontent.com/lidanthedev/idf-stars/main/idf-stars.user.js
// @run-at       document-end
// @grant        none
// ==/UserScript==
// Runs on the real site because login is reCAPTCHA-bound to this domain. Add ?orig=1 to see the original page.

(() => {
  if (location.search.includes('orig')) return;

  const CODE_KEY = 'stars-digital-code';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const num = s => parseFloat(String(s).replace(/[^\d.-]/g, '')) || 0;
  const money = n => n.toLocaleString('he-IL', { maximumFractionDigits: 2 });
  const parseHtml = h => new DOMParser().parseFromString(h, 'text/html');
  const ddmmyyyy = d => [d.getDate(), d.getMonth() + 1, d.getFullYear()].map(x => String(x).padStart(2, '0')).join('-');
  const store = {
    get: () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } },
    set: v => { try { localStorage.setItem(CODE_KEY, v); return true; } catch { return false; } },
  };

  // ---------- parsing the server-rendered pages ----------
  const isLoginPage = d => !!d.querySelector('#signin-form');

  function parseHeader(d) {
    const spans = d.querySelectorAll('#userInfoStars span');
    return { user: txt(spans[0]), terms: txt(spans[1]) };
  }

  function parseBalances(d) {
    return [...d.querySelectorAll('#example tr')].map(tr => {
      const [nameTd, valTd] = tr.querySelectorAll('td');
      const [first, ...rest] = nameTd.innerHTML.split(/<br\s*\/?>/i).map(h => txt(parseHtml(h).body));
      const m = first.match(/^כספר\s+(.+?)\s*-\s*(שנתי|חצי שנתי|חודשי)$/);
      return {
        name: m ? m[1] : first,
        period: m ? m[2] : '',
        kind: m ? 'ארנק רשת' : 'כוכבים',
        sub: rest.join(' · '),
        amount: num(txt(valTd)),
      };
    });
  }

  function parseTransactions(d) {
    const rows = [...d.querySelectorAll('#Table1 tbody > tr')];
    const out = [];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const [date, time, type, card, order] = [...rows[i].cells].map(txt);
      if (!date) continue;
      // each value sits after a <strong>label:</strong>
      const pick = el => { const c = el?.cloneNode(true); c?.querySelector('strong')?.remove(); return txt(c); };
      const spans3 = rows[i + 1].querySelectorAll('.span3');
      const [dd, mm, yy] = date.split('/').map(Number);
      out.push({
        date, time, type, card, order,
        ts: new Date(yy, mm - 1, dd, ...time.split(':').map(Number)).getTime(),
        amount: num(pick(rows[i + 1].querySelector('.span2'))),
        pointType: pick(spans3[0]),
        chain: pick(spans3[1]),
        shop: pick(rows[i + 1].querySelector('.span4')),
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  function parseChains(d) {
    return [...d.querySelectorAll('#example tbody tr')].map(tr => {
      const [name, cat, discount, phone] = [...tr.cells].map(txt);
      return { name, cat: cat.split('|').map(s => s.trim()).filter(Boolean), discount, phone };
    });
  }

  // ---------- data loading ----------
  async function get(url, init) {
    const r = await fetch(url, { credentials: 'same-origin', ...init });
    const d = parseHtml(await r.text());
    if (isLoginPage(d)) { location.href = '/Account/Login?ReturnUrl=' + encodeURIComponent(location.pathname); throw new Error('session expired'); }
    return d;
  }

  async function loadAll() {
    const main = location.pathname.startsWith('/Account/Transactions') ? mainDoc : await get('/Account/Transactions');
    const token = main.querySelector('#trans-form [name=__RequestVerificationToken]').value;
    const [txDoc, chainsDoc] = await Promise.all([
      // shortcut: always fetches the full history (server has no range limit); fine for a handful of rows per soldier.
      get('/Account/Transactions', { method: 'POST', body: new URLSearchParams({ __RequestVerificationToken: token, fromDate: '01-01-2010', toDate: ddmmyyyy(new Date()) }) }),
      location.pathname.startsWith('/Account/RetailChains') ? mainDoc : get('/Account/RetailChains'),
    ]);
    // balances are only rendered in the POST response, not on a plain GET
    return { header: parseHeader(main), balances: parseBalances(txDoc), tx: parseTransactions(txDoc), chains: parseChains(chainsDoc) };
  }

  async function resendSms() {
    const d = await get('/Account/Registration');
    const token = d.querySelector('#activate-form [name=__RequestVerificationToken]')?.value;
    if (!token) throw new Error('no form');
    await get('/Account/Registration', { method: 'POST', body: new URLSearchParams({ __RequestVerificationToken: token, SubmitSendSms: 'שלח לי את הקוד שוב' }) });
  }

  // ---------- UI ----------
  const CSS = `
  :root{--bg:#f3f1ea;--panel:#fffdf7;--ink:#1c2116;--muted:#6b6f5e;--line:#e2ddcc;--olive:#3f4a2a;--olive-2:#56643a;--gold:#c9962b;--gold-soft:#f6ebcf;--pos:#2f7a4a;--neg:#a5402d;--shadow:0 1px 0 rgba(28,33,22,.04),0 8px 24px -12px rgba(28,33,22,.18)}
  @media (prefers-color-scheme:dark){:root{--bg:#12140f;--panel:#1b1e16;--ink:#ecebe2;--muted:#9a9d8a;--line:#2d3125;--olive:#c7d3a3;--olive-2:#a9b884;--gold:#e2b04a;--gold-soft:#3a3220;--pos:#7cc792;--neg:#e58a76;--shadow:0 8px 24px -12px rgba(0,0,0,.6)}}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Rubik',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  button,input{font:inherit;color:inherit}
  .num{font-variant-numeric:tabular-nums}
  .wrap{max-width:980px;margin:0 auto;padding:0 16px 64px}
  header.top{display:flex;align-items:center;gap:12px;padding:20px 0 16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;letter-spacing:-.01em}
  .brand .star{width:34px;height:34px;border-radius:10px;background:var(--olive);color:var(--gold);display:grid;place-items:center;font-size:18px}
  @media (prefers-color-scheme:dark){.brand .star{background:#2a3120}}
  .who{margin-inline-start:auto;text-align:end;font-size:13px;color:var(--muted)}
  .who a{color:inherit}
  .hero{display:grid;grid-template-columns:1.1fr 1fr;gap:14px}
  @media (max-width:760px){.hero{grid-template-columns:1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}
  .total{background:var(--olive);color:#f4f1e4;border:none;position:relative;overflow:hidden}
  @media (prefers-color-scheme:dark){.total{background:#262d1c;color:var(--ink)}}
  .total::after{content:'★';position:absolute;inset-inline-start:-18px;bottom:-60px;font-size:200px;line-height:1;color:rgba(201,150,43,.18);pointer-events:none}
  .label{font-size:13px;opacity:.75}
  .big{font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:6px 0 10px}
  .big small{font-size:18px;font-weight:500;opacity:.7;margin-inline-start:6px}
  .split{display:flex;gap:18px;flex-wrap:wrap;font-size:13px}
  .split b{display:block;font-size:17px}
  .code-card h2{margin:0;font-size:15px;display:flex;align-items:center;gap:8px}
  .code{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:clamp(17px,5.4vw,26px);letter-spacing:.04em;direction:ltr;text-align:center;padding:14px 8px;margin:12px 0;border-radius:12px;background:var(--gold-soft);border:1px dashed var(--gold);word-break:break-all;user-select:all}
  .code.empty{font-family:inherit;font-size:14px;letter-spacing:0;color:var(--muted);user-select:none}
  .code-input{display:block;resize:none;width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;direction:ltr;text-align:center;padding:12px;margin:12px 0;border-radius:12px;border:2px solid var(--gold);background:var(--panel)}
  .code-input::placeholder{font-family:'Rubik',system-ui,sans-serif;font-size:15px}
  .code-input:focus{outline:none;box-shadow:0 0 0 4px var(--gold-soft)}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);padding:8px 14px;border-radius:999px;cursor:pointer;font-size:14px;font-weight:500;transition:transform .08s,background .15s}
  .btn:hover{background:var(--gold-soft)}
  .btn:active{transform:scale(.97)}
  .btn.primary{background:var(--olive);color:#fff;border-color:transparent}
  @media (prefers-color-scheme:dark){.btn.primary{background:var(--gold);color:#1b1e16}}
  .btn.ghost{border-color:transparent;background:transparent;color:var(--muted)}
  .btn:focus-visible,.chip:focus-visible,.tab:focus-visible,.search input:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  .hint{font-size:12px;color:var(--muted);margin-top:10px}
  .toolbar{position:sticky;top:0;z-index:5;background:var(--bg);padding:16px 0 10px;margin-top:8px;display:flex;flex-direction:column;gap:10px}
  .search{position:relative}
  .search input{width:100%;padding:13px 44px 13px 16px;border-radius:14px;border:1px solid var(--line);background:var(--panel);font-size:16px;box-shadow:var(--shadow)}
  .search svg{position:absolute;inset-inline-start:14px;top:50%;transform:translateY(-50%);opacity:.5}
  .tabs{display:flex;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px;width:fit-content}
  .tab{border:none;background:none;padding:7px 14px;border-radius:9px;cursor:pointer;font-weight:500;color:var(--muted)}
  .tab[aria-selected=true]{background:var(--olive);color:#fff}
  @media (prefers-color-scheme:dark){.tab[aria-selected=true]{background:var(--gold);color:#1b1e16}}
  .tab .count{font-size:12px;opacity:.7;margin-inline-start:4px}
  .chips{display:flex;gap:6px;flex-wrap:wrap}
  .chip{border:1px solid var(--line);background:var(--panel);padding:5px 12px;border-radius:999px;cursor:pointer;font-size:13px}
  .chip[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .wallet{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:4px}
  .wallet.zero{opacity:.55}
  .wallet .top{display:flex;justify-content:space-between;gap:8px;align-items:start}
  .wallet .name{font-weight:600}
  .wallet .sub{font-size:12px;color:var(--muted)}
  .wallet .amt{font-size:24px;font-weight:700;margin-top:auto}
  .tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--gold-soft);color:var(--ink);white-space:nowrap}
  .tag.olive{background:var(--olive);color:#fff}
  @media (prefers-color-scheme:dark){.tag.olive{background:#3a4528;color:var(--olive)}}
  .summary{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:10px}
  .summary b{color:var(--ink)}
  .list{display:flex;flex-direction:column;gap:8px}
  .tx{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:center}
  .tx .ico{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:18px;background:var(--gold-soft);grid-row:span 2}
  .tx .ico.in{background:color-mix(in srgb,var(--pos) 18%,transparent)}
  .tx .t1{font-weight:600}
  .tx .t2{font-size:12.5px;color:var(--muted)}
  .tx .amt{font-weight:700;font-size:17px;text-align:end}
  .tx .amt.in{color:var(--pos)}
  .tx .when{font-size:12px;color:var(--muted);text-align:end}
  .tx details{grid-column:1/-1;font-size:12.5px;color:var(--muted)}
  .tx summary{cursor:pointer;width:fit-content}
  .chain{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px}
  .chain .top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .chain .name{font-weight:600;font-size:16px}
  .chain .disc{font-weight:700;color:var(--pos)}
  .chain a{color:var(--olive-2);text-decoration:none;direction:ltr;font-size:14px;width:fit-content}
  .empty-state{text-align:center;color:var(--muted);padding:40px 0}
  mark{background:var(--gold-soft);color:inherit;border-radius:3px;padding:0 1px}
  .toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,20px);background:var(--ink);color:var(--bg);padding:10px 18px;border-radius:999px;font-size:14px;opacity:0;transition:.2s;pointer-events:none;z-index:10}
  .toast.show{opacity:1;transform:translate(-50%,0)}
  .foot{margin-top:28px;font-size:12px;color:var(--muted);text-align:center}
  .foot a{color:inherit}
  .loading{padding:80px 0;text-align:center;color:var(--muted)}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  const ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  // Drop the old Bootstrap styles and load ours.
  function setupHead(css, title) {
    document.querySelectorAll('link[rel=stylesheet],style').forEach(n => n.remove());
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
    document.title = title;
    document.head.insertAdjacentHTML('beforeend',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style>');
  }

  const LOGIN_CSS = `
  body.login{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 16px}
  .login .container{width:100%;max-width:420px}
  .login .mainContent,.login .hpInfo.span6{display:block;width:100%;margin:0}
  .login .mastheadStars,.login .m_Navbar,.login .void,.login .hpInfo.span4,.login hr,.login .footer,.login .marketing img{display:none}
  .login .jumbotron{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:28px 22px;box-shadow:var(--shadow)}
  .lg-brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
  .lg-brand h1{margin:0;font-size:22px;letter-spacing:-.01em}
  .lg-brand p{margin:0;font-size:14px;color:var(--muted)}
  .lg-fields{display:flex;flex-direction:column;gap:14px}
  .lg-field{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:500}
  .lg-field input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);font-size:17px;direction:ltr;text-align:right;-moz-appearance:textfield}
  .lg-field input::-webkit-inner-spin-button,.lg-field input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
  .lg-field input::placeholder{color:var(--muted);opacity:.7}
  .lg-field input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 4px var(--gold-soft)}
  .login .field-validation-error{color:var(--neg);font-size:13px;font-weight:500}
  .login .form-group{display:flex;justify-content:center;margin:20px 0 !important}
  @media (max-width:380px){.login .g-recaptcha{transform:scale(.88);transform-origin:center}}
  .login input[type=submit]{width:100%;border:none;border-radius:999px;padding:14px;font-size:16px;font-weight:600;cursor:pointer;background:var(--olive);color:#fff;transition:transform .08s}
  @media (prefers-color-scheme:dark){.login input[type=submit]{background:var(--gold);color:#1b1e16}}
  .login input[type=submit]:active{transform:scale(.98)}
  .login input[type=submit]:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
  .login .marketing{margin-top:18px;font-size:12.5px;color:var(--muted)}
  .login .marketing .span4{padding:10px 4px;border-top:1px solid var(--line)}
  .login .marketing .span4:first-child{border-top:none}
  .login .marketing h4{margin:0 0 2px;font-size:13px;color:var(--ink)!important}
  .login .marketing p{margin:0}
  `;

  // Restyle the real login form in place: the reCAPTCHA is bound to this page, so its box must never move.
  function skinLogin() {
    setupHead(CSS + LOGIN_CSS, 'כניסה · הכוכבים שלי');
    document.body.classList.add('login');
    const form = document.getElementById('signin-form');
    form.querySelector('.form-signin-heading')?.insertAdjacentHTML('beforebegin',
      '<div class="lg-brand"><span class="brand"><span class="star" aria-hidden="true">★</span></span><div><h1>הכוכבים שלי</h1><p>כניסה למתגייס/ת או חייל/ת בשירות חובה</p></div></div>');
    form.querySelector('.form-signin-heading')?.remove();
    const fields = document.createElement('div');
    fields.className = 'lg-fields';
    for (const [id, label, hint] of [['IsraelPersonalId', 'תעודת זהות', '9 ספרות'], ['PhoneNumber', 'טלפון נייד', '05XXXXXXXX']]) {
      const input = document.getElementById(id);
      if (!input) continue;
      const field = document.createElement('label');
      field.className = 'lg-field';
      field.textContent = label;
      input.placeholder = hint;
      input.inputMode = 'numeric';
      input.autocomplete = id === 'PhoneNumber' ? 'tel' : 'off';
      field.append(input);
      const err = form.querySelector(`[data-valmsg-for="${id}"]`);
      if (err) field.append(err);
      fields.append(field);
    }
    const loginErr = form.querySelector('[data-valmsg-for="LoginErrorStrar"]');
    if (loginErr) fields.append(loginErr);
    form.querySelector('.inputGroup')?.before(fields);
    form.querySelectorAll('.inputGroup').forEach(n => n.remove()); // now-empty old table layout
    // The site's own handler swallows Enter; submit like a normal form instead.
    fields.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(form.querySelector('[type=submit]')); } });
    document.getElementById('IsraelPersonalId')?.focus();
  }

  if (isLoginPage(document)) return skinLogin();
  setupHead(CSS, 'הכוכבים שלי');
  const mainDoc = document.cloneNode(true); // the served page, parsed before we replace the body
  document.body.innerHTML = '<div class="wrap"><div class="loading">טוען את הנתונים שלך…</div></div>';

  const state = { q: '', tab: location.pathname.startsWith('/Account/RetailChains') ? 'chains' : 'balance', range: 'all', type: 'הכול', editing: false };
  let data;

  const norm = s => s.toLowerCase();
  const matches = (q, ...fields) => !q || fields.some(f => norm(String(f)).includes(q));
  const hl = s => {
    const q = state.q.trim();
    if (!q) return esc(s);
    const i = norm(String(s)).indexOf(norm(q));
    return i < 0 ? esc(s) : esc(String(s).slice(0, i)) + '<mark>' + esc(String(s).slice(i, i + q.length)) + '</mark>' + esc(String(s).slice(i + q.length));
  };

  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // Accepts the whole SMS ("...הקוד האישי: XXXX...") or just the code.
  function extractCode(t) {
    const labeled = t.match(/הקוד האישי\s*:?\s*(\S+)/);
    if (labeled) return labeled[1].replace(/[.,;!]+$/, '');
    const digits = t.match(/\d(?:[\s-]?\d){7,}/); // fallback: a long digit run anywhere in the text
    return (digits ? digits[0] : t).replace(/[\s-]/g, '');
  }

  const fmtCode = c => /^\d+$/.test(c) ? c.replace(/(\d{4})(?=\d)/g, '$1 ') : c;

  function codeCard() {
    const code = store.get();
    const body = state.editing
      ? `<textarea class="code-input num" id="codeInput" rows="3" autocomplete="off" placeholder="הדביקו כאן את כל הודעת ה-SMS, או רק את הקוד" aria-label="הודעת ה-SMS או הקוד">${esc(code)}</textarea>
         <div class="row"><button class="btn primary" data-act="save">שמירה</button><button class="btn ghost" data-act="cancel">ביטול</button></div>`
      : `<div class="code num ${code ? '' : 'empty'}">${code ? esc(fmtCode(code)) : 'עדיין לא שמרת קוד. לחץ "הוספת קוד" והדבק את הקוד מה-SMS'}</div>
         <div class="row">
           ${code ? '<button class="btn primary" data-act="copy">📋 העתקה</button><button class="btn" data-act="edit">✏️ עריכה</button>' : '<button class="btn primary" data-act="edit">＋ הוספת קוד</button>'}
           <button class="btn ghost" data-act="sms">שלחו לי את הקוד שוב ב-SMS</button>
         </div>`;
    return `<section class="card code-card" aria-label="הקוד שלי"><h2>🔑 הקוד שלי <span class="tag">כרטיס דיגיטלי</span></h2>${body}
      <div class="hint">נשמר רק בדפדפן הזה. מציגים אותו בקופה יחד עם תעודה מזהה.</div></section>`;
  }

  function heroHtml() {
    const stars = data.balances.filter(b => b.kind === 'כוכבים').reduce((s, b) => s + b.amount, 0);
    const wallets = data.balances.filter(b => b.kind !== 'כוכבים').reduce((s, b) => s + b.amount, 0);
    return `<div class="hero">
      <section class="card total" aria-label="סיכום יתרה">
        <div class="label">סך הכול זמין לך</div>
        <div class="big num">${money(stars + wallets)}<small>₪</small></div>
        <div class="split"><div>כוכבים<b class="num">${money(stars)}</b></div><div>ארנקי רשתות<b class="num">${money(wallets)}</b></div><div>ארנקים פעילים<b class="num">${data.balances.filter(b => b.amount > 0).length}</b></div></div>
      </section>
      <div id="codeSlot">${codeCard()}</div>
    </div>`;
  }

  function balanceView(q) {
    const items = data.balances.filter(b => matches(q, b.name, b.sub, b.period, b.kind)).sort((a, b) => b.amount - a.amount);
    if (!items.length) return '<div class="empty-state">אין ארנקים שתואמים לחיפוש</div>';
    return `<div class="grid">${items.map(b => `
      <div class="wallet ${b.amount ? '' : 'zero'}">
        <div class="top"><div class="name">${hl(b.name)}</div><span class="tag ${b.kind === 'כוכבים' ? 'olive' : ''}">${esc(b.period || b.kind)}</span></div>
        ${b.sub ? `<div class="sub">${hl(b.sub)}</div>` : ''}
        <div class="amt num">${money(b.amount)} ₪</div>
      </div>`).join('')}</div>`;
  }

  const RANGES = { all: ['הכול', Infinity], m1: ['30 יום', 30], m3: ['3 חודשים', 91], y1: ['שנה', 365] };
  const isIn = t => !/קני/.test(t.type);

  function txView(q) {
    const types = ['הכול', ...new Set(data.tx.map(t => t.type))];
    const since = Date.now() - RANGES[state.range][1] * 864e5;
    const items = data.tx.filter(t => t.ts >= since && (state.type === 'הכול' || t.type === state.type) && matches(q, t.chain, t.shop, t.type, t.pointType, t.order, t.card, t.date, t.amount));
    const spent = items.filter(t => !isIn(t)).reduce((s, t) => s + t.amount, 0);
    const loaded = items.filter(isIn).reduce((s, t) => s + t.amount, 0);
    return `
      <div class="chips" role="group" aria-label="טווח זמן" style="margin-bottom:8px">${Object.entries(RANGES).map(([k, [l]]) => `<button class="chip" data-range="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}</div>
      <div class="chips" role="group" aria-label="סוג פעולה" style="margin-bottom:14px">${types.map(t => `<button class="chip" data-type="${esc(t)}" aria-pressed="${state.type === t}">${esc(t)}</button>`).join('')}</div>
      <div class="summary"><span><b class="num">${items.length}</b> תנועות</span><span>נוצל: <b class="num">${money(spent)} ₪</b></span><span>נטען: <b class="num">${money(loaded)} ₪</b></span></div>
      ${items.length ? `<div class="list">${items.map(t => `
        <article class="tx">
          <div class="ico ${isIn(t) ? 'in' : ''}" aria-hidden="true">${isIn(t) ? '⭐' : '🛍️'}</div>
          <div class="t1">${hl(t.shop || t.chain)}</div>
          <div class="amt num ${isIn(t) ? 'in' : ''}"><bdi dir="ltr">${isIn(t) ? '+' : '−'}${money(t.amount)}</bdi> ₪</div>
          <div class="t2">${hl(t.chain)} · ${hl(t.pointType)}</div>
          <div class="when num">${esc(t.date)} · ${esc(t.time)}</div>
          <details><summary>פרטים</summary>סוג פעולה: ${hl(t.type)} · מספר מולטיפאס: <span class="num">${hl(t.card)}</span>${t.order ? ` · מספר הזמנה: <span class="num">${hl(t.order)}</span>` : ''}</details>
        </article>`).join('')}</div>` : '<div class="empty-state">אין תנועות בטווח או בחיפוש הזה</div>'}`;
  }

  function chainsView(q) {
    const items = data.chains.filter(c => matches(q, c.name, c.discount, c.phone, ...c.cat));
    return `${items.length ? `<div class="grid">${items.map(c => `
      <div class="chain">
        <div class="top"><div class="name">${hl(c.name)}</div><span class="disc num">${hl(c.discount)} הנחה</span></div>
        <div class="chips">${c.cat.map(x => `<span class="tag">${hl(x)}</span>`).join('')}</div>
        <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 ${hl(c.phone)}</a>
      </div>`).join('')}</div>` : '<div class="empty-state">אין רשתות שתואמות לחיפוש</div>'}
      <p class="hint"><a href="/img/RetailChainspStars.pdf" target="_blank" rel="noopener">רשימת הרשתות המלאה (PDF)</a></p>`;
  }

  const TABS = { balance: ['יתרות', () => data.balances.length], tx: ['תנועות', () => data.tx.length], chains: ['רשתות', () => data.chains.length] };
  const PLACEHOLDER = { balance: 'חיפוש ארנק או רשת…', tx: 'חיפוש לפי חנות, רשת, סכום, מספר הזמנה…', chains: 'חיפוש רשת, תחום או טלפון…' };

  function renderResults() {
    const q = norm(state.q.trim());
    document.getElementById('results').innerHTML = { balance: balanceView, tx: txView, chains: chainsView }[state.tab](q);
  }

  function render() {
    const approved = /מאושר/.test(data.header.terms) && !/לא/.test(data.header.terms);
    document.body.innerHTML = `<div class="wrap">
      <header class="top">
        <div class="brand"><span class="star" aria-hidden="true">★</span>הכוכבים שלי</div>
        <div class="who">${esc(data.header.user)}<br>${approved ? esc(data.header.terms) : `<a href="/Account/Registration">${esc(data.header.terms || 'אישור תקנון')} ←</a>`} · <a href="/Account/LogOff">יציאה</a></div>
      </header>
      ${heroHtml()}
      <div class="toolbar">
        <div class="search">${ICON_SEARCH}<input id="q" type="search" placeholder="${PLACEHOLDER[state.tab]}" value="${esc(state.q)}" aria-label="חיפוש"></div>
        <div class="tabs" role="tablist">${Object.entries(TABS).map(([k, [l, n]]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}<span class="count num">${n()}</span></button>`).join('')}</div>
      </div>
      <main id="results"></main>
      <div class="foot">ממשק לא רשמי · הנתונים נטענים ישירות מאתר מולטיפאס · <a href="?orig=1">לאתר המקורי</a></div>
    </div>`;
    renderResults();
  }

  function renderCode() {
    document.getElementById('codeSlot').innerHTML = codeCard();
    if (state.editing) { const i = document.getElementById('codeInput'); i.focus(); i.select(); }
  }

  function saveCode() {
    const v = extractCode(document.getElementById('codeInput').value);
    if (!store.set(v)) return toast('לא ניתן לשמור בדפדפן הזה');
    state.editing = false; renderCode(); toast(v ? 'הקוד נשמר' : 'הקוד נמחק');
  }

  document.addEventListener('input', e => {
    if (e.target.id === 'q') { state.q = e.target.value; renderResults(); }
    if (e.target.id === 'codeInput' && /הקוד האישי/.test(e.target.value)) { e.target.value = extractCode(e.target.value); toast('הקוד חולץ מההודעה ✓'); }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'codeInput' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCode(); }
    if (e.target.id === 'codeInput' && e.key === 'Escape') { state.editing = false; renderCode(); }
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('q')?.focus(); }
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { state.tab = b.dataset.tab; state.q = ''; render(); }
    else if (b.dataset.range) { state.range = b.dataset.range; renderResults(); }
    else if (b.dataset.type) { state.type = b.dataset.type; renderResults(); }
    else if (b.dataset.act === 'edit') { state.editing = true; renderCode(); }
    else if (b.dataset.act === 'cancel') { state.editing = false; renderCode(); }
    else if (b.dataset.act === 'save') saveCode();
    else if (b.dataset.act === 'copy') {
      try { await navigator.clipboard.writeText(store.get()); toast('הקוד הועתק ✓'); } catch { toast('ההעתקה נכשלה, סמן את הקוד והעתק ידנית'); }
    } else if (b.dataset.act === 'sms') {
      if (!confirm('לשלוח את הקוד שוב ב-SMS למספר הנייד הרשום?')) return;
      b.disabled = true;
      try { await resendSms(); toast('נשלח! הקוד יגיע ב-SMS בקרוב'); } catch { toast('השליחה נכשלה, נסה שוב'); }
      b.disabled = false;
    }
  });

  loadAll().then(d => { data = d; render(); }).catch(err => {
    if (err.message !== 'session expired') document.body.innerHTML = `<div class="wrap"><div class="loading">משהו השתבש בטעינה. <a href="?orig=1">לאתר המקורי</a></div></div>`;
    console.error(err);
  });
})();
