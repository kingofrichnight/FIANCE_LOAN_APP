(function (root) {
  'use strict';
  let loading;
  function loadExcel() {
    if (root.ExcelJS) return Promise.resolve(root.ExcelJS);
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/exceljs.min.js';
      script.onload = () => resolve(root.ExcelJS);
      script.onerror = () => { loading = null; script.remove(); reject(new Error('Excel export could not load. Please retry or export CSV.')); };
      document.head.append(script);
    });
    return loading;
  }
  async function workbook(loans, asOf, ExcelJS, core) {
    const book = new ExcelJS.Workbook();
    book.creator = 'Lendwise';
    const sheet = book.addWorksheet('Monthly payments', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
    sheet.columns = core.headers.map((header, i) => ({ header, width: [0, 3, 5].includes(i) ? 30 : i === 1 ? 24 : i === 19 ? 24 : 20 }));
    const data = core.exportRows(loans, asOf);
    for (const values of data) {
      const typed = [...values];
      for (const index of [11, 16, 21]) typed[index] = values[index] ? new Date(values[index] + 'T00:00:00Z') : null;
      const row = sheet.addRow(typed);
      row.height = 32;
      row.alignment = { vertical: 'middle', wrapText: true };
      for (const index of [8, 13, 14, 15, 16, 18, 19]) row.getCell(index).numFmt = '#,##0.00';
      for (const index of [12, 17, 22]) row.getCell(index).numFmt = 'yyyy-mm-dd';
      if (values[20] > 0) row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } };
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF9C1C20' } };
      });
    }
    const head = sheet.getRow(1);
    head.height = 44;
    head.eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF157347' } }; cell.alignment = { wrapText: true, vertical: 'middle' }; });
    sheet.autoFilter = { from: 'A1', to: { row: Math.max(1, sheet.rowCount), column: core.headers.length } };
    sheet.getCell('T1').note = `Status as of ${asOf}. Red rows are overdue or paid late. No automatic late fees. One received total and date per installment. Custom monthly plans use the entered amount every month; their rate and principal/interest splits are blank because no interest calculation is applied. Each row uses its own Currency column; no conversion.`;
    sheet.getCell('X1').note = 'Local history indicator, not a credit score or lending recommendation. Formula local-v1: only non-zero installments due before the report date count, equally weighted. Fully on time = 100; fully late = 50; overdue partial = 50 × received / scheduled, rounded to two decimals; overdue unpaid = 0. Average rounded down. Blank means no history. Uses one latest received date per installment; missing records and term edits affect the score.';
    return book;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { workbook };
  else root.LoanExport = { workbook, loadExcel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
