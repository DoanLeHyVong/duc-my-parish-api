import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { ApiError } from "../../lib/api-error.js";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200;

export type ParsedWorkbook = {
  headers: string[];
  rows: Array<{ rowNumber: number; values: Map<string, string> }>;
};

async function inspectArchive(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, archive) => {
      if (openError || !archive) {
        reject(new ApiError(422, "INVALID_XLSX", "Không thể đọc cấu trúc file Excel."));
        return;
      }
      let entries = 0;
      let expandedBytes = 0;
      const fail = (error: ApiError) => {
        archive.close();
        reject(error);
      };
      archive.on("error", () => fail(new ApiError(422, "INVALID_XLSX", "Cấu trúc file Excel không hợp lệ.")));
      archive.on("entry", (entry) => {
        entries += 1;
        expandedBytes += entry.uncompressedSize;
        if ((entry.generalPurposeBitFlag & 1) !== 0) {
          fail(new ApiError(422, "ENCRYPTED_XLSX", "Không hỗ trợ file Excel được mã hóa."));
          return;
        }
        if (entries > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_EXPANDED_BYTES || expandedBytes > buffer.length * 100) {
          fail(new ApiError(413, "XLSX_EXPANSION_LIMIT", "File Excel có cấu trúc nén quá lớn."));
          return;
        }
        archive.readEntry();
      });
      archive.on("end", resolve);
      archive.readEntry();
    });
  });
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if ("text" in value && typeof value.text === "string") return value.text.trim();
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
  if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  return String(value).trim();
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  await inspectArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ApiError(422, "INVALID_XLSX", "Không thể đọc file Excel. Vui lòng chọn file .xlsx hợp lệ.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ApiError(422, "EMPTY_WORKBOOK", "File Excel không có worksheet.");

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  for (let index = 1; index <= headerRow.cellCount; index += 1) {
    const header = cellText(headerRow.getCell(index).value);
    if (!header) continue;
    if (headers.includes(header)) throw new ApiError(422, "DUPLICATE_HEADER", `Tên cột bị trùng: ${header}.`);
    headers.push(header);
  }
  if (headers.length === 0) throw new ApiError(422, "MISSING_HEADERS", "Dòng đầu tiên phải chứa tên cột.");

  const rows: ParsedWorkbook["rows"] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = new Map<string, string>();
    let hasValue = false;
    for (let column = 1; column <= headerRow.cellCount; column += 1) {
      const header = cellText(headerRow.getCell(column).value);
      if (!header) continue;
      const value = cellText(row.getCell(column).value);
      values.set(header, value);
      if (value) hasValue = true;
    }
    if (hasValue) rows.push({ rowNumber, values });
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ApiError(413, "IMPORT_ROW_LIMIT", `Mỗi file chỉ được tối đa ${MAX_IMPORT_ROWS} dòng dữ liệu.`);
    }
  }
  if (rows.length === 0) throw new ApiError(422, "EMPTY_IMPORT", "File Excel không có dòng học sinh nào.");
  return { headers, rows };
}

