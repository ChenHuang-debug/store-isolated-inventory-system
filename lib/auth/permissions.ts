export const permissionCatalog = [
  ["view_inventory", "查看库存"],
  ["manage_products", "管理商品 SKU"],
  ["manage_suppliers", "管理供应商"],
  ["record_arrival", "登记到仓待入"],
  ["confirm_receipt", "确认实点入库"],
  ["ship_inventory", "执行出库"],
  ["adjust_inventory", "库存纠错"],
  ["view_audit", "查看审计"],
  ["view_cross_store_dashboard", "查看跨店汇总"],
  ["import_initial_inventory", "导入期初库存"],
] as const;

export const knownPermissions = new Set<string>(permissionCatalog.map(([code]) => code));
