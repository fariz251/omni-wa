// ============ KONFIGURASI: ubah bagian ini saja ============
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/ISI_URL_WEB_APP/exec', // URL Web App Apps Script (berakhiran /exec)
  N8N_KEY: 'ISI_DENGAN_N8N_KEY',                                      // sama dengan Script Property N8N_KEY
  WAHA_URL: 'http://localhost:3000',                                  // alamat WAHA dari sisi n8n
  WAHA_API_KEY: '',                                                   // kosongkan jika WAHA tanpa API key
  WAHA_SESSION: 'default',
  ALLOWED: ['628xxxxxxxxxx'],                                         // nomor yang boleh memakai /report (internasional, tanpa +)
  ALLOW_FROM_ME: true,                                                // true = pesan yang Anda ketik sendiri dari nomor yang tersambung ke WAHA juga diterima
};
// ===========================================================

const MONTHS = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agus: 8, agustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, des: 12, desember: 12 };
const PLATFORMS = { shopee: 'SHOPEE', tiktok: 'TIKTOK', tt: 'TIKTOK', tokped: 'TOKPED', tokopedia: 'TOKPED', wa: 'WA', whatsapp: 'WA' };
const STORES = { ds: 'DIANSARI', diansari: 'DIANSARI', mitra: 'MITRA' };
const HELP = [
  '*Cara pakai /report*',
  '• */report* → bulan ini, semua platform',
  '• */report oktober* → bulan tertentu (tahun ini)',
  '• */report oktober 2025* atau */report 2025-10*',
  '• */report bulan lalu*',
  '• */report semua* → semua bulan',
  '• */report shopee mitra* → filter platform + toko',
  '• */report oktober tiktok ds*',
  '',
  'Platform: shopee, tiktok, tokped, wa',
  'Toko: ds (Diansari), mitra',
].join('\n');

const input = $input.first().json;
const body = input.body || input;
const msg = body.payload || {};

// Hanya proses pesan masuk berawalan /report
if (body.event && body.event !== 'message') return [];
const text = String(msg.body || '').trim();
if (!/^\/report(\s|$)/i.test(text)) return [];

// Otorisasi: hanya nomor di ALLOWED (atau pesan dari nomor sendiri bila ALLOW_FROM_ME)
const fromMe = msg.fromMe === true;
if (fromMe && !CONFIG.ALLOW_FROM_ME) return [];
const chatId = fromMe ? (msg.to || msg.from) : msg.from;
if (!chatId) return [];
const senderRaw = String(msg.participant || msg.author || (msg._data && msg._data.author) || msg.from || '');
const senderNum = senderRaw.replace(/@.*$/, '').replace(/\D/g, '');
const allowed = fromMe || CONFIG.ALLOWED.some(a => {
  const digits = String(a).replace(/\D/g, '');
  return (digits !== '' && digits === senderNum) || String(a) === senderRaw;
});
if (!allowed) return [];   // diam: tidak membalas nomor yang tidak diizinkan

const base = { chatId, wahaUrl: String(CONFIG.WAHA_URL).replace(/\/+$/, ''), wahaKey: CONFIG.WAHA_API_KEY, session: CONFIG.WAHA_SESSION };
const reply = (t) => [{ json: { ok: false, replyText: t, ...base } }];

// ---- Baca argumen
const toks = text.replace(/^\/report/i, '').toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
if (['help', 'bantuan', 'menu', '?'].includes(toks[0])) return reply(HELP);

const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
const curY = nowWib.getUTCFullYear(), curM = nowWib.getUTCMonth() + 1;
const pad = (n) => String(n).padStart(2, '0');

let month = null, year = null, allMonths = false, prevMonth = false, platform = null, store = null;
const unknown = [];
for (let i = 0; i < toks.length; i++) {
  const t = toks[i]; let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) { year = +m[1]; month = +m[2]; }
  else if ((m = t.match(/^(\d{1,2})[\/-](\d{4})$/))) { month = +m[1]; year = +m[2]; }
  else if (/^\d{4}$/.test(t)) { year = +t; }
  else if (t === 'bulan' && toks[i + 1] === 'ini') { i++; }
  else if (t === 'bulan' && toks[i + 1] === 'lalu') { i++; prevMonth = true; }
  else if (MONTHS[t]) { month = MONTHS[t]; }
  else if (['semua', 'all', 'total'].includes(t)) { allMonths = true; }
  else if (PLATFORMS[t]) { platform = PLATFORMS[t]; }
  else if (STORES[t]) { store = STORES[t]; }
  else unknown.push(t);
}
if (unknown.length) return reply('Perintah tidak dikenali: "' + unknown.join(' ') + '".\n\n' + HELP);

// ---- Bulan
let ym;
if (allMonths) ym = 'ALL';
else if (prevMonth) { let y = curY, m = curM - 1; if (m === 0) { m = 12; y--; } ym = y + '-' + pad(m); }
else if (month !== null) {
  if (month < 1 || month > 12) return reply('Bulan tidak valid.\n\n' + HELP);
  const y = year !== null ? year : (month > curM ? curY - 1 : curY);   // bulan yang belum terjadi dianggap tahun lalu
  ym = y + '-' + pad(month);
}
else if (year !== null) return reply('Tulis bulannya juga, mis. */report oktober ' + year + '*.');
else ym = curY + '-' + pad(curM);

// ---- Filter platform / toko (sama dengan filter di dashboard)
let storeKey = 'ALL';
if (platform || store) {
  if (platform === 'WA') storeKey = 'WA_ALL';
  else if (!platform) return reply('Sebutkan platformnya juga, mis. */report shopee ' + (store === 'MITRA' ? 'mitra' : 'ds') + '*.\n\n' + HELP);
  else if (!store) return reply('Sebutkan tokonya (ds atau mitra), mis. */report ' + platform.toLowerCase() + ' mitra*.');
  else storeKey = platform + '_' + store;
}

return [{ json: { ok: true, gasUrl: CONFIG.GAS_URL, gasBody: JSON.stringify({ action: 'report', apiKey: CONFIG.N8N_KEY, payload: { month: ym, store: storeKey } }), ...base } }];
