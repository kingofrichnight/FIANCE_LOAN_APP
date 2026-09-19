const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const loan = (overrides = {}) => ({ id: 'test-loan', name: 'Test borrower', phone: '+91 9000000000', amount: 1200, months: 12, rate: 0, firstDue: '2026-01-31', currency: 'INR', payments: {}, documents: [], ...overrides });
test('monthly dates retain original day across leap years and year boundaries', () => {
  assert.equal(C.monthDate('2024-01-31', 1), '2024-02-29');
  assert.equal(C.monthDate('2024-01-31', 2), '2024-03-31');
  assert.equal(C.monthDate('2026-12-31', 1), '2027-01-31');
  assert.equal(C.parseDate('2026-02-30'), null);
});
test('zero-interest schedule reconciles cents and final principal balance', () => {
  const rows = C.schedule(loan({ amount: 1000, months: 3 }));
  assert.deepEqual(rows.map(r => r.dueAmount), [333.33, 333.33, 333.34]);
  assert.equal(rows.at(-1).balance, 0);
  assert.equal(C.round(rows.reduce((a, r) => a + r.principal, 0)), 1000);
});
test('interest schedule reconciles principal with no negative closing balance', () => {
  assert.equal(C.payment(12000, 12, 12), 1066.19);
  const rows = C.schedule(loan({ amount: 12000, rate: 12 }));
  assert.equal(rows[0].interest, 120);
  assert.equal(C.round(rows.reduce((a, r) => a + r.principal, 0)), 12000);
  assert.equal(rows.at(-1).balance, 0);
});
test('partial, overdue, due-today, upcoming, and paid-late states use dates and receipts', () => {
  const rows = C.schedule(loan({ firstDue: '2026-06-01', payments: { 1: { amount: 100, date: '2026-06-05' }, 2: { amount: 25, date: '2026-07-01' } } }), '2026-09-01');
  assert.equal(rows[0].status, 'Paid late'); assert.equal(rows[0].lateDays, 4);
  assert.equal(rows[1].status, 'Overdue (partial)'); assert.equal(rows[1].remaining, 75);
  assert.equal(rows[2].status, 'Overdue');
  assert.equal(rows[3].status, 'Due today'); assert.equal(rows[3].delayed, false);
  assert.equal(rows[4].status, 'Upcoming');
});
test('earlier data retains stored amounts, installment and contact details without invented rates', () => {
  const [saved] = C.migrate([{ name: 'Existing', phone: '+86 123', amount: 1234, months: 12, payment: 111, due: 'Sep 21, 2026', address: 'Existing address' }]);
  assert.equal(saved.amount, 1234); assert.equal(saved.currency, 'USD'); assert.equal(saved.rate, null);
  assert.equal(saved.firstDue, '2026-09-21'); assert.equal(C.schedule(saved)[0].dueAmount, 111);
  assert.equal(C.schedule(saved)[0].interest, null);
});
test('invalid terms or edits that erase/overpay existing installments are rejected', () => {
  assert.throws(() => C.validateLoan(loan({ months: 0 })));
  assert.throws(() => C.validateLoan(loan({ months: 1.5 })));
  assert.throws(() => C.validateLoan(loan({ amount: NaN })));
  assert.throws(() => C.validateLoan(loan({ rate: -1 })));
  assert.throws(() => C.validateLoan(loan({ firstDue: '2026-02-30' })));
  assert.throws(() => C.validateLoan(loan({ payments: { 13: { amount: 100, date: '2026-06-01' } } })));
  assert.throws(() => C.validateLoan(loan({ payments: { 1: { amount: 101, date: '2026-06-01' } } })));
  assert.throws(() => C.validateLoan(loan({ payments: { '01': { amount: 100, date: '2026-06-01' } } })));
});

test('custom monthly plans use the exact entered due for every month, independent of principal and APR', () => {
  for (const monthly of [250, 500]) {
    const custom = C.validateLoan(loan({ repaymentMode: 'custom', amount: 1000, months: 3, rate: null, payment: monthly }));
    const rows = C.schedule(custom);
    assert.deepEqual(rows.map(row => row.dueAmount), [monthly, monthly, monthly]);
    assert.ok(rows.every(row => row.interest === null && row.principal === null && row.balance === null));
    const output = C.exportRows([custom])[0];
    assert.equal(output[9], null); assert.equal(output[22], 'Custom monthly payment');
    assert.equal(C.migrate([custom])[0].payment, monthly);
  }
  assert.throws(() => C.validateLoan(loan({ repaymentMode: 'custom', payment: 0 })));
  assert.throws(() => C.validateLoan(loan({ repaymentMode: 'custom', payment: 12.345 })));
  assert.throws(() => C.validateLoan(loan({ repaymentMode: 'custom', payment: NaN })));
  assert.throws(() => C.validateLoan(loan({ repaymentMode: 'custom', payment: 80, payments: { 1: { amount: 100, date: '2026-01-31' } } })));
});

test('malformed imports are rejected rather than silently changing loan terms', () => {
  for (const bad of [null, [], false, 'borrower']) assert.throws(() => C.migrate([bad]));
  for (const fields of [{ months: 0 }, { months: '' }, { amount: true }, { currency: '' }, { amount: 10.001 }, { payments: false }]) assert.throws(() => C.migrate([loan(fields)]));
  assert.equal(C.migrate([loan({ months: undefined })])[0].months, 12);
  assert.equal(C.migrate([loan({ months: '3', amount: '150.25', rate: '0' })])[0].months, 3);
});

test('sub-cent, future-dated, and unsafe total payment values are rejected', () => {
  assert.throws(() => C.validateLoan(loan({ payments: { 1: { amount: 0.001, date: '2026-01-01' } } })));
  assert.throws(() => C.validateLoan(loan({ payments: { 1: { amount: 10, date: '2199-01-01' } } })));
  assert.throws(() => C.validateLoan(loan({ repaymentMode: 'custom', payment: 1e12, months: 600 })));
});

test('amortization reconciles principal over 192 combinations of amount, rate and term', () => {
  for (const amount of [.01, 1, 5.55, 10.01, 1250.33, 99999.99, 1000000, 50000000]) for (const months of [1, 2, 3, 12, 60, 600]) for (const rate of [0, .01, 12, 100]) {
    const rows = C.schedule(loan({ amount, months, rate }));
    assert.equal(rows.length, months); assert.equal(rows.at(-1).balance, 0);
    assert.ok(rows.every(row => row.dueAmount >= 0 && row.balance >= 0 && Number.isFinite(row.dueAmount)));
    assert.ok(Math.abs(C.round(rows.reduce((sum, row) => sum + row.principal, 0)) - amount) < .01);
  }
});
test('repayment score has no history for future, due-today or zero-value installments', () => {
  assert.equal(C.repaymentScore(loan(), '2026-01-01').score, null);
  assert.equal(C.repaymentScore(loan({ payments: { 1: { amount: 100, date: '2026-01-01' } } }), '2026-01-31').score, null);
  const tiny = C.repaymentScore(loan({ amount: .01, months: 12 }), '2026-03-01');
  assert.equal(tiny.assessed, 0); assert.equal(tiny.score, null);
  assert.throws(() => C.repaymentScore(loan(), 'not-a-date'));
});

test('repayment score explains on-time, late, partial and unrecorded months with equal weighting', () => {
  const input = loan({ amount: 400, months: 4, firstDue: '2026-01-01', payments: { 1: { amount: 100, date: '2026-01-01' }, 2: { amount: 100, date: '2026-02-02' }, 3: { amount: 50, date: '2026-03-01' } } });
  const result = C.repaymentScore(input, '2026-04-02');
  assert.equal(result.score, 43); assert.equal(result.assessed, 4);
  for (const key of ['onTime', 'paidLate', 'partialOverdue', 'unpaidOverdue']) assert.equal(result[key], 1);
  assert.deepEqual(result.installments.map(item => item.points), [100, 50, 25, 0]);
});

test('repayment score reaches 100 only with all on-time months and respects receipt snapshot dates', () => {
  const input = loan({ amount: 200, months: 2, firstDue: '2026-01-01', payments: { 1: { amount: 100, date: '2026-01-01' }, 2: { amount: 100, date: '2026-01-01' } } });
  assert.equal(C.repaymentScore(input, '2026-02-02').score, 100);
  input.payments[1].date = '2026-01-03';
  assert.equal(C.repaymentScore(input, '2026-01-02').score, 0);
  assert.equal(C.repaymentScore(input, '2026-01-03').score, 50);
  assert.equal(C.repaymentScore(input, '2026-02-02').score, 75);
});

test('custom and interest plans score from payment proportions, not identity or denomination', () => {
  const base = loan({ amount: 1200, months: 12, firstDue: '2026-01-01', payments: { 1: { amount: 30, date: '2026-01-02' } } });
  assert.equal(C.repaymentScore(base, '2026-01-03').score, 15);
  const custom = { ...base, name: 'Different name', phone: '+86 123', currency: 'CNY', amount: 9999, repaymentMode: 'custom', rate: null, payment: 250, payments: { 1: { amount: 75, date: '2026-01-02' } } };
  assert.equal(C.repaymentScore(custom, '2026-01-03').score, 15);
});

test('editing or restoring receipts recomputes scores without storing or mutating a score', () => {
  const input = loan({ amount: 100, months: 1, firstDue: '2026-01-01', payments: { 1: { amount: 20, date: '2026-01-02' } } });
  const raw = JSON.stringify(input);
  assert.equal(C.repaymentScore(input, '2026-02-01').score, 10); assert.equal(JSON.stringify(input), raw);
  input.payments[1].amount = 100;
  assert.equal(C.repaymentScore(input, '2026-02-01').score, 50);
  input.payments[1].date = '2026-01-01';
  assert.equal(C.repaymentScore(input, '2026-02-01').score, 100);
  assert.equal(C.repaymentScore(C.migrate([JSON.parse(raw)])[0], '2026-02-01').score, 10);
  delete input.payments[1]; assert.equal(C.repaymentScore(input, '2026-02-01').score, 0);
});

test('exports include the dated local score, history count and formula, with blank distinct from zero', () => {
  assert.deepEqual(C.exportRows([loan()], '2026-01-01')[0].slice(23), [null, 0, 'local-v1']);
  assert.deepEqual(C.exportRows([loan()], '2026-02-01')[0].slice(23), [0, 1, 'local-v1']);
  assert.equal(C.headers.length, 26); assert.equal(C.exportRows([loan()])[0].length, 26);
  assert.ok(C.csv([loan()]).includes('not credit score'));
});

test('CSV includes all months and currencies, quotes multiline text and neutralizes formula injection', () => {
  const input = [loan({ name: '=HYPERLINK("bad")', address: 'Line 1,\nLine 2' }), loan({ id: 'other', currency: 'CNY' })];
  const rows = C.exportRows(input, '2026-06-01');
  assert.equal(rows.length, 24); assert.equal(rows[12][6], 'CNY');
  const csv = C.csv(input, '2026-06-01');
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\'+91 9000000000"')); assert.ok(csv.includes('"Line 1,\nLine 2"'));
  assert.ok(csv.includes('Days late')); assert.ok(csv.includes('Overdue'));
});
test('XLSX round-trip retains numeric amounts, dates, filters and red delayed rows', async () => {
  const Excel = require('../vendor/exceljs.min.js');
  const { workbook } = require('../export.js');
  const book = await workbook([loan({ name: '李 "Test"', months: 3, firstDue: '2026-01-01' })], '2026-02-01', Excel, C);
  const buffer = await book.xlsx.writeBuffer();
  const reopened = new Excel.Workbook(); await reopened.xlsx.load(buffer);
  const sheet = reopened.getWorksheet('Monthly payments');
  assert.equal(sheet.rowCount, 4); assert.equal(sheet.getCell('B2').value, '李 "Test"');
  assert.equal(typeof sheet.getCell('M2').value, 'number'); assert.ok(sheet.getCell('L2').value instanceof Date);
  assert.equal(sheet.getCell('T2').value, 'Overdue'); assert.equal(sheet.getCell('T2').font.color.argb, 'FF9C1C20');
  assert.notEqual(sheet.getCell('T3').font?.color?.argb, 'FF9C1C20'); assert.ok(sheet.autoFilter);
  assert.equal(sheet.getCell('X2').value, 0); assert.equal(sheet.getCell('Y2').value, 1); assert.equal(sheet.getCell('Z2').value, 'local-v1'); assert.ok(sheet.getCell('X1').note.includes('not a credit score'));
});
