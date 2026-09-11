import "server-only";

import ExcelJS from "exceljs";

export const TEMPLATE_VERSION = "1.0";
export type TemplateBusiness = "arrival" | "outbound";
export type TemplateProduct = { sku: string; name: string; unitsPerCarton: number | null };

const palette = { dark: "11241F", brand: "0F7F6D", mint: "46D1B1", paper: "F5F4EF", line: "D8DED9", white: "FFFFFF", amber: "FFF3D9" };

export async function buildOperationTemplate(input: {
  business: TemplateBusiness; storeId: string; storeCode: string; products: TemplateProduct[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "多店库存管理系统";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet(input.business === "arrival" ? "到仓待入模板" : "出库模板", {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false }],
    properties: { defaultRowHeight: 22 },
  });
  const headers = input.business === "arrival"
    ? ["操作类型", "商品SKU", "中文名", "每箱件数", "箱数", "尾数", "总件数", "业务日期", "供应商代码", "备注"]
    : ["操作类型", "商品SKU", "中文名", "出库数量", "业务日期", "备注"];
  const end = String.fromCharCode(64 + headers.length);
  sheet.mergeCells(`A1:${end}1`);
  sheet.getCell("A1").value = `多店库存管理系统 · ${input.storeCode} · ${input.business === "arrival" ? "到仓待入" : "出库"}`;
  sheet.getCell("A1").style = { font: { name: "Microsoft YaHei", size: 18, bold: true, color: { argb: palette.white } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: palette.dark } }, alignment: { vertical: "middle", horizontal: "left" } };
  sheet.getRow(1).height = 38;
  sheet.mergeCells(`A2:${end}2`);
  sheet.getCell("A2").value = input.business === "arrival"
    ? "填写箱数和尾数；总件数自动计算。箱规或 SKU 不得自行修改，上传后系统还会再次校验。"
    : "填写正整数出库数量。上传后先预览校验，确认后才会整批扣减库存。";
  sheet.getCell("A2").style = { font: { name: "Microsoft YaHei", size: 10, color: { argb: "59645F" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: palette.paper } }, alignment: { vertical: "middle", wrapText: true } };
  sheet.getRow(2).height = 30;
  sheet.mergeCells(`A3:${end}3`);
  sheet.getCell("A3").value = "浅黄色列需要填写；请勿删除隐藏的“模板信息”工作表。";
  sheet.getCell("A3").style = { font: { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "805D09" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: palette.amber } } };
  sheet.getRow(4).height = 8;
  const headerRow = sheet.getRow(5);
  headerRow.values = headers;
  headerRow.height = 30;
  headerRow.eachCell((cell) => { cell.style = { font: { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: palette.white } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: palette.brand } }, alignment: { vertical: "middle", horizontal: "center" }, border: { bottom: { style: "medium", color: { argb: palette.mint } } } }; });

  input.products.forEach((product, index) => {
    const rowNumber = 6 + index;
    const row = sheet.getRow(rowNumber);
    row.font = { name: "Microsoft YaHei", size: 10 };
    if (input.business === "arrival") {
      row.values = ["到仓待入", product.sku, product.name, product.unitsPerCarton, null, null, null, null, null, null];
      row.getCell(7).value = { formula: `D${rowNumber}*E${rowNumber}+F${rowNumber}` };
      [5, 6, 8, 9, 10].forEach((column) => row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.amber } });
      row.getCell(5).dataValidation = { type: "whole", operator: "greaterThanOrEqual", formulae: [0], allowBlank: false, showErrorMessage: true, errorTitle: "箱数无效", error: "箱数必须是大于或等于 0 的整数。" };
      row.getCell(6).dataValidation = { type: "whole", operator: "between", formulae: [0, Math.max(0, (product.unitsPerCarton ?? 1) - 1)], allowBlank: false, showErrorMessage: true, errorTitle: "尾数无效", error: "尾数必须小于每箱件数。" };
    } else {
      row.values = ["出库", product.sku, product.name, null, null, null];
      [4, 5, 6].forEach((column) => row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.amber } });
      row.getCell(4).dataValidation = { type: "whole", operator: "greaterThan", formulae: [0], allowBlank: false, showErrorMessage: true, errorTitle: "数量无效", error: "出库数量必须是正整数。" };
    }
    row.getCell(input.business === "arrival" ? 8 : 5).numFmt = "yyyy-mm-dd";
    row.height = 25;
  });
  sheet.autoFilter = { from: "A5", to: `${end}${Math.max(6, 5 + input.products.length)}` };
  const widths = input.business === "arrival" ? [14, 24, 26, 12, 10, 10, 12, 14, 18, 30] : [12, 24, 26, 14, 14, 34];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getColumn(2).numFmt = "@";
  sheet.getColumn(input.business === "arrival" ? 9 : 2).numFmt = "@";

  const meta = workbook.addWorksheet("模板信息", { state: "veryHidden", views: [{ showGridLines: false }] });
  meta.getColumn(1).width = 24; meta.getColumn(2).width = 72;
  meta.addRows([
    ["模板版本", TEMPLATE_VERSION], ["店铺ID", input.storeId], ["店铺代码", input.storeCode],
    ["业务类型", input.business], ["生成时间", new Date().toISOString()],
    ["允许的商品SKU", input.products.map((item) => item.sku).join("|")],
  ]);
  await meta.protect("inventory_demo-template", { selectLockedCells: true, selectUnlockedCells: true });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function templateFilename(storeCode: string, business: TemplateBusiness) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("-", "");
  return `${storeCode}_${business === "arrival" ? "到仓待入模板" : "出库模板"}_${date}.xlsx`;
}
