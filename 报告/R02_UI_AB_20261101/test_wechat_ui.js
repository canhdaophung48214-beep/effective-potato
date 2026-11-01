'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const evidence = path.join(__dirname, 'evidence');
fs.mkdirSync(evidence, { recursive: true });

const ws = new WebSocket('ws://127.0.0.1:9435');
let id = 0;
const waiting = new Map();
const results = { screens: [] };

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`TIMEOUT ${method}`)), 15000);
    waiting.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const pending = waiting.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  waiting.delete(message.id);
  if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
  else pending.resolve(message.result);
};

async function evaluate(source) {
  return (await call('App.callFunction', { functionDeclaration: source, args: [] })).result;
}

async function capture(name) {
  const shot = await call('App.captureScreenshot');
  fs.writeFileSync(path.join(evidence, name), Buffer.from(shot.data, 'base64'));
}

async function visit(url, screenshot) {
  await call('App.callWxMethod', { method: 'reLaunch', args: [{ url }] });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const state = await evaluate(`function(){const p=getCurrentPages().at(-1);return {route:p.route,data:p.data}}`);
  results.screens.push({ url, route: state.route, keys: Object.keys(state.data) });
  await capture(screenshot);
  return state;
}

ws.onopen = async () => {
  try {
    const system = (await call('App.callWxMethod', { method: 'getSystemInfoSync', args: [] })).result;
    results.viewport = { width: system.windowWidth, height: system.windowHeight, SDKVersion: system.SDKVersion };

    const home = await visit('/pages/home/index', 'wechat_home.png');
    assert(home.data.featured);
    assert.equal(home.data.items.length, 6);

    const menu = await visit('/pages/menu/index', 'wechat_menu.png');
    assert.equal(menu.data.items.length, 39);
    await call('App.callWxMethod', { method: 'pageScrollTo', args: [{ scrollTop: 100000, duration: 0 }] });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await capture('wechat_menu_bottom.png');

    const empty = await evaluate(`function(){const p=getCurrentPages().at(-1);p.setData({query:'不存在的菜名'});p.refresh();return new Promise(r=>setTimeout(()=>r({count:p.data.items.length}),100))}`);
    assert.equal(empty.count, 0);
    await capture('wechat_menu_empty.png');

    const detail = await visit('/pages/detail/index?id=c01_d540', 'wechat_detail.png');
    assert.equal(detail.data.item.id, 'c01_d540');
    assert.equal(detail.data.item.currentPriceText, '当前价格未知');
    assert.equal(detail.data.item.transactionQuote, false);

    results.status = 'PASS_ACTUAL_WECHAT_THREE_SCREENS';
    results.assertions = ['home recommendation', '39 item list', 'list bottom scroll', 'empty state', 'detail id and UNKNOWN current price'];
    console.log(`PASS WeChat three screens at ${results.viewport.width}px`);
  } catch (error) {
    results.status = 'FAIL';
    results.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(evidence, 'wechat_results.json'), JSON.stringify(results, null, 2));
    ws.close();
  }
};

ws.onerror = () => {
  console.error('WS_ERROR');
  process.exitCode = 1;
};
