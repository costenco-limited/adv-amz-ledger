// Minimal Amazon SP-API client: LWA token, throttling retries, reports.
const axios = require('axios');
const zlib = require('zlib');

const ENDPOINT = 'https://sellingpartnerapi-eu.amazon.com';

const MARKETPLACES = {
  DE: 'A1PA6795UKMFR9',
  UK: 'A1F83G8C2ARO7P',
  FR: 'A13V1IB3VIYZZH',
  ES: 'A1RKKUPIHCS9HS',
  IT: 'APJ6JRA9NG5V4',
  AE: 'A2VIGQ35RCS4UG',
  NL: 'A1805IZSGTT6HS',
  SA: 'A17E79C6D8DWNP',
  SE: 'A2NODRKZP88ZB9',
  PL: 'A1C3SOZRARQ6R3',
  BE: 'AMEN7PMS3EDWL',
  IE: 'A28R8C7NBKEWEA'
};

// Sales channel names as they appear in order reports and financial events
const CHANNELS = {
  'Amazon.de': 'DE', 'Amazon.co.uk': 'UK', 'Amazon.fr': 'FR', 'Amazon.es': 'ES', 'Amazon.it': 'IT',
  'Amazon.ae': 'AE', 'Amazon.nl': 'NL', 'Amazon.sa': 'SA', 'Amazon.se': 'SE', 'Amazon.pl': 'PL',
  'Amazon.com.be': 'BE', 'Amazon.ie': 'IE'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let token = null;
let tokenExpiry = 0;

async function accessToken() {
  if (token && Date.now() < tokenExpiry) return token;
  const r = await axios.post('https://api.amazon.com/auth/o2/token', {
    grant_type: 'refresh_token',
    refresh_token: env('AMAZON_REFRESH_TOKEN'),
    client_id: env('AMAZON_CLIENT_ID'),
    client_secret: env('AMAZON_CLIENT_SECRET')
  });
  token = r.data.access_token;
  tokenExpiry = Date.now() + r.data.expires_in * 1000 - 60000;
  return token;
}

// SP-API call with the token in x-amz-access-token. Retries throttling (429) and transient 5xx.
async function call(method, path, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios({
        method,
        url: ENDPOINT + path,
        data,
        headers: { 'x-amz-access-token': await accessToken() }
      });
      return r.data;
    } catch (err) {
      const status = err.response?.status;
      if ((status === 429 || status >= 500) && attempt < 8) {
        await sleep(Math.min(5000 * 2 ** attempt, 60000));
        continue;
      }
      const detail = err.response?.data?.errors?.[0]?.message || err.message;
      throw new Error(`${status || ''} ${detail} (${method.toUpperCase()} ${path.split('?')[0]})`.trim());
    }
  }
}

// Create a report, wait for it, and return the document as text.
// Returns null when Amazon cancels it (no data for the period).
async function report(reportType, marketplaceIds, options = {}) {
  const body = { reportType, marketplaceIds };
  if (options.start) body.dataStartTime = options.start;
  if (options.end) body.dataEndTime = options.end;
  if (options.reportOptions) body.reportOptions = options.reportOptions;

  const { reportId } = await call('post', '/reports/2021-06-30/reports', body);
  const startedAt = Date.now();
  for (;;) {
    await sleep(10000);
    const r = await call('get', `/reports/2021-06-30/reports/${reportId}`);
    if (r.processingStatus === 'DONE') return downloadDocument(r.reportDocumentId);
    if (r.processingStatus === 'CANCELLED') return null;
    if (r.processingStatus === 'FATAL') throw new Error(`${reportType} report failed`);
    if (Date.now() - startedAt > 30 * 60 * 1000) throw new Error(`${reportType} report timed out`);
  }
}

async function downloadDocument(reportDocumentId) {
  const doc = await call('get', `/reports/2021-06-30/documents/${reportDocumentId}`);
  const file = await axios.get(doc.url, { responseType: 'arraybuffer' });
  const raw = doc.compressionAlgorithm === 'GZIP' ? zlib.gunzipSync(file.data) : Buffer.from(file.data);
  return raw.toString('utf8');
}

// Tab-separated report text -> array of row objects keyed by header
function parseTsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length);
  const head = lines.shift().split('\t');
  return lines.map(line => {
    const cells = line.split('\t');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

module.exports = { MARKETPLACES, CHANNELS, call, report, parseTsv, sleep };
