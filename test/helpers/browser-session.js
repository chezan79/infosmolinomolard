const { spawn } = require('node:child_process');
const WebSocket = require('ws');

async function waitFor(check, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* Navigation detaches old documents. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for isolated browser fixture');
}

async function browserSession(t) {
  const child = spawn(process.env.CHROME_BIN || 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=/tmp/molino-results-browser-${process.pid}-${Date.now()}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const debuggerUrl = await waitFor(() => stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]);
  const port = new URL(debuggerUrl).port;
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
    .then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.once('open', resolve));
  t.after(() => socket.close());
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('Browser fixture evaluation failed');
    return result.result.value;
  };
  await call('Page.enable');
  await call('Runtime.enable');
  return { call, evaluate, errors };
}

module.exports = { browserSession, waitFor };