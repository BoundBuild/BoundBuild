/* Headless UI smoke test for BoundBuild MVP */
const { chromium } = require('/tmp/node_modules/playwright-core');

const BASE = 'http://localhost:8080';
let failures = 0;
const ok = (name, cond) => { console.log((cond ? '✔' : '✘ FAIL') + ' ' + name); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ---- login screen ----
  await page.goto(BASE + '/#/login');
  await page.waitForSelector('#login-form');
  ok('login screen renders', await page.isVisible('#login-form'));
  ok('demo users shown', (await page.$$('.demo-user')).length === 2);

  // ---- demo login as foreman ----
  await page.waitForTimeout(500); // let the login view mount bind its handlers
  await page.click('.demo-user[data-email="foreman1@kowhaiconstruction.co.nz"]');
  await page.waitForSelector('.record-btn', { timeout: 8000 });
  ok('home renders after login', await page.isVisible('.record-btn'));
  ok('bottom nav visible', await page.isVisible('#bottomnav'));
  ok('recent events listed', (await page.$$('.ev-card')).length >= 5);
  ok('topbar brand', (await page.textContent('.brand-name')).includes('BOUNDBUILD'));

  // ---- capture flow: sample note → AI draft → review → save ----
  await page.click('.nav-fab');
  await page.waitForSelector('#rec-toggle, #rec-skip', { timeout: 5000 });
  // mic unavailable in headless → either rec-toggle or skip appears
  if (await page.isVisible('#rec-skip')) await page.click('#rec-skip');
  await page.waitForSelector('#cap-transcript', { timeout: 5000 });
  ok('note step reached (typed fallback)', true);
  // fill transcript manually
  await page.fill('#cap-transcript', "The client asked on site if we can add an extra 3 metre driveway apron on Unit 4. Not in the current scope, need to give them a price, maybe two days of work.");
  // attach a photo
  await page.setInputFiles('#cap-photos', __dirname + '/../public/demo/img-timber.jpg');
  await page.waitForSelector('#photo-thumbs .thumb-cell', { timeout: 8000 });
  ok('photo attached & compressed', (await page.$$('#photo-thumbs .thumb-cell')).length === 1);
  await page.click('#cap-structure');
  await page.waitForSelector('[data-f="title"]', { timeout: 10000 });
  ok('AI draft review form shown', true);
  const titleVal = await page.inputValue('[data-f="title"]');
  ok('draft title auto-filled', titleVal.length > 5);
  const typeVal = await page.inputValue('[data-f="type"]');
  ok('draft type detected: ' + typeVal, typeVal.length > 0);
  ok('AI badge visible', await page.isVisible('.ai-badge'));
  ok('warning notice visible', await page.isVisible('.notice.warn'));
  // edit a field then save
  await page.fill('[data-f="location"]', 'Unit 4 — front driveway');
  await page.click('#cap-save');
  await page.waitForSelector('.done-check', { timeout: 8000 });
  ok('event saved — success screen', true);
  ok('capture-time metric shown', await page.isVisible('.done-metric'));
  const doneTxt = await page.textContent('.done-sub');
  ok('saved ref shown: ' + doneTxt.slice(0, 22), /BB-\d{4}/.test(doneTxt));

  // ---- dispatch from success screen ----
  await page.click('#done-dispatch');
  await page.waitForSelector('#dsp-to', { timeout: 5000 });
  ok('dispatch modal opens with prefilled recipient', (await page.inputValue('#dsp-to')) === 'qs@kowhaiconstruction.co.nz');
  await page.click('#dsp-send');
  await page.waitForSelector('.dsp-ok, .dsp-err', { timeout: 10000 });
  const dsp = await page.textContent('.dsp-ok, .dsp-err');
  ok('dispatch result shown: ' + dsp.slice(0, 60), true);
  ok('recipient link generated', await page.isVisible('#dsp-linkval'));
  const link = await page.textContent('#dsp-linkval');
  // visit the recipient link
  const rPage = await browser.newPage();
  await rPage.goto(link);
  await rPage.waitForSelector('h1', { timeout: 8000 });
  ok('public recipient page renders', (await rPage.textContent('h1')).length > 3);
  ok('recipient page shows event ref', (await rPage.content()).includes('BB-'));
  await rPage.close();
  await page.click('#modal-close');

  // ---- ledger ----
  await page.click('#bottomnav .nav-item[href="#/ledger"]');
  await page.waitForSelector('#ledger-q', { timeout: 5000 });
  ok('ledger renders', (await page.$$('#ledger-list .ev-card')).length >= 1);
  await page.fill('#ledger-q', 'driveway');
  await page.waitForTimeout(600);
  const filtered = await page.$$('#ledger-list .ev-card');
  ok('ledger search filters', filtered.length >= 1);
  await page.click('#ledger-list .ev-card');
  await page.waitForSelector('.ev-detail-title', { timeout: 5000 });
  ok('event detail renders', true);
  ok('timeline visible', await page.isVisible('.timeline'));
  ok('photos gallery visible', await page.isVisible('.gallery'));

  // ---- projects ----
  await page.click('#bottomnav .nav-item[href="#/projects"]');
  await page.waitForSelector('.proj-card', { timeout: 5000 });
  ok('projects render', (await page.$$('.proj-card')).length === 2);

  // ---- settings ----
  await page.click('#bottomnav .nav-item[href="#/settings"]');
  await page.waitForSelector('#btn-logout', { timeout: 5000 });
  ok('settings renders', true);

  // ---- admin as jess ----
  await page.click('#btn-logout');
  await page.waitForSelector('#login-form', { timeout: 5000 });
  await page.waitForTimeout(500); // let the login view mount bind its handlers
  await page.click('.demo-user[data-email="qs@kowhaiconstruction.co.nz"]');
  await page.waitForSelector('.topbar-btn[href="#/admin"]', { timeout: 8000 });
  ok('QS sees Pilot console link', true);
  await page.click('.topbar-btn[href="#/admin"]');
  await page.waitForSelector('.metric-card', { timeout: 8000 });
  ok('metrics cards render', (await page.$$('.metric-card')).length === 6);
  ok('charts render', (await page.$$('.chart-card')).length >= 3);
  ok('median capture shown', /(2[0-9]|3[0-9]|4[0-9]|5[0-9])s/.test(await page.textContent('.metric-card')));
  // outbox tab
  await page.click('.chip-btn[href="#/admin?outbox"]');
  await page.waitForSelector('.outbox-item', { timeout: 8000 });
  ok('outbox lists dispatches', (await page.$$('.outbox-item')).length >= 5);
  await page.click('.outbox-item [data-html]');
  await page.waitForSelector('.email-frame', { timeout: 5000 });
  ok('email preview opens', true);
  await page.click('#modal-close');
  // team tab
  await page.click('.chip-btn[href="#/admin?team"]');
  await page.waitForSelector('#user-form', { timeout: 8000 });
  ok('team management renders', true);
  // exports tab
  await page.click('.chip-btn[href="#/admin?exports"]');
  await page.waitForSelector('#exp-events', { timeout: 5000 });
  ok('exports tab renders', true);

  // ---- register new company ----
  await page.click('#bottomnav .nav-item[href="#/settings"]');
  await page.waitForSelector('#btn-logout', { timeout: 5000 });
  await page.click('#btn-logout');
  await page.waitForSelector('#login-form', { timeout: 5000 });
  await page.click('a[href="#/register"]');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  const uniq = Date.now();
  await page.fill('#register-form input[name=name]', 'Test User');
  await page.fill('#register-form input[name=companyName]', 'Test Co Ltd');
  await page.fill('#register-form input[name=email]', `test${uniq}@testco.nz`);
  await page.fill('#register-form input[name=password]', 'password123');
  await page.waitForTimeout(500); // let the register view mount bind its submit handler
  await page.click('#register-form button[type=submit]');
  await page.waitForSelector('.record-btn', { timeout: 8000 });
  ok('registration → home with empty company', true);
  ok('empty state shows for new company', await page.isVisible('.empty'));

  console.log(errors.length ? '\nJS errors captured:\n' + errors.join('\n') : '\nNo JS errors.');
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR:', e.message); process.exit(2); });
