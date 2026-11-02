// Uji gas/Code.gs dengan layanan Google tiruan (in-memory). Jalankan: npm test
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, '../gas/Code.gs'), 'utf8');

// --- Mock layanan Google ---
const tabs = new Map(); // nama tab -> array baris
const props = { APP_PASSWORD: 'rahasia' };

const hidden = new Set();
function makeSheet(name, map = tabs) {
  const rows = map.get(name);
  const range = (r, c, nr = 1, nc = 1) => ({
    setFontWeight() { return this; }, setBackground() { return this; },
    getValues: () => [(rows[0] || []).slice(0, nc)],
    getDisplayValues: () => rows.map(x => x.map(String)),
    setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return this; },
    setValues(v) { v.forEach((row, i) => { while (rows.length <= r - 1 + i) rows.push([]); rows[r - 1 + i] = row.slice(); }); return this; },
  });
  return {
    appendRow: (row) => rows.push(row.map(String)),
    getRange: range,
    getLastColumn: () => Math.max(1, ...rows.map(x => x.length)),
    getLastRow: () => rows.length,
    getDataRange: () => ({ getDisplayValues: () => rows.map(x => x.map(String)) }),
    isSheetHidden: () => hidden.has(name),
    getName: () => name,
  };
}
const activeSs = {
  getSheetByName: (n) => (tabs.has(n) ? makeSheet(n) : null),
  insertSheet: (n) => { tabs.set(n, []); return makeSheet(n); },
  getSheets: () => [...tabs.keys()].map(makeSheet),
};

// Spreadsheet admin = spreadsheet TERPISAH dari spreadsheet utama
const adminTabs = new Map();
const adminSs = { getSheets: () => [...adminTabs.keys()].map(n => makeSheet(n, adminTabs)) };

// Utilities.formatDate tiruan (cukup untuk pola yang dipakai Code.gs)
function fmtDate(d, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|M/g, (m, lit) => lit !== undefined ? lit : ({ yyyy: parts.year, MM: parts.month, dd: parts.day, HH: hh, mm: parts.minute, ss: parts.second, M: String(parseInt(parts.month, 10)) }[m]));
}

const makeCtx = () => ({
  console, Logger: { log() {} },
  SpreadsheetApp: { getActiveSpreadsheet: () => activeSs, openById: (id) => { if (id === 'bad-id') throw new Error('Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.'); return adminSs; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
  Utilities: { formatDate: fmtDate },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }),
  },
});
let ctx;
const load = () => { ctx = vm.createContext(makeCtx()); vm.runInContext(code, ctx); };
load();

const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : JSON.stringify({ got, want }));
  if (!ok) process.exitCode = 1;
};
const pw = 'rahasia';
const base = { 'Status Pesanan': 'Selesai', 'Jumlah': '1', 'Harga Setelah Diskon': '1000' };
const DP = 'Diansari Plastik';

eq('doGet health', JSON.parse(ctx.doGet({}).text).success, true);
eq('tanpa password -> 401', post({ action: 'getData' }).code, 401);
eq('password salah -> 401', post({ action: 'getData', password: 'x' }).code, 401);
eq('action tidak dikenal', post({ action: 'hapus', password: pw }).success, false);
eq('JSON rusak tidak crash', JSON.parse(ctx.doPost({ postData: { contents: '{bukan json' } }).text).success, false);

let r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] } });
eq('insert awal', [r.success, r.inserted, r.updated], [true, 1, 0]);
eq('6 tab dibuat otomatis', tabs.size, 6);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [
  { ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2' },
  { ...base, 'No. Pesanan': 'B', 'SKU Induk': 's2', 'Nama Variasi': 'v2', 'Jumlah': '5' },
  { ...base, 'No. Pesanan': '', 'SKU Induk': '', 'Nama Variasi': '' },
] } });
eq('upsert: 1 insert, 2 update', [r.inserted, r.updated], [1, 2]);
const db = tabs.get('Database');
eq('jumlah baris', db.length, 3);
eq('B final', [db[2][0], String(db[2][9]), db[2][12]], ['B', '5', DP]);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1', 'Jumlah': '2' }] } });
eq('upload ulang identik = no-op', [r.inserted, r.updated], [0, 0]);

r = post({ action: 'upload', password: pw, payload: { storeName: 'Mitra Diansari', fileType: 'pesanan', data: [{ ...base, 'No. Pesanan': 'A', 'SKU Induk': 's1', 'Nama Variasi': 'v1' }] } });
eq('toko lain tidak menimpa toko pertama', [r.inserted, r.updated], [1, 0]);
eq('baris Diansari tetap utuh', [String(db[1][9]), db[1][12]], ['2', DP]);

r = post({ action: 'upload', password: pw, payload: { storeName: '', fileType: 'pesanan', data: [{ 'No. Pesanan': 'Z' }] } });
eq('tanpa nama toko ditolak', r.success, false);

r = post({ action: 'upload', password: pw, payload: { storeName: DP, fileType: 'tiktok', data: [{ 'Tanggal': '2026-10-01', 'Platform': 'TikTok Shop', 'GMV (Omset)': 5000, 'Pesanan': 2 }] } });
eq('tiktok insert', [r.inserted, r.updated], [1, 0]);

r = post({ action: 'saveWa', password: pw, payload: { tanggal: '2026-10-31', sku: 'D-01', varian: 'Hitam', qty: 1, hargaJual: 100, hpp: 60, laba: 40, margin: 40, status: 'Sukses', toko: DP } });
eq('simpan WA', r.success, true);

// ---- Rekonsiliasi: spreadsheet admin terpisah, tab per bulan/toko ----
adminTabs.set('AGUSTUS MITRA', [['NO PESANAN', 'TANGGAL PENCATATAN'], ['A', '2026-10-02'], ['B', '2026-10-03']]);
adminTabs.set('AGUSTUS DS', [['LAPORAN PENCATATAN AGUSTUS'], [''], ['No. Pesanan', 'Tanggal'], ['C', '2026-08-05']]); // header di baris 3, penulisan beda
adminTabs.set('SEPTEMBER MITRA', [['Nama', 'Qty'], ['x', '1']]);   // tidak punya kolom NO PESANAN
adminTabs.set('SEPTEMBER DS', []);                                 // kosong
adminTabs.set('RAHASIA', [['NO PESANAN', 'TANGGAL'], ['D', '2026-01-01']]); hidden.add('RAHASIA');
props.SPREADSHEET_ADMIN_ID = 'admin-id';
load(); // eksekusi baru agar konstanta membaca property baru
r = post({ action: 'getData', password: pw });
eq('getData sukses + 6 tabel', [r.success, Object.keys(r.tables).length], [true, 6]);
eq('tabel pesanan = header + 3 baris', r.tables.pesanan.length, 4);
eq('rekon: header baku terbaca [tgl, tab]', r.adminOrders['A'], ['2026-10-02', 'AGUSTUS MITRA']);
eq('rekon: header "No. Pesanan" di baris ke-3 terbaca', r.adminOrders['C'], ['2026-08-05', 'AGUSTUS DS']);
eq('rekon: tab tersembunyi dilewati', r.adminOrders['D'], undefined);
eq('rekon: total ID = 3', r.adminInfo.totalIds, 3);
const st = Object.fromEntries(r.adminInfo.sheets.map(x => [x.name, x]));
eq('info: AGUSTUS MITRA ok (2 ID, header baris 1)', [st['AGUSTUS MITRA'].status, st['AGUSTUS MITRA'].ids, st['AGUSTUS MITRA'].headerRow], ['ok', 2, 1]);
eq('info: AGUSTUS DS ok (header baris 3)', [st['AGUSTUS DS'].status, st['AGUSTUS DS'].headerRow], ['ok', 3]);
eq('info: SEPTEMBER MITRA melaporkan header yang ada', [st['SEPTEMBER MITRA'].status, st['SEPTEMBER MITRA'].headers], ['kolom NO PESANAN tidak ditemukan', ['Nama', 'Qty']]);
eq('info: tab kosong & tersembunyi dilaporkan', [st['SEPTEMBER DS'].status, st['RAHASIA'].status], ['kosong', 'disembunyikan']);
eq('info: configured, tanpa error', [r.adminInfo.configured, r.adminInfo.error], [true, '']);
eq('cekSpreadsheetAdmin() mengembalikan info yang sama', ctx.cekSpreadsheetAdmin().totalIds, 3);

props.SPREADSHEET_ADMIN_ID = 'bad-id'; load();
r = post({ action: 'getData', password: pw });
eq('ID salah: data utama tetap termuat', [r.success, r.tables.pesanan.length], [true, 4]);
eq('ID salah: error dilaporkan, bukan ditelan', [r.adminInfo.configured, r.adminInfo.error.includes('openById'), r.adminOrders], [true, true, {}]);

delete props.SPREADSHEET_ADMIN_ID; load();
r = post({ action: 'getData', password: pw });
eq('ID belum diisi: configured=false', [r.success, r.adminInfo.configured, r.adminOrders], [true, false, {}]);


// =====================================================================
// REPORT (WhatsApp) + ping + kunci n8n
// Dataset kecil dengan angka yang dihitung dengan tangan (bukan dari kode yang diuji).
// =====================================================================
const H = {
  pes: ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Status Pembatalan/Pengembalian", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Metode Pembayaran", "SKU Induk", "Nama Variasi", "Jumlah", "Harga Setelah Diskon", "Provinsi", "Nama Toko"],
  pen: ["No. Pesanan", "Lihat berdasarkan", "No Pengajuan", "ID Produk", "Nama Produk", "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Total Penghasilan", "Nama Toko"],
  mas: ["SKU Induk", "Nama Variasi", "HPP (Modal)"],
  wa: ["Tanggal", "No. Transaksi", "Status", "Alasan", "SKU Induk", "Varian", "Qty", "Harga Jual (Gross)", "HPP (Modal)", "Laba Bersih", "Margin (%)", "Nama Toko"],
  ik: ["Nama Iklan", "Jenis Iklan", "Kode Produk", "Tanggal Mulai", "Tanggal Selesai", "Biaya", "Omzet Penjualan", "Produk Terjual", "Nama Toko", "Periode Laporan"],
  tt: ["Tanggal", "Platform", "Nama Toko", "GMV (Omset)", "Pesanan", "Pembeli", "Produk Terjual", "Pengembalian Dana", "Pesanan SKU", "Pendapatan Bruto"],
};
const P = (id, st, alasan, ret, tgl, sku, qty, harga, toko) => [id, st, alasan, ret, tgl, '', 'COD', sku, 'V1', String(qty), String(harga), 'Jawa Barat', toko];

tabs.clear(); adminTabs.clear(); hidden.clear();
for (const k of Object.keys(props)) if (k !== 'APP_PASSWORD') delete props[k];
tabs.set('Master Produk', [H.mas, ['SKU-A', 'V1', '5000'], ['SKU-B', 'V1', '2000']]);
tabs.set('Database', [H.pes,
  P('O1', 'Selesai', '', '', '2026-10-05 10:00', 'SKU-A', 2, 15000, 'Diansari Plastik'),   // gross 30000, HPP 10000
  P('O2', 'Selesai', '', '', '2026-10-06 10:00', 'SKU-B', 1, 10000, 'Mitra Diansari'),    // gross 10000, HPP 2000, belum cair
  P('O3', 'Batal', 'Pembeli batal', '', '2026-10-07 10:00', 'SKU-A', 1, 15000, 'Diansari Plastik'), // batal 15000
  P('O4', 'Selesai', '', 'Permintaan Disetujui', '2026-10-08 10:00', 'SKU-A', 1, 12000, 'Diansari Plastik'), // retur 12000
  P('O5', 'Selesai', '', '', '2026-09-10 10:00', 'SKU-A', 1, 15000, 'Diansari Plastik'),   // September
]);
tabs.set('Penghasilan', [H.pen,
  ['O1', 'Order', '', '', '', '2026-10-05', '2026-10-12', '27000', 'Diansari Plastik'],
  ['O1', 'Pengajuan', '', '', '', '2026-10-05', '2026-10-12', '99999', 'Diansari Plastik'],       // bukan "Order": harus diabaikan
  ['O5', 'Order', '', '', '', '2026-09-10', '2026-09-17', '13000', 'Diansari Plastik'],
]);
tabs.set('Data_WA', [H.wa,
  ['2026-10-03', 'WA-1', 'Sukses', '-', 'SKU-A', 'V1', '2', '10000', '4000', '12000', '60', 'Diansari Plastik'],
  ['2026-10-04', 'WA-2', 'Sukses', '-', 'SKU-B', 'V1', '2', '10000', '4000', '12000', '60', 'Diansari Plastik'],
  ['2026-10-09', 'WA-3', 'Batal', 'Tidak jadi', 'SKU-B', 'V1', '1', '20000', '4000', '0', '0', 'Diansari Plastik'],
]);
tabs.set('Data_Iklan', [H.ik, ['Iklan 1', 'Produk', 'K1', '2026-10-01', '2026-10-31', '10000', '80000', '8', 'Diansari Plastik', '2026-10-31']]);
tabs.set('Data_Tiktok_Tokped', [H.tt, ['2026-10-10', 'TikTok Shop', 'Diansari Plastik', '1000000', '10', '9', '12', '50000', '10', '900000']]);
adminTabs.set('OKTOBER DS', [['NO PESANAN', 'TANGGAL PENCATATAN'], ['O1', '2026-10-06']]);
props.SPREADSHEET_ADMIN_ID = 'admin-id'; props.N8N_KEY = 'kunci-n8n';
load();

const rep = (payload, extra = {}) => post({ action: 'report', apiKey: 'kunci-n8n', payload, ...extra });
const near = (label, got, want, tol = 1e-6) => eq(label, Math.abs(got - want) < tol, true);

// ---- Otorisasi: n8n hanya boleh ping/report/upload
eq('n8n key: report diizinkan', rep({ month: '2026-10' }).success, true);
eq('n8n key: getData ditolak', post({ action: 'getData', apiKey: 'kunci-n8n' }).code, 401);
eq('n8n key: saveWa ditolak', post({ action: 'saveWa', apiKey: 'kunci-n8n', payload: {} }).code, 401);
eq('n8n key salah ditolak', post({ action: 'report', apiKey: 'salah', payload: {} }).code, 401);
eq('tanpa kredensial ditolak', post({ action: 'report', payload: {} }).code, 401);
eq('password dashboard tetap bisa report', post({ action: 'report', password: pw, payload: { month: '2026-10' } }).success, true);

// ---- Oktober 2026, semua platform (angka dihitung tangan)
let R = rep({ month: '2026-10' }).report; let o = R.overall;
eq('okt: pesanan sukses (2 Shopee + 2 WA + 10 TikTok)', o.validInv, 14);
eq('okt: item terjual (3 + 4 + 12)', o.items, 19);
eq('okt: omset kotor', o.gross, 1080000);
eq('okt: cair bersih (27.000 + 40.000 + 900.000; baris "Pengajuan" diabaikan)', o.net, 967000);
eq('okt: HPP dari yang sudah cair', o.hpp, 26000);
eq('okt: laba', o.profit, 941000);
near('okt: margin %', o.margin, 941000 / 967000 * 100);
near('okt: potongan % ((1.070.000-967.000-1.250)/1.070.000)', o.potongan, (103000 - 1250) / 1070000 * 100);
eq('okt: batal (O3 + WA-3)', [o.batalInv, o.batalNominal], [2, 35000]);
eq('okt: retur (O4 + pengembalian TikTok)', [o.returInv, o.returNominal], [1, 62000]);
eq('okt: belum cair = O2 (modal tertahan 2.000)', [o.belumCairCount, o.belumCairHpp], [1, 2000]);
eq('okt: iklan', [o.ads.biaya, o.ads.roasKlaim, o.ads.roasAktual], [10000, 8, 108]);
eq('okt: top SKU', o.topSku.slice(0, 2), [{ sku: 'SKU-A', qty: 4 }, { sku: 'SKU-B', qty: 3 }]);
eq('okt: rekon (O1 sesuai, O2 belum, O3+O4 insiden)', R.rekon, { belumDirekap: 1, sesuai: 1, insiden: 2, tercatat: 1, totalPesanan: 4 });
eq('okt: rincian per platform', R.parts.map(x => [x.key, x.s.validInv]), [['SHOPEE_DIANSARI', 1], ['SHOPEE_MITRA', 1], ['TIKTOK_DIANSARI', 10], ['WA_ALL', 2]]);
eq('okt: label bulan', R.monthLabel, 'Oktober 2026');
const T = rep({ month: '2026-10' }).text;
for (const frag of ['📊 *REPORT OMNICHANNEL*', 'Periode: *Oktober 2026*', 'Rp 1.080.000', 'Rp 967.000', 'Rp 941.000', 'Batal: 2 inv (Rp 35.000)', 'Belum direkap 1', 'ROAS klaim 8,00x', '• Shopee - Mitra Diansari: 1 inv'])
  eq('teks WA memuat: ' + frag, T.includes(frag), true);

// ---- Filter platform & bulan lain
o = rep({ month: '2026-10', store: 'SHOPEE_MITRA' }).report.overall;
eq('okt Shopee Mitra: hanya O2 (belum cair)', [o.validInv, o.gross, o.net, o.profit, o.belumCairCount], [1, 10000, 0, 0, 1]);
eq('okt Shopee Mitra: tanpa rincian platform', rep({ month: '2026-10', store: 'shopee_mitra' }).report.parts.length, 0);
o = rep({ month: '2026-10', store: 'WA_ALL' }).report.overall;
eq('okt WA: sukses 2, omset=cair 40.000, batal 1 (20.000)', [o.validInv, o.gross, o.net, o.batalInv, o.batalNominal], [2, 40000, 40000, 1, 20000]);
o = rep({ month: '2026-10', store: 'TIKTOK_DIANSARI' }).report.overall;
eq('okt TikTok Diansari', [o.validInv, o.gross, o.net, o.returNominal], [10, 1000000, 900000, 50000]);
o = rep({ month: '2026-09' }).report.overall;
eq('sep: hanya O5 (omset 15.000, cair 13.000, HPP 5.000, laba 8.000)', [o.validInv, o.gross, o.net, o.hpp, o.profit], [1, 15000, 13000, 5000, 8000]);
o = rep({ month: 'ALL' }).report.overall;
eq('semua bulan: omset = okt + sep', o.gross, 1080000 + 15000);
eq('bulan tanpa data -> pesan ramah', rep({ month: '2025-01' }).text.includes('Belum ada data untuk periode dan filter ini.'), true);

// ---- Default bulan = bulan berjalan (Asia/Jakarta); input tidak valid ditolak dengan pesan jelas
eq('tanpa month -> bulan berjalan', rep({}).report.month, fmtDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'));
eq('month "2026-13" ditolak', [rep({ month: '2026-13' }).success, rep({ month: '2026-13' }).message.includes('Format bulan')], [false, true]);
eq('filter tidak dikenal ditolak', rep({ month: '2026-10', store: 'LAZADA' }).success, false);

// ---- Rekon hanya tampil jika spreadsheet admin terbaca; tidak ada -> baris rekon tidak muncul
delete props.SPREADSHEET_ADMIN_ID; load();
R = rep({ month: '2026-10' }).report;
eq('tanpa spreadsheet admin: rekon null & teks tanpa blok rekon', [R.rekon, R.text.includes('Rekon spreadsheet admin')], [null, false]);
props.SPREADSHEET_ADMIN_ID = 'admin-id'; load();

// ---- ping: versi berubah setelah upload (via kunci n8n) dan saveWa; tidak berubah jika upload tidak mengubah apa pun
const v0 = post({ action: 'ping', apiKey: 'kunci-n8n' }).version;
eq('ping memberi versi', typeof v0, 'string');
eq('ping stabil bila tak ada perubahan', post({ action: 'ping', apiKey: 'kunci-n8n' }).version, v0);
const up1 = post({ action: 'upload', apiKey: 'kunci-n8n', payload: { storeName: 'Diansari Plastik', fileType: 'pesanan', data: [{ 'No. Pesanan': 'O9', 'Status Pesanan': 'Selesai', 'Waktu Pesanan Dibuat': '2026-10-20', 'SKU Induk': 'SKU-A', 'Nama Variasi': 'V1', 'Jumlah': '1', 'Harga Setelah Diskon': '15000' }] } });
eq('n8n boleh upload', [up1.success, up1.inserted], [true, 1]);
const v1 = post({ action: 'ping', apiKey: 'kunci-n8n' }).version;
eq('versi berubah setelah upload', v1 !== v0, true);
const up2 = post({ action: 'upload', apiKey: 'kunci-n8n', payload: { storeName: 'Diansari Plastik', fileType: 'pesanan', data: [{ 'No. Pesanan': 'O9', 'Status Pesanan': 'Selesai', 'Waktu Pesanan Dibuat': '2026-10-20', 'SKU Induk': 'SKU-A', 'Nama Variasi': 'V1', 'Jumlah': '1', 'Harga Setelah Diskon': '15000' }] } });
eq('upload identik = no-op, versi tidak berubah', [up2.inserted, up2.updated, post({ action: 'ping', apiKey: 'kunci-n8n' }).version], [0, 0, v1]);
post({ action: 'saveWa', password: pw, payload: { tanggal: '2026-10-21', sku: 'SKU-A', varian: 'V1', qty: 1, hargaJual: 1, hpp: 1, laba: 0, margin: 0, status: 'Sukses' } });
eq('versi berubah setelah saveWa', post({ action: 'ping', apiKey: 'kunci-n8n' }).version !== v1, true);
eq('report ikut memuat data baru (O9 masuk)', rep({ month: '2026-10', store: 'SHOPEE_DIANSARI' }).report.overall.validInv, 2);
