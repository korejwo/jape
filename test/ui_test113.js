// Headless Chrome (CDP) checks of the JAPE web UI with a JA2 1.13 v5 save.
// usage: node ui_test113.js <web-dir> <QuickSave.sav> <out-dir>
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [webDir, saveFile, outDir] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const pageUrl = 'file:///' + path.resolve(webDir, 'index.html').replace(/\\/g, '/');
let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(outDir, 'chrome-profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=900,700', pageUrl], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch (e) { /* starting */ }
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => fs.writeFileSync(path.join(outDir, name + '.png'),
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const click = async (sel) => {
    const [x, y] = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(30);
  };
  const type = async (sel, text) => {
    await click(sel);
    await ev(`document.querySelector(${JSON.stringify(sel)}).select()`);
    await send('Input.insertText', { text });
    await sleep(30);
  };
  const choose = (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = String(${value}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 566, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload');
  await sleep(1200);

  const b64 = fs.readFileSync(saveFile).toString('base64');
  const t0 = Date.now();
  check('1.13 v5 save loads', (await ev(`JAPE.app.openBytes(Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0)), 'QuickSave.sav')`)) === true);
  console.log('     load time ' + (Date.now() - t0) + ' ms (incl. transfer)');
  check('no error dialog', (await ev(`$('.dialog').length`)) === 0, await ev(`$('.dialog-text').text()`));
  const labels = await ev(`$('#actor-list .opt').map((i, e) => $(e).text()).get()`);
  check('255 profiles listed', labels.length === 255, labels.length);
  const starred = labels.filter((l) => l.startsWith('*')).sort();
  check('team starred', JSON.stringify(starred) === JSON.stringify(['*Barry', '*Bob', '*Korek', '*Mouse', '*Steroid']), starred);
  check('status shows format', /JA2 1\.13 v5 save, version 185/.test(await ev(`$('#status-file').text()`)), await ev(`$('#status-file').text()`));

  const idx = (l) => labels.indexOf(l);
  await click(`#actor-${idx('*Korek')}`);
  await shot('01-korek');
  check('Korek editable', await ev(`$('#stat-panel input').toArray().every(e => !e.disabled)`));
  check('no +1/+10 buttons for 1.13 saves', (await ev(`$('.btn.bump:visible').length`)) === 0);
  check('name / nickname', (await ev(`$('#stat-panel input[aria-label="Name"]').val()`)) === 'Jan Nowak' &&
    (await ev(`$('#stat-panel input[aria-label="Nickname"]').val()`)) === 'Korek');
  check('Skill3 row visible', await ev(`$('#stat-panel select[aria-label="Skill3"]').closest('tr').is(':visible')`));
  const traitNames = await ev(`$('#stat-panel select[aria-label="Skill1"] option').map((i, o) => $(o).text()).get()`);
  check('new trait system names', traitNames.length === 24 && traitNames.includes('Squadleader') && traitNames.includes('Survival'), traitNames.length);
  check('Korek traits', (await ev(`$('#stat-panel select[aria-label="Skill1"] option:selected').text()`)) === 'Auto Weapons' &&
    (await ev(`$('#stat-panel select[aria-label="Skill3"] option:selected').text()`)) === 'Night Ops');
  check('1.13 inventory panel shown instead of the 19 slots', await ev(`$('.inv113').is(':visible') && $('.classic-items').is(':hidden')`));
  check('Prepare all is hidden and disabled for 1.13 saves', await ev(`$('.btn.team[data-team=prepare]').is(':hidden') &&
    $('.btn.team[data-team=prepare]').prop('disabled')`));
  const rows = await ev(`$('.inv-list .opt').map((i, e) => $(e).find('.slot').text() + ': ' + $(e).find('.name').text()).get()`);
  check('Korek inventory listed', rows.length === 16 && rows[0] === 'Helmet: Steel Helmet' && rows.includes('Hand: Beretta 92F'), rows);
  const slotRow = (n) => `.inv-list .opt:nth-child(${rows.findIndex((r) => r.startsWith(n + ':')) + 1})`;
  await click(slotRow('Hand'));
  check('hand: gun list enabled', await ev(`!$('.detail113 select').prop('disabled') && $('.detail113 select option').length > 300`));
  check('hand: ammo shown', /9x19mm Mag 15, 15 rounds/.test(await ev(`$('.detail113 .value').eq(2).text()`)), await ev(`$('.detail113 .value').eq(2).text()`));
  await choose('.detail113 select', 65); // A. R. Rifle, two-handed
  await sleep(150);
  check('two-handed refused while second hand busy', /Empty the second hand first/.test(await ev(`$('.dialog-text').text()`)) &&
    (await ev(`$('.detail113 select').val()`)) === '3');
  await click('.dialog-buttons .btn');
  await choose('.detail113 select', 601); // AEK-919K
  check('swap note lists factory attachment and ammo', /Folding Stock/.test(await ev(`$('.inv-note').text()`)) &&
    /9x18mm Mag 30, 30 rounds/.test(await ev(`$('.inv-note').text()`)), await ev(`$('.inv-note').text()`));
  check('list row updated', (await ev(`$(${JSON.stringify(slotRow('Hand'))}).find('.name').text()`)) === 'AEK-919K');
  await click(slotRow('Second hand'));
  check('second hand (light) not replaceable', await ev(`$('.detail113 select').prop('disabled')`) &&
    /Only guns, melee weapons and armour/.test(await ev(`$('.inv-note').text()`)));
  await click(slotRow('Helmet'));
  await choose('.detail113 select', await ev(`$('.detail113 select option').filter((i, o) => $(o).text() === 'Army Cap').val()`));
  check('helmet swap removes NVG', /Removed: NVG I/.test(await ev(`$('.inv-note').text()`)), await ev(`$('.inv-note').text()`));
  await shot('03-inventory');
  check('Energy / Morale shown', (await ev(`$('#stat-panel input[aria-label="Energy"]').val()`)) === '100' &&
    (await ev(`$('#stat-panel input[aria-label="Morale"]').val()`)) === '50');

  await type('#stat-panel input[aria-label="Strength"]', '200');
  check('INT8 stat clamped to 127', (await ev(`$('#stat-panel input[aria-label="Strength"]').val()`)) === '127');
  await type('#stat-panel input[aria-label="Strength"]', '88');
  await type('#stat-panel input[aria-label="Kills"]', '42');
  await type('#stat-panel input[aria-label="Marksmanship"]', '95');
  await choose('#stat-panel select[aria-label="Skill2"]', 7); // Squadleader
  check('modified', (await ev('document.title')).endsWith(' *'));

  await click(`#actor-${idx('Fox')}`);
  check('Fox: no soldier record note', /No soldier record/.test(await ev(`$('.inv-note').text()`)));
  check('Fox read-only, no Energy', await ev(`$('#stat-panel input').toArray().every(e => e.disabled)`) &&
    (await ev(`$('#stat-panel input[aria-label="Energy"]').val()`)) === '');
  console.log('     step: screenshot');
  await shot('02-fox');
  console.log('     step: save');
  // Save through a stubbed file handle, then reload the written bytes in the page.
  const res = await ev(`(async () => {
    const app = JAPE.app; let written = null;
    app.handle = { name: 'QuickSave.sav', queryPermission: async () => 'granted',
      createWritable: async () => ({ write: async (b) => { written = b; }, close: async () => {} }) };
    const ok = await app.doSave();
    if (!ok || !written) return { ok: false };
    const g = JAPE.SaveGame.load(written, 'x');
    const m = g.actorMercs[51], p = g.actors[51];
    return { ok: true, size: written.length, modified: app.modified,
      v: [m.getInt('Strength'), p.getInt('Strength'), m.getInt('Marksmanship'), p.getInt('Kills'), m.get('Skill2'), p.get('Skill2')],
      items: (() => { const inv = new JAPE.Items113.Inventory(m, g, JAPE.Items113.db()); return [inv.slot(0).name, inv.slot(5).name, inv.slot(5).attachments.join(), inv.slot(5).ammo.name]; })() };
  })()`);
  check('save written and reloaded with valid checksums', res.ok, res);
  if (res.ok) {
    check('edits kept in soldier and profile', JSON.stringify(res.v) === JSON.stringify([88, 88, 95, 42, 'Squadleader', 'Squadleader']), res.v);
    check('items kept after reload', JSON.stringify(res.items) === JSON.stringify(['Army Cap', 'AEK-919K', 'Folding Stock', '9x18mm Mag 30']), res.items);
    check('file size changed only by the rebuilt objects', Math.abs(res.size - fs.statSync(saveFile).size) < 2000, res.size);
    check('modified flag cleared', res.modified === false);
  }
  check('no console errors', errors.length === 0, errors);
  ws.close();
  chrome.kill();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll 1.13 UI checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
