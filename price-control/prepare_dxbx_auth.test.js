'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {parseState, hasUsableSession, verifySupplies, authenticate, writeState} = require('./prepare_dxbx_auth');
const ORIGIN = 'https://dxbx.ru';
const state = (expires = Date.now() / 1000 + 3600) => ({cookies: [{name: 'dxbx_session', domain: 'dxbx.ru', value: 'fixture-not-a-secret', path: '/', expires}], origins: []});
function browserMock(statuses = [200], options = {}) {
  const metrics = {launches: 0, clicks: 0, fills: 0, closed: false, requests: 0};
  const chromium = {async launch() {
    metrics.launches++;
    return {
      async newContext() {
        let pageUrl = ORIGIN + '/fe/login';
        const page = {
          url: () => pageUrl,
          async goto(url) { pageUrl = options.external ? 'https://example.invalid/login' : url; },
          async waitForLoadState() {},
          async waitForURL() {
            if (options.rejected) { const e = new Error('fixture'); e.name = 'TimeoutError'; throw e; }
            pageUrl = ORIGIN + '/fe/supplies';
          },
          on() {},
          locator() { return {async waitFor() {}, async fill() {metrics.fills++;}, async count() {return 0;}}; },
          getByRole() { return {async count() {return 1;}, async click() {metrics.clicks++;}}; }
        };
        return {
          request: {async get(url, config) {
            assert.ok(url.startsWith(ORIGIN + '/api/front/supplies'));
            assert.equal(config.maxRedirects, 0);
            metrics.requests++;
            const status = statuses.shift();
            return {status: () => status, async json() {return {data: []};}, async dispose() {}};
          }},
          async newPage() {return page;},
          async storageState() {return state();},
          async close() {},
          async route() {}
        };
      },
      async close() {metrics.closed = true;}
    };
  }};
  return {metrics, chromium};
}

test('stored state keeps only the DocsInBox origin', () => {
  const s = state();
  s.cookies.push({domain:'example.invalid', name:'other', value:'fixture'});
  s.origins = [{origin:ORIGIN, localStorage:[]}, {origin:'https://example.invalid', localStorage:[]}];
  const p = parseState(JSON.stringify(s));
  assert.equal(p.cookies.length,1); assert.equal(p.origins.length,1);
});
test('invalid JSON is rejected without echoing its content', () => {
  assert.throws(() => parseState('invalid-sensitive-fixture'), {message:'DXBX_STATE_INVALID_JSON'});
});
test('expired login cookie is not treated as an active session', () => {
  assert.equal(hasUsableSession(state(100), 200), false);
  assert.equal(hasUsableSession(state(300), 200), true);
});
test('missing credentials stop before launching a browser or making requests', async () => {
  const m = browserMock();
  await assert.rejects(authenticate({DXBX_STORAGE_STATE:JSON.stringify(state(100))}, m.chromium), {message:'DXBX_LOGIN_SECRETS_REQUIRED'});
  assert.equal(m.metrics.launches,0); assert.equal(m.metrics.requests,0);
});
test('working existing session is reused without submitting credentials', async () => {
  const m = browserMock([200]);
  const result = await authenticate({DXBX_STORAGE_STATE:JSON.stringify(state())}, m.chromium);
  assert.equal(result.method,'existing_session'); assert.equal(m.metrics.clicks,0); assert.equal(m.metrics.closed,true);
});
test('expired session plus configured credentials performs exactly one login', async () => {
  const m = browserMock([200]);
  const result = await authenticate({DXBX_STORAGE_STATE:JSON.stringify(state(100)),DXBX_LOGIN:'fixture-user',DXBX_PASSWORD:'fixture-password'},m.chromium);
  assert.equal(result.method,'login'); assert.equal(m.metrics.clicks,1); assert.equal(m.metrics.fills,2);
});
test('server-rejected session is followed by a single real login', async () => {
  const m = browserMock([401,200]);
  const result = await authenticate({DXBX_STORAGE_STATE:JSON.stringify(state()),DXBX_LOGIN:'fixture-user',DXBX_PASSWORD:'fixture-password'},m.chromium);
  assert.equal(result.method,'login'); assert.equal(m.metrics.clicks,1); assert.equal(m.metrics.requests,2);
});
test('403 and 429 do not cause a retry or a new login', async () => {
  for (const status of [403,429]) {
    const m=browserMock([status]);
    await assert.rejects(authenticate({DXBX_STORAGE_STATE:JSON.stringify(state()),DXBX_LOGIN:'fixture-user',DXBX_PASSWORD:'fixture-password'},m.chromium), {message:'DXBX_SUPPLIES_HTTP_'+status});
    assert.equal(m.metrics.requests,1); assert.equal(m.metrics.clicks,0);
  }
});
test('rejected login is not retried', async () => {
  const m=browserMock([401],{rejected:true});
  await assert.rejects(authenticate({DXBX_LOGIN:'fixture-user',DXBX_PASSWORD:'fixture-password'},m.chromium), {message:'DXBX_LOGIN_REJECTED'});
  assert.equal(m.metrics.clicks,1); assert.equal(m.metrics.closed,true);
});
test('unexpected external login origin receives no credentials', async () => {
  const m=browserMock([],{external:true});
  await assert.rejects(authenticate({DXBX_LOGIN:'fixture-user',DXBX_PASSWORD:'fixture-password'},m.chromium), {message:'DXBX_UNEXPECTED_ORIGIN'});
  assert.equal(m.metrics.fills,0);
});
test('200 with an unexpected payload is not treated as authentication', async () => {
  await assert.rejects(verifySupplies({request:{async get(){return {status:()=>200,async json(){return {error:'fixture'};},async dispose(){}};}}}), {message:'DXBX_SUPPLIES_INVALID_SHAPE'});
});
test('saved state is written with owner-only permissions', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dxbx-test-'));
  try {
    const file=path.join(dir,'state.json'); writeState(file,state());
    assert.equal(fs.statSync(file).mode & 0o777,0o600);
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).cookies[0].name,'dxbx_session');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
