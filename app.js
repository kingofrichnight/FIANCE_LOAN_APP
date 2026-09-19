'use strict';
const C = LoanCore;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pageSize = 8;
let loans = [], page = 0, editingId = null, paymentLoanId = null, receiptNumber = null;
let documentsDraft = [], deletedLoan = null, toastTimer, appEpoch = 0;
let currency = 'USD', remindersEnabled = true;
const optionMarkup = Object.entries(C.currencies).map(([code, label]) => `<option value="${code}">${code} — ${label}</option>`).join('');
$('#currencySelect').innerHTML = optionMarkup;
$('#loanForm').elements.currency.innerHTML = optionMarkup;
function money(value, code = currency) {
  return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : navigator.language, { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function dateText(value) { const date = C.parseDate(value); return date ? date.toLocaleDateString(navigator.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; }
function showError(selector, text) { $(selector).hidden = !text; $(selector).textContent = text; }
function toast(message) { clearTimeout(toastTimer); $('#toastText').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500); }
function validateDocuments(documents) {
  if (!Array.isArray(documents) || documents.length > 10) throw new Error('Keep at most 10 documents per borrower.');
  for (const doc of documents) if (!doc || typeof doc.name !== 'string' || typeof doc.data !== 'string' || doc.data.length > 1500000 || !/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(doc.data)) throw new Error('A saved document is not a supported PDF or image.');
}
function validateCollection(items) {
  const result = C.migrate(items);
  const ids = new Set();
  for (const loan of result) {
    if (typeof loan.id !== 'string' || ids.has(loan.id)) throw new Error('Borrower IDs must be unique.');
    ids.add(loan.id); validateDocuments(loan.documents);
  }
  return result;
}
try {
  const preferred = localStorage.getItem('lendwiseCurrency');
  if (Object.hasOwn(C.currencies, preferred)) currency = preferred;
  remindersEnabled = localStorage.getItem('lendwiseReminders') !== 'off';
} catch { /* Profile screen explains disabled storage before use. */ }
$('#currencySelect').value = currency;
function requireSession(generation = appEpoch) {
  if (!LoanAccount.isUnlocked() || generation !== appEpoch) throw new Error('Your profile locked. Unlock it and retry your changes.');
}
async function persist(next, generation = appEpoch) {
  requireSession(generation);
  await LoanAccount.save(next);
  requireSession(generation); loans = next; showError('#storageError', '');
  render();
}
function chosenLoans() { return loans.filter(loan => loan.currency === currency); }
function rowsFor(loan) { return C.schedule(loan); }
function entries(items = chosenLoans()) { return items.flatMap(loan => rowsFor(loan).map(row => ({ loan, ...row }))); }
function sum(rows, field) { return C.round(rows.reduce((total, row) => total + row[field], 0)); }
function loanState(loan) {
  const rows = rowsFor(loan), remaining = sum(rows, 'remaining');
  return { rows, remaining, paid: sum(rows, 'paid'), next: rows.find(row => row.remaining > 0), status: !remaining ? 'Paid off' : rows.some(row => row.remaining > 0 && row.due < C.today()) ? 'Overdue' : 'Active' };
}
function statusBadge(status) { return `<span class="status ${status.includes('Overdue') || status === 'Paid late' ? 'overdue' : status.includes('Paid') ? 'ontime' : 'due'}">${esc(status)}</span>`; }
function actionButton(action, id, text, extra = '') { return `<button class="row-btn ${action === 'delete' ? 'danger-text' : ''}" data-action="${action}" data-id="${esc(id)}" ${extra}>${text}</button>`; }
function render() {
  const selected = chosenLoans(), all = entries(selected), today = C.today();
  const overdue = all.filter(row => row.remaining > 0 && row.due < today);
  const upcoming = all.filter(row => row.remaining > 0 && C.daysBetween(today, row.due) >= 0 && C.daysBetween(today, row.due) <= 7);
  $('#navCount').textContent = loans.length;
  $('#reminderCount').textContent = overdue.length + upcoming.length;
  $('#currentDate').textContent = new Date().toLocaleDateString(navigator.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  $('#currencyNote').textContent = `Showing ${currency} loans (${selected.length} of ${loans.length}). Each loan keeps its own currency.`;
  $('#totalOutstanding').textContent = money(sum(all, 'remaining'));
  $('#activeCount').textContent = `${selected.filter(loan => loanState(loan).remaining > 0).length} active loans · scheduled amounts`;
  $('#collectedTotal').textContent = money(sum(all.filter(row => row.paidDate.startsWith(today.slice(0, 7))), 'paid'));
  $('#upcomingTotal').textContent = money(sum(upcoming, 'remaining'));
  $('#upcomingCount').textContent = `${upcoming.length} installments`;
  $('#overdueTotal').textContent = money(sum(overdue, 'remaining'));
  $('#overdueCount').textContent = `${overdue.length} overdue installments`;
  $('#upcomingList').innerHTML = [...overdue, ...upcoming].sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4).map(row => `<div class="upcoming-row"><div><strong>${esc(row.loan.name)}</strong><small>${dateText(row.due)} · Month ${row.number}</small></div><div class="due-amount"><strong>${money(row.remaining)}</strong>${statusBadge(row.status)}</div>${actionButton('payments', row.loan.id, 'Payments')}</div>`).join('') || '<p class="empty">No payments needing attention.</p>';
  renderRows(); renderChart(all);
}
function renderRows() {
  const query = $('#searchInput').value.trim().toLocaleLowerCase();
  const filter = $('#statusFilter').value, sort = $('#sortSelect').value;
  let list = chosenLoans().filter(loan => `${loan.name} ${loan.phone}`.toLocaleLowerCase().includes(query));
  list = list.filter(loan => { const state = loanState(loan); return filter === 'all' || (filter === 'paid' ? !state.remaining : filter === 'overdue' ? state.status === 'Overdue' : state.remaining > 0); });
  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'amount') list.sort((a, b) => b.amount - a.amount);
  if (sort === 'due') list.sort((a, b) => (loanState(a).next?.due || '9999').localeCompare(loanState(b).next?.due || '9999'));
  page = Math.max(0, Math.min(page, Math.ceil(list.length / pageSize) - 1));
  $('#borrowerRows').innerHTML = list.slice(page * pageSize, (page + 1) * pageSize).map(loan => {
    const state = loanState(loan);
    return `<tr><td data-label="Borrower"><div class="person"><div><strong>${esc(loan.name)}</strong><small>${esc(loan.phone)}</small></div></div></td><td class="amount" data-label="Loan"><div><strong>${money(loan.amount)}</strong><small>${loan.months} months · ${loan.currency}</small></div></td><td data-label="Monthly payment">${money(state.rows[0].dueAmount)}</td><td data-label="Next due">${dateText(state.next?.due)}</td><td data-label="Received">${money(state.paid)}</td><td data-label="Status">${statusBadge(state.status)}</td><td data-label="Actions"><div class="row-actions">${actionButton('payments', loan.id, 'Payments')}${actionButton('edit', loan.id, 'Edit')}${actionButton('delete', loan.id, 'Delete')}</div></td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">${loans.length ? 'No borrowers match this currency, search, or filter.' : 'No borrowers yet. Add your first borrower to begin.'}</td></tr>`;
  $('#tableCount').textContent = list.length ? `Showing ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, list.length)} of ${list.length}` : 'Showing 0 borrowers';
  $('#prevPage').disabled = page === 0;
  $('#nextPage').disabled = (page + 1) * pageSize >= list.length;
}
function renderChart(all) {
  const count = Number($('#chartPeriod').value), now = new Date();
  const data = Array.from({ length: count }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - count + i + 1, 1, 12), prefix = C.iso(date).slice(0, 7);
    return { label: date.toLocaleDateString(navigator.language, { month: 'short' }), expected: sum(all.filter(row => row.due.startsWith(prefix)), 'dueAmount'), received: sum(all.filter(row => row.paidDate.startsWith(prefix)), 'paid') };
  });
  const maximum = Math.max(1, ...data.flatMap(item => [item.expected, item.received]));
  $('#chartAxis').innerHTML = [1, .5, 0].map(fraction => `<span>${esc(new Intl.NumberFormat(navigator.language, { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * fraction))}</span>`).join('');
  $('#chart').innerHTML = data.map(item => `<div class="bar-group" title="${esc(`${item.label}: scheduled ${money(item.expected)}, received ${money(item.received)}`)}"><i class="bar expected" style="height:${item.expected / maximum * 100}%"></i><i class="bar collected" style="height:${item.received / maximum * 100}%"></i><span class="bar-label">${esc(item.label)}</span></div>`).join('');
  $('#chart').setAttribute('aria-label', `${currency} collection chart. ` + data.map(item => `${item.label}: scheduled ${money(item.expected)}, received ${money(item.received)}`).join('. '));
  $('#chartEmpty').textContent = all.length ? `Values in ${currency}` : 'Add a loan to see its repayment schedule here.';
}
const form = $('#loanForm');
function formLoan() {
  const old = loans.find(loan => loan.id === editingId);
  const value = name => form.elements.namedItem(name).value;
  const repaymentMode = value('repaymentMode');
  const rate = repaymentMode === 'custom' ? null : Number(value('rate'));
  const payment = repaymentMode === 'custom' ? Number(value('payment')) : null;
  return { ...(old || {}), id: old?.id || crypto.randomUUID(), name: value('name').trim(), phone: value('phone').trim(), currency: value('currency'), amount: Number(value('amount')), months: Number(value('months')), repaymentMode, payment, rate, firstDue: value('firstDue'), address: value('address').trim(), referrer: value('referrer').trim(), family: value('family').trim(), payments: old?.payments || {}, documents: documentsDraft };
}
function previewPayment() {
  const custom = form.elements.repaymentMode.value === 'custom';
  $('#interestField').hidden = custom; form.elements.rate.disabled = custom; form.elements.rate.required = !custom;
  $('#customPaymentField').hidden = !custom; form.elements.payment.disabled = !custom; form.elements.payment.required = custom;
  const loan = formLoan();
  const value = custom ? loan.payment : C.payment(loan.amount, loan.months, loan.rate);
  $('#paymentPreview').textContent = Number.isFinite(value) && value >= 0 ? money(value, loan.currency) : '—';
  const validTerms = Number.isInteger(loan.months) && loan.months >= 1 && loan.months <= 600 && loan.amount > 0 && Number.isFinite(value) && value >= 0;
  const total = validTerms ? C.round(C.schedule(loan).reduce((sum, row) => sum + row.dueAmount, 0)) : null;
  $('#scheduleTotalPreview').textContent = total === null ? '—' : money(total, loan.currency);
  $('#repaymentHint').textContent = custom ? `Your entered amount is due every month for the selected term, including the final month. No interest rate is used.${total !== null ? ` Loan amount: ${money(loan.amount, loan.currency)}. The scheduled total is ${money(Math.abs(C.round(total - loan.amount)), loan.currency)} ${total >= loan.amount ? 'above' : 'below'} the loan amount.` : ''}` : 'Monthly reducing-balance calculation. The final installment may differ slightly because of rounding.';
}
function renderDraftDocuments() { $('#existingDocuments').innerHTML = documentsDraft.map((doc, i) => `<div class="document-row"><span>${esc(doc.name)}</span><button type="button" class="text-btn danger-text" data-remove-doc="${i}">Remove</button></div>`).join(''); }
function openLoan(id = null) {
  editingId = id; form.reset(); showError('#loanError', '');
  const loan = loans.find(item => item.id === id);
  $('#loanTitle').textContent = loan ? 'Edit borrower & loan' : 'Add a new borrower';
  $('#saveLoan').textContent = loan ? 'Save changes' : 'Save borrower & loan';
  $('#editTermsNote').hidden = !loan;
  $('#legacyNote').hidden = true;
  form.elements.repaymentMode.value = loan ? C.repaymentMode(loan) : 'interest';
  for (const name of ['name', 'phone', 'currency', 'amount', 'months', 'rate', 'payment', 'firstDue', 'address', 'referrer', 'family']) form.elements.namedItem(name).value = loan?.[name] ?? (name === 'currency' ? currency : name === 'rate' ? 0 : name === 'months' ? 12 : '');
  documentsDraft = structuredClone(loan?.documents || []); renderDraftDocuments(); previewPayment();
  $('#loanModal').showModal();
}
async function confirmAction(title, message, label = 'Confirm') {
  const dialog = $('#confirmModal'); $('#confirmTitle').textContent = title; $('#confirmText').textContent = message; $('#confirmAction').textContent = label; dialog.returnValue = '';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, data: reader.result }); reader.onerror = () => reject(new Error('Unable to read document.')); reader.readAsDataURL(file); }); }
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const generation = appEpoch;
  $('#saveLoan').disabled = true; showError('#loanError', '');
  try {
    const files = [...form.elements.documents.files];
    if (files.some(file => file.size > 1024 * 1024 || !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw new Error('Use PDF, PNG, JPEG or WebP files no larger than 1 MB each.');
    const loan = formLoan(), old = loans.find(item => item.id === editingId);
    loan.documents = [...documentsDraft, ...await Promise.all(files.map(readFile))];
    validateDocuments(loan.documents); C.validateLoan(loan);
    const changed = old && (C.repaymentMode(old) !== loan.repaymentMode || ['amount', 'months', 'firstDue', 'currency'].some(key => old[key] !== loan[key]) || (loan.repaymentMode === 'custom' ? old.payment !== loan.payment : old.rate !== loan.rate));
    if (changed && Object.keys(old.payments).length) {
      if (old.currency !== loan.currency) throw new Error('Clear recorded payments before changing the loan currency.');
      if (!await confirmAction('Rebuild repayment schedule?', 'Recorded payment totals stay with the same installment numbers. The due dates and scheduled amounts will use these new terms.', 'Rebuild & save')) return;
    }
    await persist(old ? loans.map(item => item.id === old.id ? loan : item) : [loan, ...loans], generation);
    if (currency !== loan.currency) setCurrency(loan.currency);
    $('#loanModal').close(); toast(old ? 'Borrower and loan updated.' : 'Borrower and loan saved.');
  } catch (error) { showError('#loanError', error.message); }
  finally { $('#saveLoan').disabled = false; }
});
function openPayments(id = null) {
  paymentLoanId = id; renderPayments();
  if (!$('#paymentsModal').open) $('#paymentsModal').showModal();
}
function renderPayments() {
  const items = paymentLoanId ? loans.filter(item => item.id === paymentLoanId) : chosenLoans();
  $('#paymentsTitle').textContent = paymentLoanId ? `${items[0]?.name || 'Borrower'} — repayments` : `${currency} monthly repayments`;
  $('#paymentsSubtitle').textContent = 'Record receipts to keep overdue balances accurate. Red marks overdue or paid-late installments.';
  $('#paymentRows').innerHTML = entries(items).map(row => `<tr class="${row.delayed ? 'delayed-row' : ''}"><td data-label="Installment"><div>${paymentLoanId ? '' : `<strong>${esc(row.loan.name)}</strong><br>`}Month ${row.number}</div></td><td data-label="Due date">${dateText(row.due)}</td><td data-label="Scheduled">${money(row.dueAmount, row.loan.currency)}</td><td data-label="Received"><div>${money(row.paid, row.loan.currency)}<small class="block">${row.paidDate ? dateText(row.paidDate) : ''}</small></div></td><td data-label="Remaining">${money(row.remaining, row.loan.currency)}</td><td data-label="Status"><div>${statusBadge(row.status)}${row.lateDays ? `<small class="block">${row.lateDays} days late</small>` : ''}</div></td><td data-label="Action">${actionButton('receipt', row.loan.id, row.paid ? 'Edit payment' : 'Record payment', `data-number="${row.number}"`)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No repayments for this currency yet.</td></tr>';
}
function openReceipt(id, number) {
  const loan = loans.find(item => item.id === id), row = rowsFor(loan)[number - 1];
  $('#receiptForm').dataset.loan = id; receiptNumber = number;
  $('#receiptTitle').textContent = row.paid ? 'Edit payment' : 'Record payment';
  $('#receiptSummary').textContent = `${loan.name} · Month ${number} · ${money(row.dueAmount, loan.currency)} due ${dateText(row.due)}`;
  const fields = $('#receiptForm').elements;
  fields.amount.value = row.paid || row.dueAmount; fields.amount.max = row.dueAmount;
  fields.date.value = row.paidDate || C.today(); fields.date.max = C.today();
  showError('#receiptError', ''); $('#receiptModal').showModal();
}
$('#receiptForm').addEventListener('submit', async event => {
  event.preventDefault(); const receiptForm = event.currentTarget;
  const generation = appEpoch;
  if (!receiptForm.reportValidity()) return;
  const submit = receiptForm.querySelector('[type=submit]'); submit.disabled = true;
  try {
    const loan = loans.find(item => item.id === receiptForm.dataset.loan), amount = C.round(Number(receiptForm.elements.amount.value)), date = receiptForm.elements.date.value;
    if (date > C.today()) throw new Error('A received payment cannot be dated in the future.');
    if (!amount && loan.payments[receiptNumber] && !await confirmAction('Clear recorded payment?', `Remove the received total for ${loan.name}, month ${receiptNumber}? The installment will become unpaid.`, 'Clear payment')) return;
    const updated = structuredClone(loan);
    if (amount) updated.payments[receiptNumber] = { amount, date }; else delete updated.payments[receiptNumber];
    C.validateLoan(updated); await persist(loans.map(item => item.id === loan.id ? updated : item), generation);
    renderPayments(); $('#receiptModal').close(); toast('Payment record saved.');
  } catch (error) { showError('#receiptError', error.message); }
  finally { submit.disabled = false; }
});
async function deleteLoan(id) {
  const generation = appEpoch;
  const loan = loans.find(item => item.id === id);
  if (!await confirmAction('Delete borrower & loan?', `Delete ${loan.name}, their loan, payment records and attached documents from this device? You can undo the last deletion in Settings until this page is reloaded.`, 'Delete borrower')) return;
  await persist(loans.filter(item => item.id !== id), generation); deletedLoan = loan; toast('Borrower deleted. Undo is available in Settings.');
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function downloadDocument(id, index) {
  const doc = loans.find(item => item.id === id).documents[index]; validateDocuments([doc]);
  const [prefix, content] = doc.data.split(','), bytes = Uint8Array.from(atob(content), ch => ch.charCodeAt(0));
  download(bytes, doc.name, prefix.slice(5, prefix.indexOf(';')));
}
function utility(kind) {
  const titles = { reminders: 'Payment reminders', documents: 'Borrower documents', reports: 'Export reports', settings: 'Settings & backup' };
  if (kind === 'repayments') { openPayments(); return; }
  $('#utilityTitle').textContent = titles[kind];
  const container = $('#utilityContent');
  if (kind === 'reports') container.innerHTML = '<p>Export all borrowers and every scheduled monthly installment, across all currencies.</p><p class="hint">Includes contact details, loan terms, due dates, received amounts and dates, balances, status and days late. CSV stores status text; Excel highlights overdue and paid-late rows in red. Status is a snapshot at export time.</p><p class="notice">CSV, Excel and downloaded documents are not password-protected. Anyone with those files can read them. Store and share them carefully.</p><div class="button-row"><button class="secondary" data-export="csv">Download detailed CSV</button><button class="primary" data-export="xlsx">Download Excel (.xlsx)</button></div>';
  if (kind === 'documents') container.innerHTML = loans.flatMap(loan => loan.documents.map((doc, i) => `<div class="document-row"><div><strong>${esc(loan.name)}</strong><small class="block">${esc(doc.name)}</small></div>${actionButton('document', loan.id, 'Download', `data-index="${i}"`)}</div>`)).join('') || '<p class="empty">No documents saved. Add them when creating or editing a borrower.</p>';
  if (kind === 'reminders') {
    const due = entries().filter(row => row.remaining > 0 && C.daysBetween(C.today(), row.due) <= 7).sort((a, b) => a.due.localeCompare(b.due));
    container.innerHTML = `<p>Overdue and upcoming ${currency} installments. These reminders appear inside the app.</p><label class="check-label"><input type="checkbox" id="remindersToggle" ${remindersEnabled ? 'checked' : ''}> Show a reminder when I open the app</label>` + (due.map(row => `<div class="document-row"><div><strong>${esc(row.loan.name)}</strong><small class="block">Month ${row.number} · ${dateText(row.due)} · ${money(row.remaining)}</small>${statusBadge(row.status)}</div>${actionButton('payments', row.loan.id, 'Payments')}</div>`).join('') || '<p class="empty">No payments need attention.</p>');
  }
  if (kind === 'settings') container.innerHTML = `<p>Your profile, loans and documents are encrypted in this browser on this device. There is no shared database, automatic backup, sync or email password reset. Your session locks after five minutes without activity and whenever this page reloads.</p><label class="setting-label">Portfolio currency<select id="settingsCurrency">${optionMarkup}</select></label><p class="hint">This filters totals and sets the default for new loans. Existing loan amounts keep their own currency.</p><div class="button-row"><button class="primary" id="backupBtn">Download encrypted backup</button><button class="secondary" id="changePasswordBtn">Change password</button>${deletedLoan ? '<button class="secondary" id="undoDelete">Undo last deletion</button>' : ''}</div><label class="setting-label">Restore a Lendwise JSON backup<input id="restoreInput" type="file" accept="application/json,.json"></label><p class="hint">Restoring replaces this profile’s portfolio after confirmation, keeping this profile’s name and password. Encrypted backups require their original password. Older unencrypted version 3 backups are also supported. To move the whole profile to a new device, use Restore on its login screen.</p><p class="notice">Keep your password and backups safe. Clearing site data or uninstalling the browser may delete your records. Encryption protects saved data while locked; it cannot protect an unlocked session from malicious scripts, extensions or someone using your device. CSV, Excel and document downloads are not encrypted.</p>`;
  if (kind === 'settings') $('#settingsCurrency').value = currency;
  if (!$('#utilityModal').open) $('#utilityModal').showModal();
}
async function exportReport(type, button) {
  const generation = appEpoch; requireSession(generation);
  if (!loans.length) { toast('Add a borrower before exporting.'); return; }
  const original = button.textContent; button.disabled = true; button.textContent = 'Preparing…';
  try {
    if (type === 'csv') download(C.csv(loans), `lendwise-payments-${C.today()}.csv`, 'text/csv;charset=utf-8');
    else { const ExcelJS = await LoanExport.loadExcel(); requireSession(generation); const book = await LoanExport.workbook(loans, C.today(), ExcelJS, C); const buffer = await book.xlsx.writeBuffer(); requireSession(generation); download(buffer, `lendwise-payments-${C.today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
    toast('Report downloaded.');
  } finally { button.disabled = false; button.textContent = original; }
}
function setCurrency(code) {
  if (!Object.hasOwn(C.currencies, code)) return;
  try { localStorage.setItem('lendwiseCurrency', code); } catch { toast('Currency selected, but this browser cannot remember it.'); }
  currency = code; $('#currencySelect').value = code; page = 0; render();
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
    if (button.dataset.open) { $('#sidebar').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); utility(button.dataset.open); }
    if (button.dataset.export) await exportReport(button.dataset.export, button);
    if (button.hasAttribute('data-remove-doc')) { documentsDraft.splice(Number(button.dataset.removeDoc), 1); renderDraftDocuments(); }
    const id = button.dataset.id;
    if (button.dataset.action === 'edit') openLoan(id);
    if (button.dataset.action === 'delete') await deleteLoan(id);
    if (button.dataset.action === 'payments') openPayments(id);
    if (button.dataset.action === 'receipt') openReceipt(id, Number(button.dataset.number));
    if (button.dataset.action === 'document') downloadDocument(id, Number(button.dataset.index));
    if (button.id === 'backupBtn') {
      download(LoanAccount.backup(), `lendwise-encrypted-backup-${C.today()}.json`, 'application/json'); toast('Encrypted backup downloaded. Keep its password safe.');
    }
    if (button.id === 'changePasswordBtn') await LoanAccount.changePassword();
    if (button.id === 'undoDelete' && deletedLoan) { await persist([deletedLoan, ...loans]); deletedLoan = null; utility('settings'); toast('Last deleted borrower restored.'); }
  } catch (error) { toast(error.message); }
});
document.addEventListener('change', async event => {
  const input = event.target;
  try {
    if (input.id === 'settingsCurrency') setCurrency(input.value);
    if (input.id === 'remindersToggle') { localStorage.setItem('lendwiseReminders', input.checked ? 'on' : 'off'); remindersEnabled = input.checked; }
    if (input.id === 'restoreInput' && input.files[0]) {
      const generation = appEpoch;
      if (input.files[0].size > 20 * 1024 * 1024) throw new Error('Backup is too large (maximum 20 MB).');
      const data = await LoanAccount.decodeBackup(JSON.parse(await input.files[0].text()));
      if (!data) { input.value = ''; return; }
      requireSession(generation);
      if (data.version !== 3 || !Array.isArray(data.loans)) throw new Error('Choose a valid Lendwise version 3 backup.');
      const restored = validateCollection(data.loans);
      if (await confirmAction('Replace this portfolio?', `Replace ${loans.length} current borrowers with ${restored.length} borrowers from this backup, including payment records and documents?`, 'Restore backup')) { await persist(restored, generation); deletedLoan = null; utility('settings'); toast('Backup restored.'); }
      input.value = '';
    }
  } catch (error) { input.value = ''; toast(error.message); }
});
['newLoanTop', 'newLoanHero', 'addBorrower'].forEach(id => $('#' + id).addEventListener('click', () => openLoan()));
$('#menuBtn').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(open)); };
document.querySelectorAll('.sidebar a').forEach(link => link.onclick = () => { $('#sidebar').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false'); });
$('#notificationsBtn').onclick = () => utility('reminders'); $('#exportBtn').onclick = () => utility('reports');
$('#currencySelect').onchange = event => setCurrency(event.target.value);
$('#searchInput').oninput = () => { page = 0; renderRows(); };
$('#statusFilter').onchange = $('#sortSelect').onchange = () => { page = 0; renderRows(); };
$('#prevPage').onclick = () => { page--; renderRows(); }; $('#nextPage').onclick = () => { page++; renderRows(); };
$('#chartPeriod').onchange = () => renderChart(entries()); form.addEventListener('input', previewPayment); form.elements.repaymentMode.addEventListener('change', previewPayment);
window.addEventListener('focus', () => { if (LoanAccount.isUnlocked()) { render(); if ($('#paymentsModal').open) renderPayments(); } });
LoanAccount.start({
  validate: validateCollection, confirm: confirmAction, download, notice: toast,
  unlock: items => {
    appEpoch++; loans = items; page = 0; render();
    if (remindersEnabled && entries().some(row => row.remaining > 0 && C.daysBetween(C.today(), row.due) <= 7)) toast('Payments need attention. Open Reminders to view them.');
  },
  lock: () => {
    appEpoch++; loans = []; documentsDraft = []; deletedLoan = null; editingId = paymentLoanId = receiptNumber = null;
    form.reset(); $('#receiptForm').reset(); $('#searchInput').value = ''; $('#profileLabel').textContent = '';
    for (const id of ['paymentRows', 'paymentsTitle', 'receiptSummary', 'utilityContent', 'existingDocuments', 'confirmText', 'toastText', 'paymentPreview', 'scheduleTotalPreview', 'repaymentHint', 'loanError', 'receiptError']) $('#' + id).textContent = '';
    $('#toast').classList.remove('show'); clearTimeout(toastTimer); render();
  }
});
