const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const C = require('../core.js');
const root = path.resolve(__dirname, '..');
const out = path.resolve(root, '..', 'qa');
const server = http.createServer(async (req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await fs.readFile(file); res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
async function main() {
  await fs.mkdir(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const visible = async locator => { await locator.waitFor({ state: 'visible', timeout: 5000 }); assert.equal(await locator.isVisible(), true); };
  const hidden = async locator => { await locator.waitFor({ state: 'hidden', timeout: 5000 }); assert.equal(await locator.isVisible(), false); };
  const download = async (action, filename) => { const waiting = page.waitForEvent('download'); await action(); const file = await waiting; const target = path.join(out, filename); await file.saveAs(target); assert.equal(await file.failure(), null); return target; };
  try {
    await page.goto(url);
    await visible(page.getByText('No borrowers yet. Add your first borrower to begin.'));
    // Close and cancel work even when required fields are empty. Escape restores focus.
    await page.locator('#newLoanTop').click();
    assert.equal(await page.locator('[name=phone]').getAttribute('placeholder'), null);
    await page.locator('#loanModal [data-close]').first().click(); await hidden(page.locator('#loanModal'));
    await page.locator('#newLoanHero').click(); await page.locator('#loanModal').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('#addBorrower').click(); await page.keyboard.press('Escape'); await hidden(page.locator('#loanModal'));
    await page.locator('#currencySelect').selectOption('INR');
    await page.locator('#addBorrower').click();
    const fields = page.locator('#loanForm');
    const name = 'Maya "Patel", 李 <b>';
    const firstDue = C.iso(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1, 12));
    for (const [key, value] of Object.entries({ name, phone: '+91 9000000000', amount: '1200', months: '3', rate: '0', firstDue, address: 'Test address', referrer: 'Test referrer', family: '+86 1000000000' })) await fields.locator(`[name="${key}"]`).fill(value);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1kAAAAASUVORK5CYII=', 'base64');
    await fields.locator('[name=documents]').setInputFiles({ name: 'test-document.png', mimeType: 'image/png', buffer: png });
    await click('Save borrower & loan'); await hidden(page.locator('#loanModal'));
    assert.equal(await page.locator('#borrowerRows strong').first().textContent(), name);
    assert.equal(await page.locator('#borrowerRows b').count(), 0);
    assert.ok((await page.locator('#totalOutstanding').textContent()).includes('1,200'));
    await page.reload(); await visible(page.getByText(name, { exact: true }).first());
    await page.locator('#borrowerRows').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await fields.locator('[name=phone]').inputValue(), '+91 9000000000');
    await fields.locator('[name=amount]').fill('1800'); await click('Save changes');
    assert.ok((await page.locator('#totalOutstanding').textContent()).includes('1,800'));
    await page.locator('#borrowerRows').getByRole('button', { name: 'Payments', exact: true }).click();
    assert.equal(await page.locator('#paymentRows tr').count(), 3);
    await page.locator('#paymentRows tr').first().getByRole('button').click();
    await click('Save payment'); await hidden(page.locator('#receiptModal'));
    assert.ok((await page.locator('#paymentRows tr').first().textContent()).includes('Paid late'));
    await page.locator('#paymentRows tr').nth(1).getByRole('button').click();
    await page.locator('#receiptForm [name=amount]').fill('100'); await click('Save payment');
    assert.ok((await page.locator('#paymentRows tr').nth(1).textContent()).includes('Overdue (partial)'));
    assert.ok((await page.locator('#totalOutstanding').textContent()).includes('1,100'));
    await page.screenshot({ path: path.join(out, 'repayments-desktop.png'), fullPage: true });
    await page.locator('#paymentsModal').getByRole('button', { name: 'Done', exact: true }).click();
    // Terms with recorded money require confirmation and reject incompatible edits.
    await page.locator('#borrowerRows').getByRole('button', { name: 'Edit', exact: true }).click();
    await fields.locator('[name=amount]').fill('300'); await click('Save changes'); await visible(page.locator('#loanError'));
    await fields.locator('[name=amount]').fill('1800'); await fields.locator('[name=firstDue]').fill(C.monthDate(firstDue, -1)); await click('Save changes');
    await visible(page.locator('#confirmModal')); await page.locator('#confirmModal').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('#loanModal [data-close]').first().click();
    await page.locator('#searchInput').fill('missing name'); assert.ok((await page.locator('#borrowerRows').textContent()).includes('No borrowers match'));
    await page.locator('#searchInput').fill(''); await page.locator('#statusFilter').selectOption('paid'); assert.ok((await page.locator('#tableCount').textContent()).includes('0'));
    await page.locator('#statusFilter').selectOption('overdue'); await visible(page.locator('#borrowerRows').getByText(name, { exact: true }));
    await page.locator('#statusFilter').selectOption('all'); await page.locator('#sortSelect').selectOption('name');
    await page.locator('#chartPeriod').selectOption('12'); assert.equal(await page.locator('.bar-group').count(), 12);
    await page.locator('#notificationsBtn').click(); await visible(page.getByRole('heading', { name: 'Payment reminders' }));
    await page.locator('#remindersToggle').uncheck(); await page.locator('#utilityModal').getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Reminders', exact: false }).first().click(); assert.equal(await page.locator('#remindersToggle').isChecked(), false);
    await page.locator('#utilityModal .close[data-close]').click();
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await download(() => click('Download'), 'document.png'); assert.deepEqual(await fs.readFile(path.join(out, 'document.png')), png);
    await page.locator('#utilityModal').getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('#exportBtn').click();
    const csvPath = await download(() => click('Download detailed CSV'), 'payments.csv');
    const csv = await fs.readFile(csvPath, 'utf8'); assert.ok(csv.includes('Overdue (partial)')); assert.ok(csv.includes('"INR"')); assert.ok(csv.includes('"\'+91 9000000000"'));
    const xlsxPath = await download(() => click('Download Excel (.xlsx)'), 'payments.xlsx');
    const Excel = require('../vendor/exceljs.min.js'), book = new Excel.Workbook(); await book.xlsx.load(await fs.readFile(xlsxPath));
    const sheet = book.worksheets[0]; assert.equal(sheet.rowCount, 4); assert.equal(sheet.getCell('T2').value, 'Paid late'); assert.equal(sheet.getCell('T2').font.color.argb, 'FF9C1C20'); assert.equal(sheet.getCell('P3').value, 100);
    await page.locator('#utilityModal .close[data-close]').click();
    await click('Settings & backup'); await page.locator('#settingsCurrency').selectOption('CNY'); assert.ok((await page.locator('#totalOutstanding').textContent()).includes('0.00'));
    await page.locator('#settingsCurrency').selectOption('INR');
    const backupPath = await download(() => click('Download backup'), 'portfolio.json');
    await page.locator('#utilityModal .close[data-close]').click();
    await page.locator('#borrowerRows').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('#confirmModal').getByRole('button', { name: 'Cancel' }).click(); await visible(page.locator('#borrowerRows').getByText(name, { exact: true }));
    await page.locator('#borrowerRows').getByRole('button', { name: 'Delete', exact: true }).click(); await click('Delete borrower');
    await visible(page.getByText('No borrowers yet. Add your first borrower to begin.'));
    await click('Settings & backup'); await click('Undo last deletion'); await page.locator('#utilityModal .close[data-close]').click();
    await visible(page.locator('#borrowerRows').getByText(name, { exact: true }));
    await click('Settings & backup'); await page.locator('#restoreInput').setInputFiles(backupPath); await click('Restore backup'); await page.locator('#utilityModal .close[data-close]').click();
    await page.reload(); await visible(page.locator('#borrowerRows').getByText(name, { exact: true }));
    // Populate only this isolated test browser to verify pagination and multiple currencies.
    const payload = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    payload.loans = [...payload.loans, ...Array.from({ length: 10 }, (_, i) => ({ ...payload.loans[0], id: `extra-${i}`, name: `Borrower ${i}`, payments: {}, documents: [], currency: i === 9 ? 'CNY' : 'INR' }))];
    await page.evaluate(data => localStorage.setItem('lendwisePortfolioV3', JSON.stringify(data)), payload); await page.reload();
    assert.equal(await page.locator('#borrowerRows tr').count(), 8); await click('Next page'); assert.equal(await page.locator('#borrowerRows tr').count(), 2); await click('Previous page');
    await page.locator('#sortSelect').selectOption('amount'); await page.locator('#sortSelect').selectOption('due');
    await page.locator('#currencySelect').selectOption('CNY'); assert.equal(await page.locator('#borrowerRows tr').count(), 1); await page.locator('#currencySelect').selectOption('INR');
    await page.getByRole('link', { name: 'Borrowers', exact: false }).click(); await page.getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('link', { name: 'L Lendwise', exact: true }).click();
    await page.getByRole('button', { name: 'Repayments', exact: true }).click(); await page.locator('#paymentsModal .close[data-close]').click();
    await page.getByRole('button', { name: 'Reports', exact: true }).click(); await page.locator('#utilityModal .close[data-close]').click();
    await click('View all'); await page.locator('#paymentsModal .close[data-close]').click();
    await click('Manage backups'); await page.locator('#utilityModal .close[data-close]').click();
    await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
    // Phone controls stay reachable, and dialogs have no clipped close/save buttons.
    await page.setViewportSize({ width: 390, height: 844 });
    await click('Toggle menu'); await visible(page.locator('#sidebar')); await click('Reports'); await page.locator('#utilityModal .close[data-close]').click();
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'false');
    await click('Toggle menu'); await click('Toggle menu');
    await page.locator('#newLoanTop').click(); await page.screenshot({ path: path.join(out, 'loan-mobile.png') }); await page.locator('#loanModal [data-close]').first().click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(out, 'dashboard-mobile.png'), fullPage: true });
    // Clear receipt flow, document removal, invalid restore and storage failures.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#searchInput').fill(name);
    await page.locator('#borrowerRows').getByRole('button', { name: 'Payments', exact: true }).click();
    await page.locator('#paymentRows tr').first().getByRole('button').click(); await page.locator('#receiptForm [name=amount]').fill('0'); await click('Save payment'); await click('Clear payment');
    await hidden(page.locator('#receiptModal')); assert.ok((await page.locator('#paymentRows tr').first().textContent()).includes('Overdue')); await page.locator('#paymentsModal .close[data-close]').click();
    await page.locator('#borrowerRows').getByRole('button', { name: 'Edit', exact: true }).click(); await click('Remove'); await click('Save changes');
    await click('Documents'); await visible(page.getByText('No documents saved. Add them when creating or editing a borrower.')); await page.locator('#utilityModal .close[data-close]').click();
    await click('Settings & backup'); await page.locator('#restoreInput').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":3,"loans":[{}]}') });
    await visible(page.locator('#toast')); await page.locator('#utilityModal .close[data-close]').click();
    await page.evaluate(() => localStorage.setItem('lendwisePortfolioV3', '{broken')); await page.reload(); await visible(page.locator('#storageError'));
    await click('Settings & backup'); await download(() => click('Download backup'), 'recovery.json'); await page.locator('#utilityModal .close[data-close]').click();
    await page.evaluate(data => localStorage.setItem('lendwisePortfolioV3', JSON.stringify(data)), payload); await page.reload();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
    await page.locator('#borrowerRows').getByRole('button', { name: 'Edit', exact: true }).first().click(); await click('Save changes'); await visible(page.locator('#loanError')); assert.ok((await page.locator('#loanError').textContent()).includes('Unable to save'));
    assert.deepEqual(errors, []);
    console.log('PASS: borrower CRUD, receipts, currency integrity, all navigation, close/cancel, search/filter/sort/pages, documents, CSV/XLSX downloads, backup/restore, corruption/quota handling, mobile layout, no browser errors.');
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

