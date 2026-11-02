/**
 * ==========================================
 * OMNICHANNEL PERFORMANCE DECK (V14.19)
 * Backend - Code.gs (API bridge untuk frontend GitHub/Vercel)
 * Fitur: Multi-Sheet Admin Reconciliation Tracking
 * ==========================================
 */

// ID spreadsheet admin dibaca dari Script Properties (Project Settings -> Script Properties):
//   SPREADSHEET_ADMIN_ID = <id spreadsheet admin>   (opsional, kosongkan jika tidak dipakai)
//   APP_PASSWORD         = <password untuk membuka aplikasi>
//   N8N_KEY              = <kunci rahasia untuk n8n; hanya boleh ping/report/upload>  (opsional)
const SPREADSHEET_ADMIN_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ADMIN_ID') || '';

/**
 * API untuk frontend yang dihosting di GitHub/Vercel.
 * Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".
 * Semua request berupa POST (text/plain, supaya tanpa preflight CORS) berisi JSON:
 *   { action: 'ping' | 'getData' | 'upload' | 'saveWa' | 'report', password: '...' (atau apiKey: '...' untuk n8n), payload: {...} }
 */
function doGet(e) {
  return jsonOut_({ success: true, message: 'Omnichannel API aktif (v14.19)' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('APP_PASSWORD')) return jsonOut_({ success: false, message: 'APP_PASSWORD belum diatur di Script Properties' });
    if (!authorize_(req)) return jsonOut_({ success: false, code: 401, message: 'Password salah atau belum diisi' });

    const p = req.payload || {};
    switch (req.action) {
      case 'ping':
        return jsonOut_({ success: true, version: dataVersion_() });
      case 'getData':
        return jsonOut_(getDashboardData());
      case 'report':
        return jsonOut_(buildReport_(p));
      case 'upload':
        if (!p.storeName) return jsonOut_({ success: false, message: 'Nama toko wajib diisi' });
        return jsonOut_(withLock_(() => {
          const r = uploadData(JSON.stringify(p.data || []), String(p.storeName), String(p.fileType || ''));
          if (r.success && (r.inserted || r.updated)) bumpVersion_();
          return r;
        }));
      case 'saveWa':
        return jsonOut_(withLock_(() => { const r = saveWaTransaction(p); if (r.success) bumpVersion_(); return r; }));
      default:
        return jsonOut_({ success: false, message: 'Action tidak dikenal: ' + req.action });
    }
  } catch (error) {
    return jsonOut_({ success: false, message: 'Error Server: ' + error.toString() });
  }
}

// Dua jalur akses:
//  - Dashboard: kirim "password" = APP_PASSWORD -> boleh semua action.
//  - n8n: kirim "apiKey" = N8N_KEY (Script Properties) -> hanya boleh ping, report, upload.
function authorize_(req) {
  const props = PropertiesService.getScriptProperties();
  const pw = props.getProperty('APP_PASSWORD'); const key = props.getProperty('N8N_KEY');
  if (pw && String(req.password || '') === pw) return 'app';
  if (key && String(req.apiKey || '') === key && ['ping', 'report', 'upload'].indexOf(req.action) !== -1) return 'n8n';
  return null;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Cegah dua upload/penyimpanan berjalan bersamaan dan saling menimpa
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// DEFINISI HEADER SHEET
const SHEET_PESANAN = 'Database';
const HEADERS_PESANAN = ["No. Pesanan", "Status Pesanan", "Alasan Pembatalan", "Status Pembatalan/Pengembalian", "Waktu Pesanan Dibuat", "Waktu Pengiriman Diatur", "Metode Pembayaran", "SKU Induk", "Nama Variasi", "Jumlah", "Harga Setelah Diskon", "Provinsi", "Nama Toko"];

const SHEET_PENGHASILAN = 'Penghasilan';
const HEADERS_PENGHASILAN = ["No. Pesanan", "Lihat berdasarkan", "No Pengajuan", "ID Produk", "Nama Produk", "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Total Penghasilan", "Nama Toko"];

const SHEET_MASTER = 'Master Produk';
const HEADERS_MASTER = ["SKU Induk", "Nama Variasi", "HPP (Modal)"];

const SHEET_WA = 'Data_WA';
const HEADERS_WA = ["Tanggal", "No. Transaksi", "Status", "Alasan", "SKU Induk", "Varian", "Qty", "Harga Jual (Gross)", "HPP (Modal)", "Laba Bersih", "Margin (%)", "Nama Toko"];

const SHEET_IKLAN = 'Data_Iklan';
const HEADERS_IKLAN = ["Nama Iklan", "Jenis Iklan", "Kode Produk", "Tanggal Mulai", "Tanggal Selesai", "Biaya", "Omzet Penjualan", "Produk Terjual", "Nama Toko", "Periode Laporan"];

const SHEET_TIKTOK_TOKPED = 'Data_Tiktok_Tokped';
const HEADERS_TIKTOK_TOKPED = ["Tanggal", "Platform", "Nama Toko", "GMV (Omset)", "Pesanan", "Pembeli", "Produk Terjual", "Pengembalian Dana", "Pesanan SKU", "Pendapatan Bruto"];

function setupSheet() {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let sheetP = ss.getSheetByName(SHEET_PESANAN);
  if (!sheetP) { sheetP = ss.insertSheet(SHEET_PESANAN); sheetP.appendRow(HEADERS_PESANAN); sheetP.getRange(1, 1, 1, HEADERS_PESANAN.length).setFontWeight("bold").setBackground("#f3f4f6"); }

  let sheetH = ss.getSheetByName(SHEET_PENGHASILAN);
  if (!sheetH) { sheetH = ss.insertSheet(SHEET_PENGHASILAN); sheetH.appendRow(HEADERS_PENGHASILAN); sheetH.getRange(1, 1, 1, HEADERS_PENGHASILAN.length).setFontWeight("bold").setBackground("#d1fae5"); }

  let sheetM = ss.getSheetByName(SHEET_MASTER);
  if (!sheetM) { sheetM = ss.insertSheet(SHEET_MASTER); sheetM.appendRow(HEADERS_MASTER); sheetM.getRange(1, 1, 1, HEADERS_MASTER.length).setFontWeight("bold").setBackground("#fef08a"); }
  
  let sheetW = ss.getSheetByName(SHEET_WA);
  if (!sheetW) { sheetW = ss.insertSheet(SHEET_WA); sheetW.appendRow(HEADERS_WA); sheetW.getRange(1, 1, 1, HEADERS_WA.length).setFontWeight("bold").setBackground("#dcfce3"); } 
  else {
    let existingHeaders = sheetW.getRange(1, 1, 1, sheetW.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf("Nama Toko") === -1) { sheetW.getRange(1, existingHeaders.length + 1).setValue("Nama Toko").setFontWeight("bold").setBackground("#dcfce3"); }
  }

  let sheetI = ss.getSheetByName(SHEET_IKLAN);
  if (!sheetI) { sheetI = ss.insertSheet(SHEET_IKLAN); sheetI.appendRow(HEADERS_IKLAN); sheetI.getRange(1, 1, 1, HEADERS_IKLAN.length).setFontWeight("bold").setBackground("#fbcfe8"); } 
  else {
      let existingHeaders = sheetI.getRange(1, 1, 1, sheetI.getLastColumn()).getValues()[0];
      if (existingHeaders.indexOf("Periode Laporan") === -1) { sheetI.getRange(1, existingHeaders.length + 1).setValue("Periode Laporan").setFontWeight("bold").setBackground("#fbcfe8"); }
  }

  let sheetT = ss.getSheetByName(SHEET_TIKTOK_TOKPED);
  if (!sheetT) { sheetT = ss.insertSheet(SHEET_TIKTOK_TOKPED); sheetT.appendRow(HEADERS_TIKTOK_TOKPED); sheetT.getRange(1, 1, 1, HEADERS_TIKTOK_TOKPED.length).setFontWeight("bold").setBackground("#e0e7ff"); }

  return { sheetPesanan: sheetP, sheetPenghasilan: sheetH, sheetMaster: sheetM, sheetWa: sheetW, sheetIklan: sheetI, sheetTiktokTokped: sheetT };
}

function uploadData(jsonData, storeName, fileType) {
  try {
    let sheets = setupSheet(); 
    let data = JSON.parse(jsonData);
    if (data.length === 0) return { success: true, message: "Tidak ada data baru.", inserted: 0, updated: 0 };

    let sheet; let headers; let keyCols = [];
    if (fileType === 'penghasilan') { sheet = sheets.sheetPenghasilan; headers = HEADERS_PENGHASILAN; keyCols = ["No. Pesanan"]; }
    else if (fileType === 'iklan') { sheet = sheets.sheetIklan; headers = HEADERS_IKLAN; keyCols = ["Nama Iklan", "Kode Produk", "Tanggal Mulai", "Periode Laporan"]; }
    else if (fileType === 'tiktok' || fileType === 'tokopedia') { sheet = sheets.sheetTiktokTokped; headers = HEADERS_TIKTOK_TOKPED; keyCols = ["Tanggal", "Platform"]; }
    else { sheet = sheets.sheetPesanan; headers = HEADERS_PESANAN; keyCols = ["No. Pesanan", "SKU Induk", "Nama Variasi"]; }
    
    let existingData = sheet.getDataRange().getDisplayValues();
    if (existingData.length === 0) { existingData = [headers]; }

    let idxMap = {};
    keyCols.forEach(col => {
        let idx = existingData[0].indexOf(col);
        if (idx !== -1) idxMap[col] = idx;
    });
    
    let rowMap = {}; let idxStore = existingData[0].indexOf("Nama Toko");
    for (let i = 1; i < existingData.length; i++) {
      let row = existingData[i]; 
      let rowStore = (idxStore !== -1 && String(row[idxStore] || "").trim()) || storeName;
      let pKey = keyCols.map(c => String(row[idxMap[c]] || "").trim()).join("_") + "_" + rowStore;
      if (pKey) { rowMap[pKey] = i; } 
    }

    let insertedCount = 0; let updatedCount = 0;
    for (let i = 0; i < data.length; i++) {
      let row = data[i]; 
      
      let pKeyParts = []; let isRowValid = false;
      keyCols.forEach(col => { 
          let val = String(row[col] || "").trim(); 
          pKeyParts.push(val); 
          if(val !== "") isRowValid = true; 
      });
      if(!isRowValid) continue; 

      let pKey = pKeyParts.join("_") + "_" + storeName;

      let newRow = [];
      headers.forEach(header => {
        if (header === "Nama Toko") { newRow.push(storeName); } 
        else {
          let val = row[header] !== undefined ? row[header] : "";
          if (header === "Harga Setelah Diskon" || header === "Jumlah" || header === "Total Penghasilan" || header === "Biaya" || header === "Omzet Penjualan" || header === "Produk Terjual" || header === "GMV (Omset)" || header === "Pesanan" || header === "Pembeli" || header === "Pengembalian Dana" || header === "Pesanan SKU" || header === "Pendapatan Bruto") { 
             val = parseInt(val) || 0; 
          }
          newRow.push(val);
        }
      });
      
      if (rowMap[pKey] !== undefined) {
         let existingIndex = rowMap[pKey]; 
         let oldFingerprint = existingData[existingIndex].join("|||").toLowerCase(); 
         let newFingerprint = newRow.join("|||").toLowerCase();
         if (oldFingerprint !== newFingerprint) { existingData[existingIndex] = newRow; updatedCount++; }
      } else { 
         existingData.push(newRow); 
         rowMap[pKey] = existingData.length - 1; 
         insertedCount++; 
      }
    }
    
    sheet.getRange(1, 1, existingData.length, headers.length).setValues(existingData);
    return { success: true, message: `Sukses diproses.`, inserted: insertedCount, updated: updatedCount };
  } catch (error) { return { success: false, message: "Error Server: " + error.toString() }; }
}

function saveWaTransaction(formData) {
  try {
    let sheets = setupSheet(); let sheetW = sheets.sheetWa; let orderId = formData.orderId || ('WA-' + new Date().getTime());
    let newRow = [formData.tanggal, orderId, formData.status, formData.alasan || "-", formData.sku, formData.varian, formData.qty, formData.hargaJual, formData.hpp, formData.laba, formData.margin, formData.toko || "-" ];
    sheetW.appendRow(newRow);
    return { success: true, message: "Transaksi WhatsApp berhasil disimpan!" };
  } catch (error) { return { success: false, message: "Gagal menyimpan WA: " + error.toString() }; }
}

function getDashboardData() {
  try {
    let sheets = setupSheet();

    // Dikirim sebagai array-of-arrays (header + baris) agar payload ringkas;
    // frontend yang mengubahnya menjadi array objek.
    let toRows = (sheet) => sheet.getDataRange().getDisplayValues();

    let admin = readAdminOrders_();

    return {
      success: true,
      tables: {
        pesanan: toRows(sheets.sheetPesanan),
        penghasilan: toRows(sheets.sheetPenghasilan),
        master: toRows(sheets.sheetMaster),
        wa: toRows(sheets.sheetWa),
        iklan: toRows(sheets.sheetIklan),
        tiktok: toRows(sheets.sheetTiktokTokped)
      },
      adminOrders: admin.orders,
      adminInfo: admin.info,
      version: dataVersion_()
    };
  } catch (error) { return { success: false, message: "Gagal memuat data: " + error.toString() }; }
}

// ---------------------------------------------------------------
// Rekonsiliasi: baca semua tab (yang tidak disembunyikan) di spreadsheet admin.
// Mengembalikan { orders: { "NO PESANAN": [tanggal, namaTab] }, info: {...diagnostik...} }
// Header dicari di 10 baris pertama dan dicocokkan tanpa memperhatikan huruf besar/kecil,
// spasi, dan tanda baca ("NO PESANAN", "No. Pesanan", "no  pesanan" dianggap sama).
// ---------------------------------------------------------------
function normHeader_(h) { return String(h).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function readAdminOrders_() {
  let orders = {};
  let info = { configured: !!SPREADSHEET_ADMIN_ID, error: '', totalIds: 0, sheets: [] };
  if (!SPREADSHEET_ADMIN_ID) return { orders: orders, info: info };

  try {
    let adminSs = SpreadsheetApp.openById(SPREADSHEET_ADMIN_ID);
    adminSs.getSheets().forEach(sheet => {
      let name = sheet.getName();
      if (sheet.isSheetHidden()) { info.sheets.push({ name: name, status: 'disembunyikan', ids: 0 }); return; }

      let raw = sheet.getDataRange().getDisplayValues();
      if (raw.length === 0) { info.sheets.push({ name: name, status: 'kosong', ids: 0 }); return; }

      let hdrRow = -1, idxId = -1, idxTgl = -1;
      for (let r = 0; r < Math.min(10, raw.length); r++) {
        let h = raw[r].map(normHeader_);
        let i = h.indexOf('NOPESANAN');
        if (i === -1) continue;
        hdrRow = r; idxId = i;
        idxTgl = h.indexOf('TANGGALPENCATATAN');
        if (idxTgl === -1) idxTgl = h.indexOf('TANGGAL');
        break;
      }
      if (hdrRow === -1) {
        info.sheets.push({ name: name, status: 'kolom NO PESANAN tidak ditemukan', ids: 0, headers: raw[0].slice(0, 8) });
        return;
      }

      let n = 0, sample = [];
      for (let i = hdrRow + 1; i < raw.length; i++) {
        let id = String(raw[i][idxId]).trim();
        if (!id) continue;
        let tgl = (idxTgl !== -1) ? String(raw[i][idxTgl]).trim() : '-';
        orders[id] = [tgl, name];
        n++; if (sample.length < 2) sample.push(id);
      }
      info.totalIds += n;
      info.sheets.push({ name: name, status: 'ok', ids: n, headerRow: hdrRow + 1, sample: sample });
    });
  } catch (e) {
    info.error = String(e && e.message ? e.message : e);
    console.error('Gagal membaca Spreadsheet Admin: ' + info.error);
  }
  return { orders: orders, info: info };
}

// Jalankan manual dari editor Apps Script (pilih fungsi ini -> Run) untuk mengecek koneksi rekon.
// Pertama kali dijalankan, Google akan meminta izin akses spreadsheet: setujui.
// Hasilnya muncul di panel "Execution log".
function cekSpreadsheetAdmin() {
  let r = readAdminOrders_();
  Logger.log(JSON.stringify(r.info, null, 2));
  return r.info;
}

// ===============================================================
// REPORT (WhatsApp via n8n + WAHA)
// Port setia dari logika dashboard (applyFilter, prepareTableData, renderDashboard,
// renderIklanDashboard, prepareRekonData) supaya angka di WA = angka di web.
// Dipanggil: { action:'report', apiKey:'<N8N_KEY>', payload:{ month:'2026-10'|'ALL'|kosong, store:'ALL'|'SHOPEE_MITRA'|... } }
// ===============================================================
const REPORT_KEYS = ['ALL', 'SHOPEE_DIANSARI', 'SHOPEE_MITRA', 'TIKTOK_DIANSARI', 'TIKTOK_MITRA', 'TOKPED_DIANSARI', 'TOKPED_MITRA', 'WA_ALL'];
const REPORT_LABELS = {
  ALL: 'Semua Platform (Gabungan)', SHOPEE_DIANSARI: 'Shopee - Diansari Plastik', SHOPEE_MITRA: 'Shopee - Mitra Diansari',
  TIKTOK_DIANSARI: 'TikTok Shop - Diansari', TIKTOK_MITRA: 'TikTok Shop - Mitra', TOKPED_DIANSARI: 'Tokopedia - Diansari',
  TOKPED_MITRA: 'Tokopedia - Mitra', WA_ALL: 'WhatsApp (Direct)'
};
const NAMA_BULAN_ = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function normalizeDateString_(rawDate) {
  if (!rawDate) return "";
  let dStr = String(rawDate).trim().split(" ")[0].split("T")[0];
  if (dStr.indexOf("/") !== -1) {
    let parts = dStr.split("/");
    if (parts.length === 3) { let year = parts[2].length <= 2 ? '20' + parts[2].slice(-2) : parts[2]; return year + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0'); }
  } else if (dStr.indexOf("-") !== -1) {
    let parts = dStr.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
      let year = parts[2].length <= 2 ? '20' + parts[2].slice(-2) : parts[2]; return year + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }
  }
  return dStr;
}

function fmtNum_(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fmtRp_(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-Rp ' : 'Rp ') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fmtPct_(n, d) { return Number(n || 0).toFixed(d).replace('.', ','); }

function currentMonth_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM'); }

function normalizeReportMonth_(m) {
  if (m === undefined || m === null || String(m).trim() === '') return currentMonth_();
  const s = String(m).trim().toUpperCase();
  if (s === 'ALL' || s === 'SEMUA') return 'ALL';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  throw new Error('Format bulan tidak valid: "' + m + '". Pakai YYYY-MM (mis. 2026-10) atau ALL.');
}

function sheetObjects_(sheet) {
  const raw = sheet.getDataRange().getDisplayValues(); const out = [];
  if (raw.length > 1) { const h = raw[0]; for (let i = 1; i < raw.length; i++) { const o = {}; for (let j = 0; j < h.length; j++) o[h[j]] = raw[i][j]; out.push(o); } }
  return out;
}

// = applyFilter() di dashboard
function reportFilter_(data, month, main) {
  const monthOk = (d) => month === 'ALL' ? true : normalizeDateString_(d).indexOf(month) === 0;
  const storeOk = (row) => main === 'ALL' ? true : (main === 'SHOPEE_DIANSARI' ? String(row["Nama Toko"]).toLowerCase() === 'diansari plastik' : String(row["Nama Toko"]).toLowerCase() === 'mitra diansari');
  const f = { pesanan: [], penghasilan: [], wa: [], iklan: [], tt: [] };

  if (main === 'ALL' || main.indexOf('SHOPEE') === 0) {
    f.pesanan = data.pesanan.filter(r => monthOk(r["Waktu Pesanan Dibuat"]) && storeOk(r));
    f.penghasilan = data.penghasilan.filter(r => String(r["Lihat berdasarkan"] || "").trim().toLowerCase() === "order" && monthOk(r["Waktu Pesanan Dibuat"]) && storeOk(r));
    f.iklan = data.iklan.filter(r => {
      let d = r["Periode Laporan"] ? normalizeDateString_(r["Periode Laporan"]) : normalizeDateString_(r["Tanggal Mulai"]);
      return (month === 'ALL' ? true : d.indexOf(month) === 0) && storeOk(r);
    });
  }
  if (main === 'ALL' || main === 'WA_ALL') f.wa = data.wa.filter(r => monthOk(r["Tanggal"]));
  if (main === 'ALL' || main.indexOf('TIKTOK') === 0 || main.indexOf('TOKPED') === 0) {
    f.tt = data.tt.filter(r => {
      let plat = String(r["Platform"]).toUpperCase(); let store = String(r["Nama Toko"]).toUpperCase(); let ok = false;
      if (main === 'ALL') ok = true;
      else if (main === 'TIKTOK_DIANSARI' && plat.indexOf('TIKTOK') !== -1 && store.indexOf('DIANSARI PLASTIK') !== -1) ok = true;
      else if (main === 'TIKTOK_MITRA' && plat.indexOf('TIKTOK') !== -1 && store.indexOf('MITRA DIANSARI') !== -1) ok = true;
      else if (main === 'TOKPED_DIANSARI' && plat.indexOf('TOKOPEDIA') !== -1 && store.indexOf('DIANSARI PLASTIK') !== -1) ok = true;
      else if (main === 'TOKPED_MITRA' && plat.indexOf('TOKOPEDIA') !== -1 && store.indexOf('MITRA DIANSARI') !== -1) ok = true;
      return monthOk(r["Tanggal"]) && ok;
    });
  }
  return f;
}

// = prepareTableData() + renderDashboard() + renderIklanDashboard() di dashboard
function reportSummarize_(f, hppDict) {
  // --- prepareTableData: gabungkan per pesanan
  const orderMap = {};
  f.pesanan.forEach(row => {
    const orderId = String(row["No. Pesanan"] || "").trim(); if (!orderId) return;
    const isBatal = String(row["Status Pesanan"]).toLowerCase().indexOf("batal") !== -1 || String(row["Alasan Pembatalan"]).trim() !== "";
    const isRetur = String(row["Status Pembatalan/Pengembalian"]).toLowerCase().indexOf("disetujui") !== -1;
    if (!isBatal && !isRetur) {
      const qty = parseInt(row["Jumlah"]) || 1; const harga = parseInt(row["Harga Setelah Diskon"]) || 0; const gross = harga * qty;
      const sku = String(row["SKU Induk"] || "").trim(); const variasi = String(row["Nama Variasi"] || "").trim();
      let hppItem = hppDict[sku + '_' + variasi]; const isHppSet = (hppItem !== undefined); if (!isHppSet) hppItem = 0;
      if (!orderMap[orderId]) orderMap[orderId] = { sumber: 'Shopee', gross: 0, net: 0, totalHpp: 0 };
      orderMap[orderId].gross += gross; orderMap[orderId].totalHpp += (hppItem * qty);
    }
  });
  f.penghasilan.forEach(row => {
    const orderId = String(row["No. Pesanan"] || "").trim(); if (!orderId) return; const net = parseInt(row["Total Penghasilan"]) || 0;
    if (orderMap[orderId]) orderMap[orderId].net += net; else orderMap[orderId] = { sumber: 'Shopee', gross: 0, net: net, totalHpp: 0 };
  });
  f.wa.forEach(row => {
    const orderId = String(row["No. Transaksi"] || "").trim(); const st = String(row["Status"] || "").toLowerCase();
    if (st === 'sukses') {
      const qty = parseInt(row["Qty"]) || 0; const hrg = parseFloat(row["Harga Jual (Gross)"]) || 0; const hpp = parseFloat(row["HPP (Modal)"]) || 0;
      const gross = qty * hrg; const tHpp = qty * hpp;
      if (!orderMap[orderId]) orderMap[orderId] = { sumber: 'WhatsApp', gross: 0, net: 0, totalHpp: 0 };
      orderMap[orderId].gross += gross; orderMap[orderId].net += gross; orderMap[orderId].totalHpp += tHpp;
    }
  });
  f.tt.forEach(row => {
    const tgl = normalizeDateString_(row["Tanggal"]); const plat = row["Platform"];
    const orderId = 'REKAP-' + String(plat).toUpperCase().substring(0, 3) + '-' + tgl.replace(/-/g, '') + '-' + String(row["Nama Toko"]).substring(0, 3).toUpperCase();
    const gross = parseInt(row["GMV (Omset)"]) || 0; const net = parseInt(row["Pendapatan Bruto"]) || 0;
    if (gross > 0 || net > 0) {
      if (!orderMap[orderId]) orderMap[orderId] = { sumber: plat, gross: 0, net: 0, totalHpp: 0 };
      orderMap[orderId].gross += gross; orderMap[orderId].net += net;
    }
  });
  const items = Object.keys(orderMap).map(k => orderMap[k]);

  // --- renderDashboard: KPI utama
  let totalGross = 0, totalNet = 0, totalItems = 0, validInv = 0, batalInv = 0, totalBatalNominal = 0, returInv = 0, totalReturNominal = 0;
  const skuCount = {}; const shopeeOrders = {}; let shopeeCount = 0;

  f.pesanan.forEach(row => {
    const orderId = String(row["No. Pesanan"] || "").trim(); if (!orderId) return;
    const qty = parseInt(row["Jumlah"]) || 1; const harga = parseInt(row["Harga Setelah Diskon"]) || 0; const gross = harga * qty;
    const stPengembalian = String(row["Status Pembatalan/Pengembalian"] || "").trim().toLowerCase(); const stPesanan = String(row["Status Pesanan"] || "").trim().toLowerCase(); const alasan = String(row["Alasan Pembatalan"] || "").trim();
    if (stPengembalian.indexOf("permintaan disetujui") !== -1) { returInv++; totalReturNominal += gross; }
    else if (stPesanan.indexOf("batal") !== -1 || stPesanan.indexOf("dibatalkan") !== -1 || alasan !== "") { batalInv++; totalBatalNominal += gross; }
    else {
      if (!shopeeOrders[orderId]) { shopeeOrders[orderId] = true; shopeeCount++; }
      totalItems += qty; totalGross += gross;
      const sku = String(row["SKU Induk"] || "Tanpa SKU").trim(); skuCount[sku] = (skuCount[sku] || 0) + qty;
    }
  });
  f.penghasilan.forEach(row => { totalNet += (parseInt(row["Total Penghasilan"]) || 0); });
  validInv += shopeeCount;

  f.wa.forEach(row => {
    const st = String(row["Status"] || "").toLowerCase(); const qty = parseInt(row["Qty"]) || 0; const harga = parseFloat(row["Harga Jual (Gross)"]) || 0; const gross = qty * harga;
    if (st === 'batal') { batalInv++; totalBatalNominal += gross; }
    else if (st === 'retur') { returInv++; totalReturNominal += gross; }
    else { validInv++; totalItems += qty; totalGross += gross; totalNet += gross; const sku = String(row["SKU Induk"] || "Tanpa SKU").trim(); skuCount[sku] = (skuCount[sku] || 0) + qty; }
  });
  f.tt.forEach(row => {
    const gross = parseInt(row["GMV (Omset)"]) || 0; const net = parseInt(row["Pendapatan Bruto"]) || 0; const pesanan = parseInt(row["Pesanan"]) || 0;
    const terjual = parseInt(row["Produk Terjual"]) || 0; const returNominal = parseInt(row["Pengembalian Dana"]) || 0;
    totalGross += gross; totalNet += net; validInv += pesanan; totalItems += terjual;
    if (returNominal > 0) totalReturNominal += returNominal;
  });

  let settledGross = 0, settledNet = 0, settledHpp = 0, shopeeSettledCount = 0, belumCairCount = 0, belumCairHpp = 0;
  items.forEach(item => {
    if (item.net > 0) { settledGross += item.gross; settledNet += item.net; settledHpp += item.totalHpp; if (item.sumber === 'Shopee') shopeeSettledCount++; }
    else if (item.net === 0) { belumCairCount++; belumCairHpp += item.totalHpp; }
  });
  const settledProfit = settledNet - settledHpp; const margin = (settledNet > 0) ? (settledProfit / settledNet * 100) : 0;
  let potongan = 0;
  if (settledGross > 0) { let v = (settledGross - settledNet) - (shopeeSettledCount * 1250); if (v < 0) v = 0; potongan = (v / settledGross) * 100; }

  // --- renderIklanDashboard
  let biaya = 0, omzetKlaim = 0, qtyKlaim = 0;
  f.iklan.forEach(row => { biaya += parseInt(row["Biaya"]) || 0; omzetKlaim += parseInt(row["Omzet Penjualan"]) || 0; qtyKlaim += parseInt(row["Produk Terjual"]) || 0; });
  const ads = {
    biaya: biaya, omzetKlaim: omzetKlaim, qtyKlaim: qtyKlaim,
    acosKlaim: omzetKlaim > 0 ? (biaya / omzetKlaim * 100) : 0, acosAktual: totalGross > 0 ? (biaya / totalGross * 100) : 0,
    roasKlaim: biaya > 0 ? (omzetKlaim / biaya) : 0, roasAktual: biaya > 0 ? (totalGross / biaya) : 0
  };

  const topSku = Object.keys(skuCount).map(k => ({ sku: k, qty: skuCount[k] })).sort((a, b) => b.qty - a.qty).slice(0, 5);

  return {
    validInv: validInv, items: totalItems, gross: totalGross, net: totalNet,
    hpp: settledHpp, profit: settledProfit, margin: margin, potongan: potongan,
    batalInv: batalInv, batalNominal: totalBatalNominal, returInv: returInv, returNominal: totalReturNominal,
    belumCairCount: belumCairCount, belumCairHpp: belumCairHpp, ads: ads, topSku: topSku
  };
}

// = prepareRekonData() di dashboard (hanya untuk Shopee)
function reportRekon_(pesananFiltered, adminOrders) {
  const done = {}; let belum = 0, sesuai = 0, insiden = 0, matched = 0, total = 0;
  pesananFiltered.forEach(row => {
    const orderId = String(row["No. Pesanan"] || "").trim(); if (!orderId || done[orderId]) return; done[orderId] = true; total++;
    const stP = String(row["Status Pembatalan/Pengembalian"] || "").toLowerCase(); const stO = String(row["Status Pesanan"] || "").toLowerCase(); const alasan = String(row["Alasan Pembatalan"] || "").trim();
    const isBatal = stO.indexOf("batal") !== -1 || stO.indexOf("dibatalkan") !== -1 || alasan !== "";
    const isRetur = stP.indexOf("disetujui") !== -1 || stP.indexOf("retur") !== -1;
    const tercatat = (adminOrders[orderId] !== undefined); if (tercatat) matched++;
    if (isBatal || isRetur) insiden++; else if (!tercatat) belum++; else sesuai++;
  });
  return { belumDirekap: belum, sesuai: sesuai, insiden: insiden, tercatat: matched, totalPesanan: total };
}

function reportText_(r) {
  const o = r.overall; const L = [];
  L.push('📊 *REPORT OMNICHANNEL*');
  L.push('Periode: *' + r.monthLabel + '*');
  L.push('Filter: ' + r.mainLabel);
  L.push('_Diperbarui ' + r.generatedAtLabel + ' WIB_');
  L.push('');
  if (o.validInv === 0 && o.gross === 0 && o.batalInv === 0 && o.returInv === 0 && o.net === 0) {
    L.push('Belum ada data untuk periode dan filter ini.');
    return L.join('\n');
  }
  L.push('🧾 Pesanan sukses: *' + fmtNum_(o.validInv) + ' inv* (' + fmtNum_(o.items) + ' item)');
  L.push('💰 Omset kotor: *' + fmtRp_(o.gross) + '*');
  L.push('💸 Cair bersih: *' + fmtRp_(o.net) + '* (potongan ' + fmtPct_(o.potongan, 1) + '%)');
  L.push('💎 Laba (dari yang sudah cair): *' + fmtRp_(o.profit) + '* (margin ' + fmtPct_(o.margin, 1) + '%)');
  L.push('     HPP: ' + fmtRp_(o.hpp));
  if (o.belumCairCount > 0) L.push('⏳ Belum cair: ' + fmtNum_(o.belumCairCount) + ' pesanan (modal tertahan ' + fmtRp_(o.belumCairHpp) + ')');
  L.push('⚠️ Batal: ' + fmtNum_(o.batalInv) + ' inv (' + fmtRp_(o.batalNominal) + ')');
  L.push('↩️ Retur: ' + fmtNum_(o.returInv) + ' inv (' + fmtRp_(o.returNominal) + ')');

  if (r.parts.length) {
    L.push(''); L.push('*Per platform*');
    r.parts.forEach(p => L.push('• ' + p.label + ': ' + fmtNum_(p.s.validInv) + ' inv · omset ' + fmtRp_(p.s.gross) + ' · cair ' + fmtRp_(p.s.net) + ' · laba ' + fmtRp_(p.s.profit)));
  }
  if (o.ads.biaya > 0) {
    L.push(''); L.push('*Iklan Shopee*');
    L.push('Biaya ' + fmtRp_(o.ads.biaya) + ' · ROAS klaim ' + fmtPct_(o.ads.roasKlaim, 2) + 'x · ROAS aktual ' + fmtPct_(o.ads.roasAktual, 2) + 'x');
    L.push('ACOS klaim ' + fmtPct_(o.ads.acosKlaim, 1) + '% · ACOS aktual ' + fmtPct_(o.ads.acosAktual, 1) + '%');
  }
  if (r.rekon) {
    L.push(''); L.push('*Rekon spreadsheet admin*');
    L.push('✅ Sesuai ' + fmtNum_(r.rekon.sesuai) + ' · 🔴 Belum direkap ' + fmtNum_(r.rekon.belumDirekap) + ' · ⚠️ Insiden ' + fmtNum_(r.rekon.insiden));
  }
  if (o.topSku.length) {
    L.push(''); L.push('*Top produk (pcs)*');
    o.topSku.slice(0, 3).forEach((s, i) => L.push((i + 1) + '. ' + s.sku + ' - ' + fmtNum_(s.qty)));
  }
  L.push(''); L.push('_Ketik /report oktober, /report 2026-09, atau /report shopee mitra_');
  return L.join('\n');
}

function buildReport_(p) {
  p = p || {};
  const month = normalizeReportMonth_(p.month);
  const main = (p.store === undefined || p.store === null || String(p.store).trim() === '') ? 'ALL' : String(p.store).trim().toUpperCase();
  if (REPORT_KEYS.indexOf(main) === -1) throw new Error('Filter tidak dikenal: "' + p.store + '". Pilihan: ' + REPORT_KEYS.join(', '));

  const sheets = setupSheet();
  const data = {
    pesanan: sheetObjects_(sheets.sheetPesanan), penghasilan: sheetObjects_(sheets.sheetPenghasilan),
    wa: sheetObjects_(sheets.sheetWa), iklan: sheetObjects_(sheets.sheetIklan), tt: sheetObjects_(sheets.sheetTiktokTokped)
  };
  const hppDict = {};
  sheetObjects_(sheets.sheetMaster).forEach(row => {
    const v = parseInt(String(row["HPP (Modal)"]).replace(/[^0-9]/g, '')) || 0;
    hppDict[String(row["SKU Induk"] || "").trim() + '_' + String(row["Nama Variasi"] || "").trim()] = v;
  });

  const f = reportFilter_(data, month, main);
  const overall = reportSummarize_(f, hppDict);

  const parts = [];
  if (main === 'ALL') {
    REPORT_KEYS.slice(1).forEach(k => {
      const s = reportSummarize_(reportFilter_(data, month, k), hppDict);
      if (s.validInv > 0 || s.gross > 0 || s.net > 0 || s.batalInv > 0) parts.push({ key: k, label: REPORT_LABELS[k], s: s });
    });
  }

  let rekon = null;
  if ((main === 'ALL' || main.indexOf('SHOPEE') === 0) && p.rekon !== false) {
    const adm = readAdminOrders_();
    if (adm.info.configured && !adm.info.error && adm.info.totalIds > 0) rekon = reportRekon_(f.pesanan, adm.orders);
  }

  const now = new Date();
  const out = {
    month: month, monthLabel: month === 'ALL' ? 'Semua Bulan' : (NAMA_BULAN_[parseInt(month.substring(5, 7), 10)] + ' ' + month.substring(0, 4)),
    main: main, mainLabel: REPORT_LABELS[main],
    generatedAt: Utilities.formatDate(now, 'Asia/Jakarta', "yyyy-MM-dd'T'HH:mm:ss"),
    generatedAtLabel: Utilities.formatDate(now, 'Asia/Jakarta', 'dd') + ' ' + NAMA_BULAN_[parseInt(Utilities.formatDate(now, 'Asia/Jakarta', 'M'), 10)].substring(0, 3) + ' ' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy HH:mm'),
    overall: overall, parts: parts, rekon: rekon
  };
  out.text = reportText_(out);
  return { success: true, report: out, text: out.text };
}

// ===============================================================
// Versi data: dipakai dashboard untuk polling "ada data baru?" tanpa mengunduh semuanya
// ===============================================================
function dataVersion_() {
  const props = PropertiesService.getScriptProperties();
  const counter = props.getProperty('DATA_VERSION') || '0';
  const ss = SpreadsheetApp.getActiveSpreadsheet(); let rows = 0;
  [SHEET_PESANAN, SHEET_PENGHASILAN, SHEET_MASTER, SHEET_WA, SHEET_IKLAN, SHEET_TIKTOK_TOKPED].forEach(n => { const sh = ss.getSheetByName(n); if (sh) rows += sh.getLastRow(); });
  return counter + ':' + rows;
}
function bumpVersion_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_VERSION', String((parseInt(props.getProperty('DATA_VERSION') || '0', 10) || 0) + 1));
}

// Jalankan manual dari editor untuk mencoba report tanpa n8n (hasil di Execution log)
function cobaReport() {
  const r = buildReport_({});
  Logger.log(r.text);
  return r.text;
}
