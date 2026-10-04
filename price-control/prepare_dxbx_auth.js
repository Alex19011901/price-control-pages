'use strict';

// Prepare an authenticated DocsInBox state inside the runner only.
// No invoice writes, screenshots, traces, credential logs, or state uploads.
const fs = require('node:fs');
const path = require('node:path');
const ORIGIN = 'https://dxbx.ru';

class AuthError extends Error {
  constructor(code) { super(code); this.name = 'AuthError'; }
}
const fail = code => { throw new AuthError(code); };

function parseState(raw) {
  if (!raw) return null;
  let state;
  try { state = JSON.parse(raw); } catch { fail('DXBX_STATE_INVALID_JSON'); }
  if (!state || !Array.isArray(state.cookies) ||
      (state.origins !== undefined && !Array.isArray(state.origins))) {
    fail('DXBX_STATE_INVALID_SHAPE');
  }
  return {
    cookies: state.cookies.filter(c => String(c.domain || '').replace(/^\./, '') === 'dxbx.ru'),
    origins: (state.origins || []).filter(o => o.origin === ORIGIN)
  };
}

function hasUsableSession(state, now = Date.now() / 1000) {
  return !!state?.cookies.some(c => c.name === 'dxbx_session' &&
    typeof c.value === 'string' && c.value.length > 0 &&
    Number.isFinite(c.expires) && (c.expires <= 0 || c.expires > now));
}

function assertOrigin(page) {
  let url;
  try { url = new URL(page.url()); } catch { fail('DXBX_UNEXPECTED_ORIGIN'); }
  if (url.origin !== ORIGIN) fail('DXBX_UNEXPECTED_ORIGIN');
  return url.pathname;
}

async function verifySupplies(context) {
  const response = await context.request.get(ORIGIN + '/api/front/supplies?offset=0', {
    timeout: 30000, maxRedirects: 0,
    headers: {Accept: 'application/json', Origin: ORIGIN, Referer: ORIGIN + '/fe/supplies?offset=0'}
  });
  try {
    const status = response.status();
    if (status === 401) return false;
    if (status !== 200) fail('DXBX_SUPPLIES_HTTP_' + status);
    let body;
    try { body = await response.json(); } catch { fail('DXBX_SUPPLIES_NON_JSON'); }
    if (!body || !Array.isArray(body.data)) fail('DXBX_SUPPLIES_INVALID_SHAPE');
    return true;
  } finally { await response.dispose(); }
}

async function pageReady(page) {
  // Allows the application to finish normal redirects/cookie renewal.
  try { await page.waitForLoadState('networkidle', {timeout: 8000}); }
  catch (error) { if (error.name !== 'TimeoutError') throw error; }
  assertOrigin(page);
}

async function authenticate(env, chromium) {
  const state = parseState(env.DXBX_STORAGE_STATE);
  const login = String(env.DXBX_LOGIN || '').trim();
  const password = String(env.DXBX_PASSWORD || '');
  const credentialsPresent = !!login && !!password;
  const usable = hasUsableSession(state);
  if (!usable && !credentialsPresent) fail('DXBX_LOGIN_SECRETS_REQUIRED');

  const browser = await chromium.launch({headless: true});
  let context;
  try {
    if (usable) {
      context = await browser.newContext({storageState: state});
      const page = await context.newPage();
      await page.goto(ORIGIN + '/', {waitUntil: 'domcontentloaded', timeout: 45000});
      await pageReady(page);
      if (await verifySupplies(context)) {
        return {state: await context.storageState(), method: 'existing_session'};
      }
      if (!credentialsPresent) fail('DXBX_LOGIN_SECRETS_REQUIRED');
      await context.close();
    }

    // One genuine login attempt. Never retry rejected credentials, 403 or 429.
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(ORIGIN + '/fe/login', {waitUntil: 'domcontentloaded', timeout: 45000});
    await pageReady(page);
    if (assertOrigin(page) !== '/fe/login') fail('DXBX_LOGIN_PAGE_CHANGED');
    const loginField = page.locator('#loginForm_login');
    const passwordField = page.locator('#loginForm_password');
    await loginField.waitFor({state: 'visible', timeout: 15000});
    await passwordField.waitFor({state: 'visible', timeout: 15000});
    const submit = page.getByRole('button', {name: /^(Log in|Войти)$/i});
    if (await submit.count() !== 1) fail('DXBX_LOGIN_FORM_CHANGED');

    // Credential submissions are permitted only to the verified DocsInBox origin.
    // Non-authentication requests continue normally; no credentials are printed.
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ORIGIN) {
        const payload = request.url() + '\n' + (request.postData() || '');
        const values = [login, password, encodeURIComponent(login), encodeURIComponent(password)];
        if (values.some(value => value && payload.includes(value))) {
          await route.abort('blockedbyclient');
          return;
        }
      }
      await route.continue();
    });

    let denied = 0;
    page.on('response', response => {
      const request = response.request();
      if (request.method() === 'POST' && new URL(response.url()).origin === ORIGIN &&
          [403, 429].includes(response.status())) denied = response.status();
    });
    assertOrigin(page);
    await loginField.fill(login);
    assertOrigin(page);
    await passwordField.fill(password);
    assertOrigin(page);
    await submit.click({timeout: 15000});
    try {
      await page.waitForURL(url => url.origin === ORIGIN && url.pathname !== '/fe/login', {timeout: 20000});
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
    }
    assertOrigin(page);
    if (denied) fail('DXBX_LOGIN_HTTP_' + denied);
    const challenge = page.locator('input[autocomplete="one-time-code"], input[name="otp"], input[name="captcha"]');
    if (await challenge.count()) fail('DXBX_INTERACTIVE_LOGIN_REQUIRED');
    if (!await verifySupplies(context)) fail('DXBX_LOGIN_REJECTED');
    return {state: await context.storageState(), method: 'login'};
  } finally { await browser.close(); }
}

function writeState(file, state) {
  if (!file) fail('DXBX_OUTPUT_PATH_REQUIRED');
  const target = path.resolve(file);
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(state), {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function main() {
  const output = process.argv[2];
  if (!output) fail('DXBX_OUTPUT_PATH_REQUIRED');
  const result = await authenticate(process.env, require('playwright').chromium);
  writeState(output, result.state);
  console.log('DXBX_AUTH_OK method=' + result.method);
}

if (require.main === module) {
  main().catch(error => {
    // Raw Playwright errors can contain form values. Never print them.
    console.error(error instanceof AuthError ? error.message : 'DXBX_AUTH_FAILED');
    process.exitCode = 1;
  });
}
module.exports = {AuthError, parseState, hasUsableSession, verifySupplies, authenticate, writeState};
