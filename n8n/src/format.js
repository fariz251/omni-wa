// Menyusun balasan dari respons Apps Script. Jika gagal, balasan berisi penyebabnya (bukan diam).
const ctx = $('Parse perintah').first().json;
const r = $input.first().json || {};

let parsed = null;
const raw = r.data !== undefined ? r.data : r;
try { parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }

let text;
if (parsed && parsed.success && parsed.text) {
  text = parsed.text;
} else if (parsed && parsed.message) {
  text = '⚠️ Gagal mengambil report: ' + parsed.message;
} else if (r.error) {
  text = '⚠️ Gagal menghubungi Apps Script: ' + String((r.error && (r.error.message || r.error.description)) || r.error).slice(0, 300);
} else {
  text = '⚠️ Gagal mengambil report: respons server tidak valid. Pastikan Web App di-deploy dengan akses "Anyone" dan GAS_URL benar.';
}

return [{ json: { chatId: ctx.chatId, wahaUrl: ctx.wahaUrl, wahaKey: ctx.wahaKey, session: ctx.session, replyText: text } }];
