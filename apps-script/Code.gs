/**
 * Montrack – kurir email bukti bayar dari Gmail ke Montrack.
 *
 * CARA PASANG (sekali saja):
 * 1. Buka https://script.google.com → New project → tempel seluruh file ini.
 * 2. Project Settings (ikon gerigi) → Script Properties → tambahkan:
 *      MONTRACK_URL    = https://montrack.<akun-kamu>.workers.dev
 *      MONTRACK_SECRET = (nilai INGEST_SECRET yang kamu set di Cloudflare)
 * 3. Pilih fungsi `setup` → Run → izinkan akses Gmail.
 *    Ini memasang pemicu tiap 5 menit dan mengirim email 30 hari terakhir.
 *
 * Script ini berjalan di akun Google kamu sendiri. Montrack tidak pernah
 * memegang akses ke Gmail; script hanya MENGIRIM email dari pengirim di bawah.
 */

// Pengirim yang dipantau. Tambahkan domain lain bila perlu.
var SENDERS = [
  'bri.co.id',
  'bni.co.id',
  'bankbsi.co.id',
  'gopay.co.id',
  'gojek.com',
  'ovo.id',
  'dana.id',
  'shopee.co.id',
  'shopeepay.co.id',
  'linkaja.id',
  'bca.co.id',
  'bankmandiri.co.id',
];

var SENT_KEY = 'sentIds';
// Sama dengan batas server (MAX_EMAILS_PER_REQUEST): paket gratis Cloudflare
// hanya mengizinkan 50 query database per request.
var BATCH_SIZE = 4;
var KEEP_DAYS = 10;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  backfill(30);
}

/** Dipanggil pemicu tiap 5 menit. */
function run() {
  sync_('newer_than:2d', 100);
}

/** Kirim ulang riwayat N hari terakhir (aman diulang; server menolak duplikat). */
function backfill(days) {
  sync_('newer_than:' + (days || 30) + 'd', 2000);
}

function buildQuery_(extra) {
  return '{' + SENDERS.map(function (s) { return 'from:' + s; }).join(' ') + '} ' + extra;
}

function sync_(extra, maxThreads) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MONTRACK_URL');
  var secret = props.getProperty('MONTRACK_SECRET');
  if (!url || !secret) throw new Error('Isi MONTRACK_URL dan MONTRACK_SECRET di Script Properties.');

  var sent = loadSent_(props);
  var batch = [];
  var total = 0;
  var start = 0;
  var pageSize = 50;
  while (start < maxThreads) {
    var threads = GmailApp.search(buildQuery_(extra), start, pageSize);
    if (!threads.length) break;
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        var id = m.getId();
        if (sent[id]) return;
        var html = m.getBody() || '';
        batch.push({
          messageId: id,
          from: m.getFrom(),
          subject: m.getSubject(),
          date: m.getDate().toISOString(),
          body: html.length > 0 ? html.slice(0, 200000) : m.getPlainBody(),
        });
        if (batch.length >= BATCH_SIZE) {
          total += post_(url, secret, batch, sent);
          batch = [];
        }
      });
    });
    if (threads.length < pageSize) break;
    start += pageSize;
  }
  if (batch.length) total += post_(url, secret, batch, sent);
  saveSent_(props, sent);
  if (total) console.log('Terkirim ' + total + ' email ke Montrack.');
}

function post_(url, secret, emails, sent) {
  var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/ingest/email', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ emails: emails }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('Gagal kirim (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    return 0;
  }
  // Hanya tandai terkirim yang benar-benar diproses; "deferred"/"error" dicoba lagi nanti.
  var results = [];
  try { results = JSON.parse(res.getContentText()).results || []; } catch (e) {}
  var now = Date.now();
  var ok = 0;
  results.forEach(function (r) {
    if (r.status === 'deferred') return;
    if (r.status === 'error') {
      console.error('Gagal memproses ' + r.messageId + ': ' + r.reason);
      return;
    }
    sent[r.messageId] = now;
    ok++;
  });
  return ok;
}

function loadSent_(props) {
  try {
    var raw = JSON.parse(props.getProperty(SENT_KEY) || '{}');
    var cutoff = Date.now() - KEEP_DAYS * 86400000;
    Object.keys(raw).forEach(function (k) { if (raw[k] < cutoff) delete raw[k]; });
    return raw;
  } catch (e) {
    return {};
  }
}

function saveSent_(props, sent) {
  props.setProperty(SENT_KEY, JSON.stringify(sent));
}
