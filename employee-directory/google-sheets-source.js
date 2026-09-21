const { JWT } = require('google-auth-library');

const SHEETS_READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_RESPONSE_BYTES = 1024 * 1024;

class GoogleSheetsDirectorySource {
  constructor({ serviceAccount, spreadsheetId, range, timeoutMs = 10000 }) {
    this.spreadsheetId = spreadsheetId;
    this.range = range;
    this.timeoutMs = timeoutMs;
    this.auth = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [SHEETS_READ_SCOPE],
    });
  }

  async load() {
    const access = await this.auth.getAccessToken();
    if (!access.token) throw new Error('Google Sheets access token unavailable');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const encodedRange = encodeURIComponent(this.range);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Google Sheets returned status ${response.status}`);
      const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_RESPONSE_BYTES) throw new Error('Google Sheets response is too large');
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('Google Sheets response is too large');
      }
      const payload = JSON.parse(body);
      if (!Array.isArray(payload.values)) throw new Error('Google Sheets response did not contain rows');
      return payload.values;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { GoogleSheetsDirectorySource, MAX_RESPONSE_BYTES, SHEETS_READ_SCOPE };