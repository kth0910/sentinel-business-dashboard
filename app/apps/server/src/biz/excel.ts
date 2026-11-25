// 업로드된 .xlsx의 첫 시트를 셀 값 2차원 배열로 읽는다.
import ExcelJS from 'exceljs';

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    return null;
  }
  return v;
}

export async function readFirstSheet(buf: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    out.push(values.slice(1).map(cellValue));
  });
  return out;
}
