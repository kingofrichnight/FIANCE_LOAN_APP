(function (root) {
  'use strict';
  const currencies = { USD: 'US dollar', INR: 'Indian rupee', CNY: 'Chinese yuan (RMB)', EUR: 'Euro', GBP: 'British pound', AED: 'UAE dirham', AUD: 'Australian dollar', CAD: 'Canadian dollar', SGD: 'Singapore dollar' };
  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12);
    return iso(date) === value ? date : null;
  }
  function monthDate(first, offset) {
    const date = parseDate(first);
    if (!date) return '';
    const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0, 12);
    return iso(new Date(last.getFullYear(), last.getMonth(), Math.min(date.getDate(), last.getDate()), 12));
  }
  function daysBetween(start, end) {
    const a = parseDate(start), b = parseDate(end);
    return a && b ? Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) : 0;
  }
  function payment(amount, months, rate) {
    const r = rate / 1200;
    return round(r ? amount * r / -Math.expm1(-months * Math.log1p(r)) : amount / months);
  }
  // Older fixed-payment loans have no rate. Preserve their saved schedule.
  const repaymentMode = loan => loan.repaymentMode || (loan.rate === null ? 'custom' : 'interest');
  function schedule(loan, asOf = today()) {
    let balance = round(loan.amount);
    const custom = repaymentMode(loan) === 'custom';
    const monthly = custom ? round(loan.payment) : payment(loan.amount, loan.months, loan.rate);
    return Array.from({ length: loan.months }, (_, i) => {
      const interest = custom ? null : round(balance * loan.rate / 1200);
      const dueAmount = custom ? monthly : (i === loan.months - 1 ? round(balance + interest) : Math.min(monthly, round(balance + interest)));
      const principal = custom ? null : round(dueAmount - interest);
      if (!custom) balance = round(balance - principal);
      const receipt = loan.payments?.[i + 1];
      const paid = round(receipt?.amount || 0), remaining = round(Math.max(0, dueAmount - paid));
      const due = monthDate(loan.firstDue, i);
      const lateDays = Math.max(0, daysBetween(due, remaining > 0 ? asOf : (receipt?.date || due)));
      const status = remaining <= 0 ? (lateDays ? 'Paid late' : 'Paid') : due < asOf ? (paid > 0 ? 'Overdue (partial)' : 'Overdue') : paid > 0 ? 'Partial' : due === asOf ? 'Due today' : 'Upcoming';
      return { number: i + 1, due, dueAmount: round(dueAmount), interest, principal, balance: custom ? null : balance, paid, paidDate: receipt?.date || '', remaining, lateDays, status, delayed: lateDays > 0 };
    });
  }
  function validateLoan(loan) {
    if (!loan || typeof loan !== 'object' || Array.isArray(loan)) throw new Error('Invalid borrower record.');
    if (typeof loan.name !== 'string' || !loan.name.trim()) throw new Error('Enter the borrower’s name.');
    if (typeof loan.phone !== 'string' || !loan.phone.trim()) throw new Error('Enter a phone number with country code.');
    for (const field of ['address', 'referrer', 'family']) if (loan[field] != null && typeof loan[field] !== 'string') throw new Error('Contact details must be text.');
    if (!Object.hasOwn(currencies, loan.currency)) throw new Error('Choose a supported loan currency.');
    if (loan.payments == null || typeof loan.payments !== 'object' || Array.isArray(loan.payments)) throw new Error('Invalid payment records.');
    if (!Number.isFinite(loan.amount) || loan.amount < .01 || loan.amount > 1e12) throw new Error('Loan amount must be between 0.01 and 1 trillion.');
    if (Math.abs(loan.amount - round(loan.amount)) > 1e-7) throw new Error('Loan amount must have at most two decimal places.');
    if (!Number.isInteger(loan.months) || loan.months < 1 || loan.months > 600) throw new Error('Repayment term must be 1–600 whole months.');
    const mode = repaymentMode(loan);
    if (!['interest', 'custom'].includes(mode)) throw new Error('Choose a repayment method.');
    if (mode === 'interest' && (!Number.isFinite(loan.rate) || loan.rate < 0 || loan.rate > 100)) throw new Error('Annual interest must be between 0 and 100%.');
    if (mode === 'custom' && (!Number.isFinite(loan.payment) || loan.payment < .01 || loan.payment > 1e12 || Math.abs(loan.payment - round(loan.payment)) > 1e-7)) throw new Error('Enter a custom monthly payment between 0.01 and 1 trillion, with at most two decimal places.');
    if (mode === 'custom' && !Number.isSafeInteger(Math.round(loan.payment * 100) * loan.months)) throw new Error('The total scheduled repayment is too large to track safely to the cent.');
    if (!parseDate(loan.firstDue) || loan.firstDue < '1900-01-01' || loan.firstDue > '2100-12-31') throw new Error('Enter a valid first payment date between 1900 and 2100.');
    const rows = schedule(loan);
    for (const [key, receipt] of Object.entries(loan.payments || {})) {
      if (!/^[1-9]\d*$/.test(key)) throw new Error('Payment records must use valid installment numbers.');
      const row = rows[Number(key) - 1];
      if (!row || !receipt || !Number.isFinite(receipt.amount) || receipt.amount <= 0 || Math.abs(receipt.amount - round(receipt.amount)) > 1e-7 || receipt.amount > row.dueAmount + .001 || !parseDate(receipt.date) || receipt.date > today()) throw new Error('These terms conflict with recorded payments. Correct those payments first.');
    }
    return loan;
  }
  function migrate(items) {
    if (!Array.isArray(items)) throw new Error('Saved borrower data is not a list.');
    return items.map((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid borrower record in backup.');
      const numeric = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
      let firstDue = item.firstDue;
      if (!firstDue) {
        const date = new Date(item.due);
        firstDue = Number.isNaN(date.valueOf()) ? '' : iso(date);
      }
      const mode = item.repaymentMode || (item.rate == null ? 'custom' : 'interest');
      return validateLoan({ ...item, id: item.id ?? `legacy-${i}`, currency: item.currency ?? 'USD', amount: numeric(item.amount), months: item.months == null ? 12 : numeric(item.months), repaymentMode: mode, rate: mode === 'custom' ? null : numeric(item.rate), payment: mode === 'custom' ? numeric(item.payment) : null, firstDue, payments: item.payments ?? {}, documents: item.documents ?? [] });
    });
  }
  const headers = ['Borrower ID', 'Borrower', 'Phone', 'Address', 'Referrer', 'Family contact', 'Currency', 'Loan principal', 'Term (months)', 'Annual interest (%)', 'Installment', 'Due date', 'Scheduled payment', 'Principal portion', 'Interest portion', 'Received', 'Last received date', 'Remaining payment', 'Scheduled principal balance', 'Status', 'Days late', 'Report date', 'Repayment method'];
  function exportRows(loans, asOf = today()) {
    return loans.flatMap(loan => schedule(loan, asOf).map(row => [loan.id, loan.name, loan.phone, loan.address || '', loan.referrer || '', loan.family || '', loan.currency, loan.amount, loan.months, repaymentMode(loan) === 'custom' ? null : loan.rate, row.number, row.due, row.dueAmount, row.principal, row.interest, row.paid, row.paidDate, row.remaining, row.balance, row.status, row.lateDays, asOf, repaymentMode(loan) === 'custom' ? 'Custom monthly payment' : 'Interest-based']));
  }
  function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Neutralize spreadsheet formulas in user text, including country-code phone numbers.
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }
  const csv = (loans, asOf) => '\uFEFF' + [headers, ...exportRows(loans, asOf)].map(row => row.map(csvCell).join(',')).join('\r\n');
  const api = { currencies, round, iso, today, parseDate, monthDate, daysBetween, payment, repaymentMode, schedule, validateLoan, migrate, headers, exportRows, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LoanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
