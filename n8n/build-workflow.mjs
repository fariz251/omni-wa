// Menyusun n8n/waha-report.workflow.json dari kode di n8n/src. Jalankan: npm run build:n8n
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const parseJs = fs.readFileSync(path.join(dir, 'src/parse.js'), 'utf8');
const formatJs = fs.readFileSync(path.join(dir, 'src/format.js'), 'utf8');

const note = [
  '## Report WhatsApp (/report) via WAHA',
  '1. Buka node **Parse perintah** dan isi CONFIG (GAS_URL, N8N_KEY, WAHA_URL, nomor yang diizinkan).',
  '2. Aktifkan workflow, lalu salin **Production URL** node Webhook.',
  '3. Di WAHA, set webhook session ke URL itu dengan event `message`.',
  '4. Kirim `/report`, `/report oktober`, atau `/report shopee mitra` dari nomor yang diizinkan.',
  'Nomor di luar daftar diabaikan tanpa balasan.',
].join('\n');

const wf = {
  id: 'wahaReport001',
  versionId: 'd4e5f6a7-1b2c-4d3e-8f90-a1b2c3d4e5f6',
  name: 'WAHA - Report Omnichannel (/report)',
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  nodes: [
    { id: 'a1000000-0000-4000-8000-000000000001', name: 'Catatan', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-200, -220], parameters: { content: note, height: 200, width: 560 } },
    { id: 'a1000000-0000-4000-8000-000000000002', name: 'Webhook WAHA', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: 'b2f6c7a4-5d1e-4c53-9a3b-6f2d8e1c4a90',
      parameters: { httpMethod: 'POST', path: 'waha-report', responseMode: 'onReceived', options: {} } },
    { id: 'a1000000-0000-4000-8000-000000000003', name: 'Parse perintah', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0],
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseJs } },
    { id: 'a1000000-0000-4000-8000-000000000004', name: 'Perintah valid?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [480, 0],
      parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: 'c3000000-0000-4000-8000-000000000001', leftValue: '={{ $json.ok }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} } },
    { id: 'a1000000-0000-4000-8000-000000000005', name: 'Ambil report (Apps Script)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [720, -100], onError: 'continueRegularOutput',
      parameters: { method: 'POST', url: '={{ $json.gasUrl }}', sendBody: true, contentType: 'raw', rawContentType: 'text/plain', body: '={{ $json.gasBody }}',
        options: { timeout: 90000 } } },
    { id: 'a1000000-0000-4000-8000-000000000006', name: 'Format balasan', type: 'n8n-nodes-base.code', typeVersion: 2, position: [960, -100],
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: formatJs } },
    { id: 'a1000000-0000-4000-8000-000000000007', name: 'Kirim balasan (WAHA)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1200, 0],
      parameters: { method: 'POST', url: '={{ $json.wahaUrl }}/api/sendText', sendHeaders: true,
        headerParameters: { parameters: [{ name: 'X-Api-Key', value: '={{ $json.wahaKey }}' }] },
        sendBody: true, contentType: 'json', specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ chatId: $json.chatId, text: $json.replyText, session: $json.session }) }}', options: { timeout: 30000 } } },
  ],
  connections: {
    'Webhook WAHA': { main: [[{ node: 'Parse perintah', type: 'main', index: 0 }]] },
    'Parse perintah': { main: [[{ node: 'Perintah valid?', type: 'main', index: 0 }]] },
    'Perintah valid?': { main: [
      [{ node: 'Ambil report (Apps Script)', type: 'main', index: 0 }],   // true
      [{ node: 'Kirim balasan (WAHA)', type: 'main', index: 0 }],         // false -> balasan bantuan/kesalahan
    ] },
    'Ambil report (Apps Script)': { main: [[{ node: 'Format balasan', type: 'main', index: 0 }]] },
    'Format balasan': { main: [[{ node: 'Kirim balasan (WAHA)', type: 'main', index: 0 }]] },
  },
};

fs.writeFileSync(path.join(dir, 'waha-report.workflow.json'), JSON.stringify(wf, null, 2) + '\n');
console.log('ditulis: n8n/waha-report.workflow.json');
