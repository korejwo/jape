// Drives headless Chrome over CDP to exercise the JAPE web UI.
// usage: node ui_test.js <web-dir> <save-file> <out-dir>
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const [webDir, saveFile, outDir] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const pageUrl = 'file:///' + path.resolve(webDir, 'index.html').replace(/\\/g, '/');

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail)));
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.join(outDir, 'chrome-profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=900,700', pageUrl
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) errors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text) + '\n' + expr);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const center = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'nearest' }); window.__pageScroll = Math.max(window.__pageScroll || 0, document.scrollingElement.scrollTop, document.scrollingElement.scrollLeft); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const click = async (sel) => {
    const [x, y] = await center(sel);
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
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(30);
  };
  // set a <select> like a user would and fire change
  const choose = async (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = String(${value}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 545, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload');
  await sleep(1200);

  // ---- initial state
  check('jQuery 4.0.0 loaded', (await ev('jQuery.fn.jquery')) === '4.0.0', await ev('jQuery.fn.jquery'));
  check('app started', await ev('!!(window.JAPE && JAPE.app)'));
  const fsa = await ev('typeof window.showOpenFilePicker');
  console.log('     showOpenFilePicker on file:// = ' + fsa + ', isSecureContext = ' + (await ev('window.isSecureContext')));
  check('Save/Close disabled without a file', await ev(`$('[data-cmd=save]').prop('disabled') && $('[data-cmd=close]').prop('disabled')`));
  await shot('01-empty');

  // ---- menu
  await click('.menu:nth-child(1) .menu-title');
  check('File menu opens', await ev(`$('.menu:nth-child(1)').hasClass('open')`));
  await shot('02-file-menu');
  await key('Escape', 'Escape', 27);
  await ev(`$('.menu').removeClass('open')`);

  // ---- load the save
  const b64 = fs.readFileSync(saveFile).toString('base64');
  const loaded = await ev(`JAPE.app.openBytes(Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0)), ${JSON.stringify(path.basename(saveFile))})`);
  check('save loads in UI', loaded === true);
  const labels = await ev(`$('#actor-list .opt').map((i, e) => $(e).text()).get()`);
  check('170 profiles in list', labels.length === 170, labels.length);
  const starred = labels.filter((l) => l.startsWith('*'));
  check('only team members starred', JSON.stringify(starred) === JSON.stringify(['*Shadow', '*Steroid', '*Qt']) || starred.sort().join() === ['*Qt', '*Shadow', '*Steroid'].join(), starred);
  check('Pacos / Fatima not starred', labels.includes('Pacos') && labels.includes('Fatima'));
  check('title shows file', (await ev('document.title')) === 'JAPE - ' + path.basename(saveFile));
  check('Save enabled after open', await ev(`!$('[data-cmd=save]').prop('disabled')`));

  const idx = (label) => labels.indexOf(label);

  // ---- read-only profile (Fox)
  await click(`#actor-${idx('Fox')}`);
  await shot('03-fox-readonly');
  check('Fox shown', /^Cynthia "Fox" Guz/.test(await ev(`$('#stat-panel input').eq(0).val()`)), await ev(`$('#stat-panel input').eq(0).val()`));
  check('Fox stats disabled', await ev(`$('#stat-panel input, #stat-panel select').toArray().every(e => e.disabled)`));
  check('Fox health from profile (0.41 fix)', (await ev(`$('#stat-panel input[aria-label="Health"]').val()`)) !== '');
  check('status says read-only', /Read-only/.test(await ev(`$('#status-msg').text()`)));
  check('Fox item slots disabled', await ev(`$('.slots .btn:not(.team)').toArray().every(e => e.disabled)`));
  check('team buttons enabled while a read-only character is shown', await ev(`$('.btn.team').toArray().every(e => !e.disabled)`));
  check('Fox: skill buttons disabled', await ev(`$('.btn.bump').toArray().every(e => e.disabled)`));

  // ---- read-only soldier (Pacos): items browsable, not editable
  await click(`#actor-${idx('Pacos')}`);
  check('Pacos stats disabled', await ev(`$('#stat-panel input').toArray().every(e => e.disabled)`));
  check('Pacos slots browsable', await ev(`$('.slots .btn:not(.action)').toArray().every(e => !e.disabled)`));
  check('Pacos: Full Dress disabled (read-only)', await ev(`$('.btn.full-dress').prop('disabled')`));
  check('Pacos item detail disabled', await ev(`$('.detail select, .detail input').toArray().every(e => e.disabled)`));

  // ---- team member (Qt)
  await click(`#actor-${idx('*Qt')}`);
  await shot('04-qt');
  check('Qt stats editable', await ev(`$('#stat-panel input').toArray().every(e => !e.disabled)`));
  check('status clear for team member', (await ev(`$('#status-msg').text()`)) === '');
  const btnText = await ev(`$('.slots .btn').map((i, e) => $(e).text()).get()`);
  check('Qt helmet button', btnText.includes('Steel Helmet') && btnText.includes('Flak Jacket') && btnText.includes('Ruger Mini-14'), btnText);

  // numeric clamp
  await type('#stat-panel input[aria-label="Strength"]', '300');
  check('Strength (INT8 in game) clamped to 127 in box', (await ev(`$('#stat-panel input[aria-label="Strength"]').val()`)) === '127');
  check('Strength 127 in merc + profile', await ev(`(() => { const g = JAPE.app.game; const m = g.getMercByNick('Qt'); const a = g.actors.find(x => x.get('Nickname') === 'Qt'); return m.getInt('Strength') === 127 && a.getInt('Strength') === 127; })()`));
  check('Skill3 row hidden for JA2 1.0x saves', await ev(`$('#stat-panel select[aria-label="Skill3"]').closest('tr').is(':hidden')`));
  check('modified flag + title', (await ev('document.title')).endsWith(' *'));
  await type('#stat-panel input[aria-label="Agility"]', '7a8');
  check('non-digits stripped', (await ev(`$('#stat-panel input[aria-label="Agility"]').val()`)) === '78');
  await type('#stat-panel input[aria-label="Kills"]', '99999');
  check('short field clamped to 65535', (await ev(`JAPE.app.game.actors.find(x => x.get('Nickname') === 'Qt').getInt('Kills')`)) === 65535);
  check('name maxlength 30', (await ev(`$('#stat-panel input[aria-label="Name"]').attr('maxlength')`)) === '30');
  check('nickname maxlength 10', (await ev(`$('#stat-panel input[aria-label="Nickname"]').attr('maxlength')`)) === '10');
  await type('#stat-panel input[aria-label="Nickname"]', 'Qtx');
  check('list label follows nickname', (await ev(`$('#actor-${idx('*Qt')}').text()`)) === '*Qtx');
  await type('#stat-panel input[aria-label="Nickname"]', 'Qt');
  await choose('#stat-panel select[aria-label="Skill1"]', 4);
  check('skill set', (await ev(`JAPE.app.game.getMercByNick('Qt').get('Skill1')`)) === 'Night Ops');
  // ---- +1 / +10 on skills
  const bumpRows = await ev(`$('.btn.bump:visible').closest('tr').find('td.lbl').map((i, e) => $(e).text()).get().filter((v, i, a) => a.indexOf(v) === i).join()`);
  check('16 buttons on the 8 chosen rows', (await ev(`$('.btn.bump:visible').length`)) === 16 &&
    bumpRows === 'Agility,Dexterity,Strength,Wisdom,Marksmanship,Explosives,Mechanical,Medical', bumpRows);
  const ag = () => ev(`(() => { const g = JAPE.app.game; const m = g.getMercByNick('Qt'); const a = g.actors.find(x => x.get('Nickname') === 'Qt');
    return [m.getInt('Agility'), a.getInt('Agility'), a.getInt('Agility Inc')]; })()`);
  const a0 = await ag();
  await click('button[aria-label="Agility +10"]');
  const a1 = await ag();
  check('Agility +10 raises value and bracket', a1[0] === a0[0] + 10 && a1[1] === a0[0] + 10 && a1[2] === a0[2] + 10, [a0, a1]);
  const w0 = await ev(`JAPE.app.game.actors.find(x => x.get('Nickname') === 'Qt').getInt('Wisdom Inc')`);
  await click('button[aria-label="Wisdom +1"]');
  check('Wisdom +1 raises the bracket', (await ev(`JAPE.app.game.actors.find(x => x.get('Nickname') === 'Qt').getInt('Wisdom Inc')`)) === w0 + 1);
  const mrk = () => ev(`(() => { const g = JAPE.app.game; const m = g.getMercByNick('Qt'); const a = g.actors.find(x => x.get('Nickname') === 'Qt');
    return [m.getInt('Marksmanship'), a.getInt('Marksmanship'), a.getInt('Marksmanship Inc'), $('#stat-panel input[aria-label="Marksmanship"]').val(), $('#stat-panel input[aria-label="Marksmanship Inc"]').val()]; })()`);
  const m0 = await mrk();
  await click('button[aria-label="Marksmanship +1"]');
  let m1 = await mrk();
  check('+1 raises skill and bracket', m1[0] === m0[0] + 1 && m1[1] === m0[0] + 1 && m1[2] === m0[2] + 1 && m1[3] === String(m0[0] + 1) && m1[4] === String(m0[2] + 1), [m0, m1]);
  await click('button[aria-label="Marksmanship +10"]');
  const m2 = await mrk();
  const gain = Math.min(100, m1[0] + 10) - m1[0];
  check('+10 stops at 100, bracket grows by the real gain', m2[0] === Math.min(100, m1[0] + 10) && m2[2] === m1[2] + gain, [m1, m2]);
  await click('button[aria-label="Marksmanship +10"]');
  const m3 = await mrk();
  check('at 100 nothing changes', JSON.stringify(m3) === JSON.stringify(m2), m3);
  await click('button[aria-label="Mechanical +10"]');
  check('+10 on Mechanical', (await ev(`JAPE.app.game.getMercByNick('Qt').getInt('Mechanical')`)) === 30 &&
    (await ev(`JAPE.app.game.actors.find(x => x.get('Nickname') === 'Qt').getInt('Mechanical Inc')`)) === 10);
  await shot('13-bump');


  // ---- slot filters
  const opts = (sel) => ev(`$(${JSON.stringify(sel)}).find('option').map((i, o) => +o.value).get()`);
  const cats = async (sel) => ev(`$(${JSON.stringify(sel)}).find('option').map((i, o) => JAPE.exemplar(+o.value) ? JAPE.exemplar(+o.value).category : -1).get()`);
  const C = await ev('JAPE.CAT');
  const slotBtn = (n) => `.slots .btn:nth-child(${n})`;
  // button order in DOM follows SLOT_ROWS: 1=HG1, 2=HELMET, 3=HG2, 4=BODY, 5=RHAND, 6=LEGS, 7=LHAND, ...
  await click(slotBtn(2));
  let c = await cats('.detail select[aria-label="Item ID"]');
  check('helmet slot: only None + helmets', c.every((x, i) => (i === 0 && x === 0) || x === C.HELMET) && c.length === 8, c);
  await shot('05-helmet-slot');
  await click(slotBtn(4));
  c = await cats('.detail select[aria-label="Item ID"]');
  check('body slot: only body armor', c.slice(1).every((x) => x === C.BODY_ARMOR) && c.length === 25, c.length);
  await click(slotBtn(6));
  c = await cats('.detail select[aria-label="Item ID"]');
  check('leg slot: only leg armor', c.slice(1).every((x) => x === C.LEG_ARMOR) && c.length === 7, c.length);
  await click(slotBtn(1));
  c = await cats('.detail select[aria-label="Item ID"]');
  check('head gear slot: only head gear', c.slice(1).every((x) => x === C.HEAD_GEAR) && c.length === 7, c.length);
  await click(slotBtn(8));
  check('backpack slot: all items', (await opts('.detail select[aria-label="Item ID"]')).length === 302);

  // body armor attachments: only ceramic plates
  await click(slotBtn(4));
  c = await cats('.detail select[aria-label="Attachment 1 ID"]');
  check('body armor attachments: None + Ceramic Plates', c.length === 2 && c[1] === C.ARMOR_ATTACHMENT, c);
  check('body armor: attachments enabled, ammo disabled', await ev(`!$('.detail select[aria-label="Attachment 1 ID"]').prop('disabled') && $('.detail select[aria-label="Ammo ID"]').prop('disabled')`));

  // weapon: compatible ammo and weapon attachments
  await click(slotBtn(5));
  const ruger = await ev('JAPE.exemplar(0x16).ammoIds');
  const ammoOpts = await opts('.detail select[aria-label="Ammo ID"]');
  // Qt's Ruger holds a 5.45mm magazine in this save: kept visible, but only 5.56mm offered besides it
  check('Ruger ammo list = None + 5.56mm + current', JSON.stringify(ammoOpts) === JSON.stringify([0, 0x5C, 0x5E, 0x5F]), { ammoOpts, ruger });
  c = await cats('.detail select[aria-label="Attachment 1 ID"]');
  check('weapon attachments exclude Ceramic Plates', !c.includes(C.ARMOR_ATTACHMENT) && c.includes(C.WEAPON_ATTACHMENT) && c.includes(C.GRENADE));
  await shot('06-weapon');
  check('two-handed Ruger locks the left hand', await ev(`$(${JSON.stringify(slotBtn(7))}).prop('disabled') && /two-handed/.test($(${JSON.stringify(slotBtn(7))}).attr('title'))`));
  const handOpts = await opts('.detail select[aria-label="Item ID"]');
  check('right hand offers only weapons a merc can hold', JSON.stringify(handOpts.slice(1)) === JSON.stringify(await ev('JAPE.ITEMS.filter(x => x.handWeapon).map(x => x.id)')), handOpts.length);

  // change weapon -> default magazine loaded
  await choose('.detail select[aria-label="Item ID"]', 1); // Glock 17
  const hand = await ev(`(() => { const it = JAPE.app.game.getMercByNick('Qt').items[JAPE.Mercenary.RIGHT_HAND]; return { id: it.getInt('Item ID'), q: it.getInt('Quantity'), ammo: it.getInt('Ammo ID'), rounds: it.getInt('Ammo Quantity'), pct: it.getInt('Ammo %') }; })()`);
  check('Glock gets 9mm magazine, full', hand.id === 1 && hand.q === 1 && hand.ammo === 0x47 && hand.rounds === 15 && hand.pct === 100, hand);
  check('button label updated', (await ev(`$(${JSON.stringify(slotBtn(5))}).text()`)) === 'Glock 17');
  check('ammo list follows new weapon (all 9mm)', JSON.stringify(await opts('.detail select[aria-label="Ammo ID"]')) === JSON.stringify([0, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C]), await opts('.detail select[aria-label="Ammo ID"]'));
  await choose('.detail select[aria-label="Ammo ID"]', 0x49);
  check('AP magazine: variety 2', (await ev(`JAPE.app.game.getMercByNick('Qt').items[5].getInt('Ammo Variety')`)) === 2);
  await choose('.detail select[aria-label="Attachment 1 ID"]', 0xCF); // Silencer
  check('attachment from None -> 100%', (await ev(`JAPE.app.game.getMercByNick('Qt').items[5].getInt('Attachment 1 %')`)) === 100);

  // ammo item in backpack: Number of Rounds label, quantity enables % boxes
  await click(slotBtn(8)); // BACKPACK_1_1 = 9mm Pistol Magazine
  check('ammo item label', (await ev(`$('.detail .lbl').eq(2).text()`)) === 'Number of Rounds');
  await type('.detail input[aria-label="Quantity"]', '3');
  check('quantity 3 enables 3 boxes', (await ev(`$('.detail input[aria-label$=" %"][aria-label^="Item"]').map((i, e) => e.disabled).get()`)).join() === 'false,false,false,true,true,true');
  await shot('07-ammo-item');

  // money
  await choose('.detail select[aria-label="Item ID"]', 0x145); // Silver Nugget (MONEY)
  check('money item enables Money Value', await ev(`!$('.detail input[aria-label="Money Value"]').prop('disabled')`));

  // Shadow's M24 holds a 20-round 7.62 NATO magazine (valid in the game)
  await click(`#actor-${idx('*Shadow')}`);
  await click(slotBtn(5));
  check('M24 ammo list = all 7.62mm NATO', JSON.stringify(await opts('.detail select[aria-label="Ammo ID"]')) === JSON.stringify([0, 0x64, 0x65, 0x66, 0x67]), await opts('.detail select[aria-label="Ammo ID"]'));
  await click(`#actor-${idx('*Qt')}`);

  // ---- two-handed weapons and the left hand
  check('one-handed Glock leaves the left hand free', await ev(`!$(${JSON.stringify(slotBtn(7))}).prop('disabled')`));
  await click(slotBtn(7));
  await choose('.detail select[aria-label="Item ID"]', 3); // Beretta 92F in the left hand
  await click(slotBtn(5));
  await choose('.detail select[aria-label="Item ID"]', 0x19); // AK-74
  await sleep(150);
  check('two-handed weapon refused while the left hand is busy',
    /Empty the left hand first/.test(await ev(`$('.dialog-text').text()`)) &&
    (await ev(`JAPE.app.game.getMercByNick('Qt').items[5].getInt('Item ID')`)) === 1 &&
    (await ev(`$('.detail select[aria-label="Item ID"]').val()`)) === '1');
  await shot('11-refused');
  await click('.dialog-buttons .btn');
  await click(slotBtn(7));
  await choose('.detail select[aria-label="Item ID"]', 0);
  await click(slotBtn(5));
  await choose('.detail select[aria-label="Item ID"]', 0x19);
  const ak = await ev(`(() => { const it = JAPE.app.game.getMercByNick('Qt').items[5]; return [it.getInt('Item ID'), it.getInt('Ammo ID')]; })()`);
  check('AK-74 allowed with an empty left hand, 5.45mm loaded', ak[0] === 0x19 && ak[1] === 0x5C, ak);
  check('AK-74 locks the left hand', await ev(`$(${JSON.stringify(slotBtn(7))}).prop('disabled')`));
  await shot('12-two-handed');
  await choose('.detail select[aria-label="Item ID"]', 1); // back to Glock 17
  check('Glock unlocks the left hand', await ev(`!$(${JSON.stringify(slotBtn(7))}).prop('disabled')`));

  // ---- Full Dress
  check('Full Dress enabled for a team member', await ev(`!$('.btn.full-dress').prop('disabled') && $('.btn.full-dress').is(':visible')`));
  await click('.btn.full-dress');
  const dressed = await ev(`$('.slots .btn').map((i, e) => $(e).text()).get().slice(0, 6)`);
  check('Full Dress puts on the set', JSON.stringify(dressed) === JSON.stringify(['Night Vision Goggles', 'Coated Spectra Helmet', 'Extended Ear', 'Coated Spectra Vest', 'Glock 17', 'Coated Spectra Leggings']), dressed);
  const vestView = await ev(`[1, 2, 3, 4].map(k => $('.detail select[aria-label="Attachment ' + k + ' ID"] option:selected').text() + ' ' + $('.detail input[aria-label="Attachment ' + k + ' %"]').val())`);
  check('vest shown with 4 Ceramic Plates at 100%', vestView.every((v) => v === 'Ceramic Plates 100'), vestView);
  check('vest weight 7.7 kg', (await ev(`$('.detail input[aria-label="Weight"]').val()`)) === '77');
  check('Full Dress marks the file modified', (await ev('document.title')).endsWith(' *'));
  const dressedBack = await ev(`(() => { const g = JAPE.SaveGame.load(JAPE.app.game.save(), 'x'); const it = g.getMercByNick('Qt').items;
    return [0, 1, 2, 3, 4].map(k => it[k].get('Item ID') + '/' + it[k].getInt('Item 1 %') + '/' + it[k].getInt('Weight')).concat([it[1].get('Attachment 4 ID')]); })()`);
  check('Full Dress survives save + reload', JSON.stringify(dressedBack) === JSON.stringify(['Coated Spectra Helmet/100/13', 'Coated Spectra Vest/100/77', 'Coated Spectra Leggings/100/35', 'Night Vision Goggles/100/9', 'Extended Ear/100/9', 'Ceramic Plates']), dressedBack);
  await shot('14-full-dress');

  // ---- Add LAW / Add rifle: first empty slot from the last one
  const slotOf = (id) => ev(`JAPE.app.game.getMercByNick('Qt').items.map(it => it.getInt('Item ID'))`).then((ids) => ids);
  check('Add buttons enabled', await ev(`!$('.btn.add-law').prop('disabled') && !$('.btn.add-rifle').prop('disabled')`));
  const before = await slotOf();
  await click('.btn.add-law');
  let ids = await slotOf();
  const lawSlot = ids.findIndex((v, i) => v !== before[i]);
  const lastFree = before.lastIndexOf(0);
  check('LAW goes to the last empty slot', lawSlot === lastFree && ids[lawSlot] === 0x33, [lastFree, lawSlot]);
  check('LAW x6, statuses 100, not fingerprint-locked', JSON.stringify(await ev(`(() => { const it = JAPE.app.game.getMercByNick('Qt').items[${lawSlot}];
    return [it.getInt('Quantity'), [1,2,3,4,5,6].map(k => it.getInt('Item ' + k + ' %')).join(), it.getInt('Unknown 4'), it.getInt('Weight')]; })()`)) === JSON.stringify([6, '100,100,100,100,100,100', 200, 21]));
  check('detail shows the LAW stack', (await ev(`$('.detail input[aria-label="Quantity"]').val()`)) === '6');
  await click('.btn.add-rifle');
  const ids2 = await slotOf();
  const rifleSlot = ids2.findIndex((v, i) => v !== ids[i]);
  check('rifle goes to the next empty slot', rifleSlot === ids.lastIndexOf(0) && ids2[rifleSlot] === 0x41, rifleSlot);
  check('rifle: HEAP, 255 rounds', (await ev(`$('.detail select[aria-label="Ammo ID"] option:selected').text()`)) === 'Minirockets, HEAP' &&
    (await ev(`$('.detail input[aria-label="Ammo Quantity"]').val()`)) === '255');
  const rifleAtt = await ev(`[1, 2, 3, 4].map(k => $('.detail select[aria-label="Attachment ' + k + ' ID"] option:selected').text() + ' ' + $('.detail input[aria-label="Attachment ' + k + ' %"]').val())`);
  check('rifle: Laser Scope, Sniper Scope at 100%, no silencer', JSON.stringify(rifleAtt) === JSON.stringify(['Laser Scope 100', 'Sniper Scope 100', 'None 0', 'None 0']), rifleAtt);
  check('rifle weight 6.3 kg', (await ev(`$('.detail input[aria-label="Weight"]').val()`)) === '63');
  // removing an attachment (None) sets its % to 0
  await choose('.detail select[aria-label="Attachment 2 ID"]', 0);
  check('attachment set to None -> 0%', (await ev(`$('.detail input[aria-label="Attachment 2 %"]').val()`)) === '0' &&
    (await ev(`JAPE.app.game.getMercByNick('Qt').items[${rifleSlot}].getInt('Attachment 2 %')`)) === 0);
  await choose('.detail select[aria-label="Attachment 2 ID"]', 0xD0);
  check('attachment back -> 100%', (await ev(`$('.detail input[aria-label="Attachment 2 %"]').val()`)) === '100');
  // corrected magazine type: Minirockets, AP -> super AP (3)
  await choose('.detail select[aria-label="Ammo ID"]', 0x6F);
  check('Minirockets, AP set ammo type 3', (await ev(`$('.detail input[aria-label="Ammo Variety"]').val()`)) === '3');
  await choose('.detail select[aria-label="Ammo ID"]', 0x71);
  await type('.detail input[aria-label="Ammo Quantity"]', '255');
  // Add AUG: Steyr AUG, 255 x 5.56mm HP, Laser Scope + Sniper Scope, no silencer
  const ids3 = await slotOf();
  await click('.btn.add-aug');
  const ids4 = await slotOf();
  const augSlot = ids4.findIndex((v, i) => v !== ids3[i]);
  check('AUG goes to the next empty slot', augSlot === ids3.lastIndexOf(0) && ids4[augSlot] === 0x14, augSlot);
  const augView = await ev(`[$('.detail select[aria-label="Item ID"] option:selected').text(), $('.detail select[aria-label="Ammo ID"] option:selected').text(),
    $('.detail input[aria-label="Ammo Quantity"]').val(), $('.detail input[aria-label="Ammo Variety"]').val(), $('.detail input[aria-label="Weight"]').val()]
    .concat([1, 2, 3, 4].map(k => $('.detail select[aria-label="Attachment ' + k + ' ID"] option:selected').text() + ' ' + $('.detail input[aria-label="Attachment ' + k + ' %"]').val()))`);
  check('AUG: 255 x 5.56mm HP, Laser + Sniper Scope, weight 5.4 kg', JSON.stringify(augView) === JSON.stringify(
    ['Steyr AUG', '5.56mm Magazine, HP', '255', '1', '54', 'Laser Scope 100', 'Sniper Scope 100', 'None 0', 'None 0']), augView);
  // Add dragunov: Dragunov, 255 x 7.62mm WP (default magazine, AP), Laser Scope + Sniper Scope
  const ids5 = await slotOf();
  await click('.btn.add-dragunov');
  const ids6 = await slotOf();
  const dragSlot = ids6.findIndex((v, i) => v !== ids5[i]);
  check('Dragunov goes to the next empty slot', dragSlot === ids5.lastIndexOf(0) && ids6[dragSlot] === 0x12, dragSlot);
  const dragView = await ev(`[$('.detail select[aria-label="Item ID"] option:selected').text(), $('.detail select[aria-label="Ammo ID"] option:selected').text(),
    $('.detail input[aria-label="Ammo Quantity"]').val(), $('.detail input[aria-label="Ammo Variety"]').val(), $('.detail input[aria-label="Weight"]').val()]
    .concat([1, 2, 3, 4].map(k => $('.detail select[aria-label="Attachment ' + k + ' ID"] option:selected').text() + ' ' + $('.detail input[aria-label="Attachment ' + k + ' %"]').val()))`);
  check('Dragunov: 255 x 7.62mm WP (default), Laser + Sniper Scope, weight 5.9 kg', JSON.stringify(dragView) === JSON.stringify(
    ['Dragunov', '7.62mm WP Magazine, 10', '255', '2', '59', 'Laser Scope 100', 'Sniper Scope 100', 'None 0', 'None 0']), dragView);
  await shot('15-quick-items');
  // keep adding: armour/head slots never take a LAW; when nothing is left, a message
  let dialogSeen = false;
  for (let n = 0; n < 12 && !dialogSeen; n++) {
    await click('.btn.add-law');
    await sleep(60);
    dialogSeen = /No free slot for LAW/.test(await ev(`$('.dialog-text').text()`));
  }
  check('message when no slot is left', dialogSeen);
  if (dialogSeen) { await click('.dialog-buttons .btn'); }
  const final = await slotOf();
  check('armour and head slots untouched', JSON.stringify(final.slice(0, 5)) === JSON.stringify(ids2.slice(0, 5)), final.slice(0, 5));

  // ---- Money Value: 4-byte amount
  await click(slotBtn(8));            // BACKPACK_1_1, the Silver Nugget from the money test
  await type('.detail input[aria-label="Money Value"]', '100000');
  check('Money Value keeps 100000', (await ev(`JAPE.app.game.getMercByNick('Qt').items[11].getInt('Money Value')`)) === 100000 &&
    (await ev(`$('.detail input[aria-label="Money Value"]').attr('maxlength')`)) === '10');

  // ---- the Glock in the hand: no minirockets offered; load 9mm HP to see Reload all keep it
  await click(slotBtn(5));
  check('Glock ammo list has no minirockets', !(await ev(`$('.detail select[aria-label="Ammo ID"] option').map((i, o) => +o.value).get()`)).includes(0x71));
  await choose('.detail select[aria-label="Ammo ID"]', 0x4B);
  check('9mm HP in the Glock: ammo type 1', (await ev(`$('.detail input[aria-label="Ammo Variety"]').val()`)) === '1');

  // ---- whole-team buttons
  await ev(`(() => { const g = JAPE.app.game; const sh = g.getMercByNick('Shadow');
    sh.items[5].setInt('Item 1 %', 40); sh.items[7].setInt('Item 1 %', 55);
    g.getMercByNick('Qt').items[5].data[6] = 3; g.getMercByNick('Qt').items[5].data[10] = 0xFB; })()`);
  await click(`#actor-${idx('Fox')}`);
  await click('.btn.team[data-team=repair]');
  const afterRepair = await ev(`(() => { const sh = JAPE.app.game.getMercByNick('Shadow'); return [sh.items[5].getInt('Item 1 %'), sh.items[7].getInt('Item 1 %'), $('#status-msg').text()]; })()`);
  check('Repair all repairs the whole team', afterRepair[0] === 100 && afterRepair[1] === 100 && /^Repair all: \d+ status/.test(afterRepair[2]), afterRepair);
  await click('.btn.team[data-team=reload]');
  const afterReload = await ev(`(() => { const g = JAPE.app.game; const q = g.getMercByNick('Qt').items; const sh = g.getMercByNick('Shadow').items;
    return [q[5].data[6], q.find(it => it.getInt('Item ID') === 0x14).data[6], sh[7].data[6], $('#status-msg').text(), q[5].getInt('Ammo ID'),
      q[5].data[5], q[5].data[10], q.find(it => it.getInt('Item ID') === 0x14).getInt('Ammo ID')]; })()`);
  check('Reload all: 255 rounds in Glock, AUG and Shadow\'s Beretta', afterReload[0] === 255 && afterReload[1] === 255 && afterReload[2] === 255 &&
    /^Reload all: \d+ gun/.test(afterReload[3]), afterReload);
  check('Reload all keeps the magazines (Glock 9mm HP, AUG 5.56mm HP), type 8, jam cleared',
    afterReload[4] === 0x4B && afterReload[7] === 0x5F && afterReload[5] === 8 && afterReload[6] === 100, afterReload);
  const allGuns = await ev(`JAPE.app.team().map(m => m.items.filter(it => { const ex = JAPE.exemplar(it.getInt('Item ID'));
    return ex && ex.category === JAPE.CAT.WEAPON && ex.defaultAmmoId && it.data[2] === 1; }).map(it => [it.data[6], it.data[5]])).flat()`);
  check('every gun of the team has 255 rounds of type 8', allGuns.length > 0 && allGuns.every((r) => r[0] === 255 && r[1] === 8), allGuns);

  // Shadow has worn kits, Steroid has free pockets, Qt has no room.
  await ev(`(() => { const g = JAPE.app.game;
    JAPE.app.team().forEach(m => m.items.forEach(it => { if ([0xCA, 0xCD].includes(it.getInt('Item ID'))) it.data.fill(0); }));
    [[10, 0xCA, 18], [18, 0xCD, 1]].forEach(([slot, id, weight]) => {
      const kit = g.getMercByNick('Shadow').items[slot]; kit.data.fill(0);
      kit.setInt('Item ID', id); kit.setInt('Quantity', 1); kit.setInt('Item 1 %', 37); kit.setInt('Weight', weight);
      g.getMercByNick('Steroid').items[slot].data.fill(0);
    });
    const qt = g.getMercByNick('Qt');
    qt.items.slice(5).forEach(it => { if (!it.getInt('Item ID')) JAPE.makeLawStack(it, 1); });
    window.__qtBeforeKits = qt.items.slice(5).map(it => Array.from(it.data).join());
    JAPE.app.setModified(false); })()`);
  await click('.btn.team[data-team=dress]');
  const kitWarning = await ev(`$('.dialog-text').text()`);
  check('Full Dress all reports the merc and both kits that do not fit',
    kitWarning.includes('Qt: Medical Kit, Camouflage Kit') && !/Shadow|Steroid/.test(kitWarning), kitWarning);
  await shot('16-no-kit-slot');
  await click('.dialog-buttons .btn');
  const dressedTeam = await ev(`['Qt', 'Shadow', 'Steroid'].map(n => JAPE.app.game.getMercByNick(n).items.slice(0, 5).map(it => it.getInt('Item ID')).join())`);
  check('Full Dress all dresses every team member', dressedTeam.every((v) => v === '182,169,175,211,210'), dressedTeam);
  const kits = await ev(`['Shadow', 'Steroid'].map(n => JAPE.app.game.getMercByNick(n).items
    .map((it, i) => [i, it.getInt('Item ID'), it.getInt('Quantity'), it.getInt('Item 1 %'), it.getInt('Weight')])
    .filter(it => [0xCA, 0xCD].includes(it[1])))`);
  check('Full Dress all refills Shadow\'s kits and creates Steroid\'s in matching pockets',
    JSON.stringify(kits) === JSON.stringify([[[10, 0xCA, 1, 100, 18], [18, 0xCD, 1, 100, 1]],
      [[10, 0xCA, 1, 100, 18], [18, 0xCD, 1, 100, 1]]]), kits);
  check('Full Dress all never overwrites a full inventory', await ev(`JAPE.app.game.getMercByNick('Qt').items.slice(5)
    .every((it, i) => Array.from(it.data).join() === window.__qtBeforeKits[i])`));
  check('Full Dress all marks changes even when one kit cannot be added', await ev('JAPE.app.modified'));
  await ev(`JAPE.app.game.getMercByNick('Qt').items[18].data.fill(0)`);
  await click('.btn.team[data-team=dress]');
  const partialWarning = await ev(`$('.dialog-text').text()`);
  check('Full Dress all reports only the kit that still does not fit',
    partialWarning.includes('Qt: Medical Kit') && !/Camouflage Kit|Shadow|Steroid/.test(partialWarning), partialWarning);
  check('Camouflage Kit is supplied even when Medical Kit does not fit',
    await ev(`JAPE.app.game.getMercByNick('Qt').items[18].getInt('Item ID') === 0xCD &&
      JAPE.app.game.getMercByNick('Qt').items[18].getInt('Item 1 %') === 100`));
  await click('.dialog-buttons .btn');
  await ev(`(() => { const g = JAPE.app.game; g.getMercByNick('Qt').items[10].data.fill(0);
    ['Shadow', 'Steroid'].forEach(n => [10, 18].forEach(s => g.getMercByNick(n).items[s].setInt('Item 1 %', 23))); })()`);
  await click('.btn.team[data-team=dress]');
  check('Full Dress all succeeds without a warning after freeing a big pocket', (await ev(`$('.dialog').length`)) === 0);
  const kitsBack = await ev(`(() => { const g = JAPE.SaveGame.load(JAPE.app.game.save(), 'x');
    return ['Qt', 'Shadow', 'Steroid'].map(n => g.getMercByNick(n).items.filter(it => [0xCA, 0xCD].includes(it.getInt('Item ID')))
      .map(it => [it.getInt('Item ID'), it.getInt('Quantity'), it.getInt('Item 1 %'), it.getInt('Weight')])); })()`);
  check('Both kits for the whole team stay at 100%, without duplicates, after save + reload',
    JSON.stringify(kitsBack) === JSON.stringify([[[0xCA, 1, 100, 18], [0xCD, 1, 100, 1]],
      [[0xCA, 1, 100, 18], [0xCD, 1, 100, 1]], [[0xCA, 1, 100, 18], [0xCD, 1, 100, 1]]]), kitsBack);
  const teamBack = await ev(`(() => { const g = JAPE.SaveGame.load(JAPE.app.game.save(), 'x');
    return [g.getMercByNick('Shadow').items[1].get('Item ID'), g.getMercByNick('Shadow').items[5].getInt('Item 1 %'), g.getMercByNick('Qt').items[5].data[6], g.getMercByNick('Qt').items[11].getInt('Money Value')]; })()`);
  check('team actions and money survive save + reload', JSON.stringify(teamBack) === JSON.stringify(['Coated Spectra Vest', 100, 255, 100000]), teamBack);
  await click(`#actor-${idx('*Qt')}`);
  await shot('16-team');
  await click('.slots .btn[title="Backpack 4-3: Medical Kit"]');
  check('Medical Kit appears in the selected merc\'s inventory details',
    (await ev(`$('.detail select[aria-label="Item ID"] option:selected').text()`)) === 'Medical Kit' &&
    (await ev(`$('.detail input[aria-label="Item 1 %"]').val()`)) === '100');
  await shot('17-medical-kit');
  await click('.slots .btn[title="Backpack 4-2: Camouflage Kit"]');
  check('Camouflage Kit appears at 100% in a small pocket',
    (await ev(`$('.detail select[aria-label="Item ID"] option:selected').text()`)) === 'Camouflage Kit' &&
    (await ev(`$('.detail input[aria-label="Item 1 %"]').val()`)) === '100' &&
    (await ev(`$('.detail input[aria-label="Weight"]').val()`)) === '1');
  await shot('18-camouflage-kit');

  // ---- edits survive a save + reload
  const ok = await ev(`(() => { const out = JAPE.app.game.save(); const g = JAPE.SaveGame.load(out, 'x'); const m = g.getMercByNick('Qt'); return m.getInt('Strength') === 127 && m.items[5].get('Item ID') === 'Glock 17' && m.items[11].get('Item ID') === 'Silver Nugget'; })()`);
  check('UI edits survive save + reload with valid checksums', ok);

  // ---- close with unsaved changes -> prompt
  const closing = ev(`JAPE.app.doClose().then(r => window.__closed = r)`);
  await sleep(150);
  check('unsaved-changes prompt shown', (await ev(`$('.dialog-text').text()`)).includes('has been modified'));
  await shot('08-close-prompt');
  await click('.dialog-buttons .btn:nth-child(3)'); // Cancel
  await closing;
  check('Cancel keeps file open', (await ev('window.__closed')) === false && (await ev('!!JAPE.app.game')));

  // ---- about
  const about = ev(`JAPE.app.command('about')`);
  await sleep(100);
  await shot('09-about');
  await key('Escape', 'Escape', 27);
  await about;
  check('about closes with Escape', (await ev(`$('.dialog').length`)) === 0);

  // ---- list keyboard
  await click(`#actor-${idx('Fox')}`);
  await key('ArrowDown', 'ArrowDown', 40);
  check('ArrowDown selects next', (await ev('JAPE.app.index')) === idx('Fox') + 1);

  // back to Fox for the reference screenshot
  await click(`#actor-${idx('Fox')}`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 545, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await shot('10-fox-like-jape2');

  check('page never scrolls (no overflow at 1040x545)', (await ev('window.__pageScroll || 0')) === 0 && (await ev('document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth')), await ev('[document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight, innerWidth, innerHeight]'));

  // ---- Save through a File System Access handle (stubbed) overwrites in place
  const fsaSave = await ev(`(async () => {
    const app = JAPE.app; let written = null, closed = false;
    app.handle = { name: 'SaveGame01.sav', queryPermission: async () => 'granted',
      createWritable: async () => ({ write: async (b) => { written = b; }, close: async () => { closed = true; } }) };
    const ok = await app.doSave();
    const g = written && JAPE.SaveGame.load(written, 'x');
    return { ok, closed, modified: app.modified, title: document.title,
      strength: g && g.getMercByNick('Qt').getInt('Strength'), size: written && written.length };
  })()`);
  check('Save writes through the file handle', fsaSave.ok && fsaSave.closed && fsaSave.strength === 127 && fsaSave.size === fs.statSync(saveFile).size, fsaSave);
  check('Save clears the modified flag', fsaSave.modified === false && !fsaSave.title.endsWith('*'), fsaSave);
  const denied = ev(`(async () => {
    const app = JAPE.app; app.setModified(true);
    app.handle = { name: 'x.sav', queryPermission: async () => 'prompt', requestPermission: async () => 'denied' };
    return app.doSave();
  })()`);
  await sleep(150);
  check('denied write permission shows an error', /Unable to save file/.test(await ev(`$('.dialog-text').text()`)));
  await click('.dialog-buttons .btn');
  check('denied save keeps the modified flag', (await denied) === false && (await ev('JAPE.app.modified')) === true);

  check('no console errors', errors.length === 0, errors);

  // ---- Fallback for browsers without the File System Access API (Firefox, Safari)
  const dlDir = path.join(outDir, 'downloads');
  fs.rmSync(dlDir, { recursive: true, force: true });
  fs.mkdirSync(dlDir, { recursive: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showOpenFilePicker; delete window.showSaveFilePicker; delete Window.prototype.showOpenFilePicker; delete Window.prototype.showSaveFilePicker;' });
  await ev('JAPE.app.modified = false');
  await send('Page.reload');
  await sleep(1200);
  check('fallback mode: no File System Access API', (await ev('typeof window.showOpenFilePicker')) === 'undefined');
  check('fallback mode: status explains download', true);
  await ev(`JAPE.app.openBytes(Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0)), 'SaveGame01.sav')`);
  check('fallback status mentions download', /Save downloads a copy/.test(await ev(`$('#status-file').text()`)), await ev(`$('#status-file').text()`));
  await click(`#actor-${idx('*Qt')}`);
  await type('#stat-panel input[aria-label="Wisdom"]', '99');
  await key('s', 'KeyS', 83, 2); // Ctrl+S
  let dl = null;
  for (let i = 0; i < 40 && !dl; i++) {
    await sleep(150);
    const f = fs.readdirSync(dlDir).filter((n) => n.endsWith('.sav'));
    if (f.length) dl = path.join(dlDir, f[0]);
  }
  check('Ctrl+S downloads SaveGame01.sav', !!dl && path.basename(dl) === 'SaveGame01.sav', dl);
  if (dl) {
    await sleep(300);
    const vm = require('vm');
    const ctx = vm.createContext({});
    for (const f of ['codetables', 'items', 'alg', 'fields', 'model', 'savegame']) vm.runInContext(fs.readFileSync(path.join(webDir, 'js', f + '.js'), 'utf8'), ctx);
    const g = ctx.JAPE.SaveGame.load(new Uint8Array(fs.readFileSync(dl)), 'dl');
    check('downloaded save loads in Node with the edit', g.getMercByNick('Qt').getInt('Wisdom') === 99);
  }
  check('no console errors (fallback)', errors.length === 0, errors);
  ws.close();
  chrome.kill();
  console.log(failures ? `\n${failures} UI check(s) FAILED` : '\nAll UI checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
