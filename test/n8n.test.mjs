// Uji workflow n8n /report: struktur JSON, parser perintah, otorisasi, pemformat balasan,
// dan rantai penuh Parse -> gas/Code.gs (action report) -> Format. Jalankan: npm test
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(fs.readFileSync(path.join(dir, '../n8n/waha-report.workflow.json'), 'utf8'));
const parseSrc = fs.readFileSync(path.join(dir, '../n8n/src/parse.js'), 'utf8');
const formatSrc = fs.readFileSync(path.join(dir, '../n8n/src/format.js'), 'utf8');
const gasCode = fs.readFileSync(path.join(dir, '../gas/Code.gs'), 'utf8');

const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'PASS' : 'FAIL', 'n8n:', label, ok ? '' : JSON.stringify({ got, want }));
  if (!ok) process.exitCode = 1;
};

// ---------- 1) Struktur workflow ----------
const names = wf.nodes.map(n => n.name);
eq('nama node unik', new Set(names).size, names.length);
eq('semua koneksi menunjuk node yang ada', Object.entries(wf.connections).every(([from, c]) => names.includes(from) && c.main.flat().every(t => names.includes(t.node))), true);
eq('webhook punya webhookId & path waha-report', [!!wf.nodes.find(n => n.type === 'n8n-nodes-base.webhook').webhookId, wf.nodes.find(n => n.type === 'n8n-nodes-base.webhook').parameters.path], [true, 'waha-report']);
eq('kode di JSON = n8n/src (jalankan npm run build:n8n bila berbeda)', [wf.nodes.find(n => n.name === 'Parse perintah').parameters.jsCode === parseSrc, wf.nodes.find(n => n.name === 'Format balasan').parameters.jsCode === formatSrc], [true, true]);
eq('node Apps Script lanjut meski error (onError)', wf.nodes.find(n => n.name === 'Ambil report (Apps Script)').onError, 'continueRegularOutput');

// ---------- 2) Parser perintah ----------
const OWNER = '6281234567890';
const runCode = (src, input, named = {}) => new Function('$input', '$', src)({ first: () => ({ json: input }) }, (n) => ({ first: () => ({ json: named[n] }) }));
const withNow = (iso, fn) => { const real = Date.now; Date.now = () => new Date(iso).getTime(); try { return fn(); } finally { Date.now = real; } };
const parseTest = parseSrc.replace("'628xxxxxxxxxx'", `'${OWNER}'`);
const NOW = '2026-11-02T08:00:00Z';   // 15:00 WIB
const msg = (body, extra = {}) => ({ body: { event: 'message', session: 'default', payload: { from: OWNER + '@c.us', fromMe: false, body, ...extra } } });
const parse = (body, extra, now = NOW) => withNow(now, () => runCode(parseTest, msg(body, extra).body ? msg(body, extra) : msg(body, extra)));
const ok1 = (body, extra, now) => { const r = parse(body, extra, now); return r.length === 1 ? { ...r[0].json, req: r[0].json.gasBody ? JSON.parse(r[0].json.gasBody) : null } : null; };
const ps = (body, now) => { const r = ok1(body, undefined, now); return r && r.req ? [r.req.payload.month, r.req.payload.store] : (r ? 'ERR:' + r.replyText.split('\n')[0] : 'diam'); };

eq('/report -> bulan ini, semua platform', ps('/report'), ['2026-11', 'ALL']);
eq('/report oktober', ps('/report oktober'), ['2026-10', 'ALL']);
eq('/report Oktober (huruf besar) & /REPORT', ps('/REPORT Oktober'), ['2026-10', 'ALL']);
eq('/report desember -> bulan depan dianggap tahun lalu', ps('/report desember'), ['2025-12', 'ALL']);
eq('/report agustus 2025', ps('/report agustus 2025'), ['2025-08', 'ALL']);
eq('/report 2026-09', ps('/report 2026-09'), ['2026-09', 'ALL']);
eq('/report 09/2026', ps('/report 09/2026'), ['2026-09', 'ALL']);
eq('/report sep (singkatan)', ps('/report sep'), ['2026-09', 'ALL']);
eq('/report bulan ini', ps('/report bulan ini'), ['2026-11', 'ALL']);
eq('/report bulan lalu', ps('/report bulan lalu'), ['2026-10', 'ALL']);
eq('/report bulan lalu di bulan Januari -> Desember tahun lalu', ps('/report bulan lalu', '2026-01-15T05:00:00Z'), ['2025-12', 'ALL']);
eq('/report semua', ps('/report semua'), ['ALL', 'ALL']);
eq('/report shopee mitra', ps('/report shopee mitra'), ['2026-11', 'SHOPEE_MITRA']);
eq('/report oktober tiktok ds', ps('/report oktober tiktok ds'), ['2026-10', 'TIKTOK_DIANSARI']);
eq('/report tokopedia mitra', ps('/report tokopedia mitra'), ['2026-11', 'TOKPED_MITRA']);
eq('/report wa', ps('/report wa'), ['2026-11', 'WA_ALL']);
eq('/report mitra shopee agustus (urutan bebas)', ps('/report mitra shopee agustus'), ['2026-08', 'SHOPEE_MITRA']);
eq('/report mitra (tanpa platform) -> minta platform', ps('/report mitra').startsWith('ERR:Sebutkan platform'), true);
eq('/report shopee (tanpa toko) -> minta toko', ps('/report shopee').startsWith('ERR:Sebutkan tokonya'), true);
eq('/report 2025 (tahun saja) -> minta bulan', ps('/report 2025').startsWith('ERR:Tulis bulannya'), true);
eq('/report xyz -> tidak dikenali + bantuan', [ps('/report xyz').startsWith('ERR:Perintah tidak dikenali'), ok1('/report xyz').replyText.includes('Cara pakai')], [true, true]);
eq('/report help -> bantuan', ok1('/report help').replyText.startsWith('*Cara pakai /report*'), true);
eq('isi permintaan ke Apps Script: action report + apiKey', (({ action, apiKey }) => [action, apiKey])(ok1('/report').req), ['report', 'ISI_DENGAN_N8N_KEY']);
eq('balasan dikirim ke chat asal', [ok1('/report').chatId, ok1('/report').wahaUrl, ok1('/report').session], [OWNER + '@c.us', 'http://localhost:3000', 'default']);

// ---------- 3) Pesan yang harus diabaikan / otorisasi ----------
const silent = (body, extra, top = {}) => withNow(NOW, () => runCode(parseTest, { body: { event: 'message', payload: { from: OWNER + '@c.us', fromMe: false, body, ...extra }, ...top } })).length === 0;
eq('bukan perintah (halo) diabaikan', silent('halo'), true);
eq('"/reportx" diabaikan', silent('/reportx'), true);
eq('event selain message diabaikan (cegah dobel)', silent('/report', {}, { event: 'message.any' }), true);
eq('nomor tidak diizinkan diabaikan tanpa balasan', silent('/report', { from: '628999999999@c.us' }), true);
eq('grup: pengirim diizinkan -> balas ke grup', (() => { const r = withNow(NOW, () => runCode(parseTest, { body: { event: 'message', payload: { from: '120363@g.us', participant: OWNER + '@c.us', fromMe: false, body: '/report' } } })); return r.length === 1 && r[0].json.chatId === '120363@g.us'; })(), true);
eq('grup: pengirim tidak diizinkan diabaikan', silent('/report', { from: '120363@g.us', participant: '628111@c.us' }), true);
eq('fromMe (nomor yang tersambung WAHA) -> balas ke chat tujuan', (() => { const r = withNow(NOW, () => runCode(parseTest, { body: { event: 'message', payload: { from: '6280000@c.us', to: '6285555@c.us', fromMe: true, body: '/report' } } })); return r.length === 1 && r[0].json.chatId === '6285555@c.us'; })(), true);
eq('fromMe dimatikan lewat ALLOW_FROM_ME=false -> diabaikan', withNow(NOW, () => runCode(parseTest.replace('ALLOW_FROM_ME: true', 'ALLOW_FROM_ME: false'), { body: { event: 'message', payload: { from: '6280000@c.us', to: '6285555@c.us', fromMe: true, body: '/report' } } })).length, 0);

// ---------- 4) Pemformat balasan ----------
const ctx = { chatId: 'c@c.us', wahaUrl: 'http://w', wahaKey: 'k', session: 's' };
const fmt = (resp) => runCode(formatSrc, resp, { 'Parse perintah': ctx })[0].json;
eq('sukses -> teks report apa adanya', fmt({ data: JSON.stringify({ success: true, text: 'LAPORAN' }) }).replyText, 'LAPORAN');
eq('sukses -> konteks chat/WAHA diteruskan', (({ chatId, wahaUrl, wahaKey, session }) => ({ chatId, wahaUrl, wahaKey, session }))(fmt({ data: JSON.stringify({ success: true, text: 'x' }) })), ctx);
eq('error dari Apps Script -> pesan jelas', fmt({ data: JSON.stringify({ success: false, code: 401, message: 'Password salah atau belum diisi' }) }).replyText, '⚠️ Gagal mengambil report: Password salah atau belum diisi');
eq('error jaringan -> pesan jelas', fmt({ error: { message: 'ECONNREFUSED' } }).replyText, '⚠️ Gagal menghubungi Apps Script: ECONNREFUSED');
eq('halaman HTML (bukan JSON) -> petunjuk deploy', fmt({ data: '<html>Sorry, unable to open the file</html>' }).replyText.includes('respons server tidak valid'), true);

// ---------- 5) Rantai penuh: Parse -> Code.gs asli (report) -> Format ----------
const tabs = new Map(); const props = { APP_PASSWORD: 'pw', N8N_KEY: 'KUNCI-N8N' };
const mkSheet = (name) => { const rows = tabs.get(name); return { getDataRange: () => ({ getDisplayValues: () => rows.map(r => r.map(String)) }), getLastRow: () => rows.length, getLastColumn: () => 20, getRange: () => ({ setFontWeight() { return this; }, setBackground() { return this; }, getValues: () => [rows[0]], setValue() { return this; } }), appendRow: (r) => rows.push(r), isSheetHidden: () => false, getName: () => name }; };
const ss = { getSheetByName: (n) => (tabs.has(n) ? mkSheet(n) : null), insertSheet: (n) => { tabs.set(n, []); return mkSheet(n); }, getSheets: () => [...tabs.keys()].map(mkSheet) };
const fmtDate = (d, tz, p) => { const x = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map(y => [y.type, y.value])); return p.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|M/g, (m, lit) => lit !== undefined ? lit : ({ yyyy: x.year, MM: x.month, dd: x.day, HH: x.hour === '24' ? '00' : x.hour, mm: x.minute, ss: x.second, M: String(+x.month) }[m])); };
const gas = vm.createContext({ console, Logger: { log() {} }, SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ({ getSheets: () => [] }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, Utilities: { formatDate: fmtDate }, ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) } });
vm.runInContext(gasCode, gas);
const H = { pes: ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Status Pembatalan/Pengembalian", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Metode Pembayaran", "SKU Induk", "Nama Variasi", "Jumlah", "Harga Setelah Diskon", "Provinsi", "Nama Toko"], pen: ["No. Pesanan", "Lihat berdasarkan", "No Pengajuan", "ID Produk", "Nama Produk", "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Total Penghasilan", "Nama Toko"] };
tabs.set('Database', [H.pes, ['X1', 'Selesai', '', '', '2026-10-05 10:00', '', 'COD', 'SKU-A', 'V1', '2', '15000', 'Jawa Barat', 'Mitra Diansari']]);
tabs.set('Penghasilan', [H.pen, ['X1', 'Order', '', '', '', '2026-10-05', '2026-10-12', '27000', 'Mitra Diansari']]);
for (const [n, h] of [['Master Produk', ["SKU Induk", "Nama Variasi", "HPP (Modal)"]], ['Data_WA', []], ['Data_Iklan', []], ['Data_Tiktok_Tokped', []]]) tabs.set(n, [h]);
const gasHandle = (bodyStr) => JSON.parse(gas.doPost({ postData: { contents: bodyStr } }).text);

const chain = (command, key = 'KUNCI-N8N') => {
  const p = withNow(NOW, () => runCode(parseTest.replace('ISI_DENGAN_N8N_KEY', key), msg(command)))[0].json;
  const resp = gasHandle(p.gasBody);
  return { sent: runCode(formatSrc, { data: JSON.stringify(resp) }, { 'Parse perintah': p })[0].json, resp };
};
let c = chain('/report oktober shopee mitra');
eq('rantai: report Oktober Shopee Mitra berisi angka dari spreadsheet', ['REPORT OMNICHANNEL', 'Periode: *Oktober 2026*', 'Shopee - Mitra Diansari', 'Rp 30.000', 'Rp 27.000'].every(f => c.sent.replyText.includes(f)), true);
eq('rantai: balasan ditujukan ke pengirim', c.sent.chatId, OWNER + '@c.us');
c = chain('/report oktober', 'KUNCI-SALAH');
eq('rantai: N8N_KEY salah -> balasan "Gagal mengambil report"', c.sent.replyText.startsWith('⚠️ Gagal mengambil report:'), true);
c = chain('/report semua');
eq('rantai: /report semua -> "Semua Bulan"', c.sent.replyText.includes('Periode: *Semua Bulan*'), true);
