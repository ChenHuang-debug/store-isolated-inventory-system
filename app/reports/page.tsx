import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";

type StoreRow = { code: string; name: string; sku_count: string; available_qty: string; pending_qty: string };
type SupplierRow = { code: string; name: string; arrival_qty: string; receipt_qty: string };
type ReasonRow = { reason_code: string; reason_label: string; occurrences: string; absolute_qty: string };
export const metadata = { title: "库存统计看板" };

export default async function Reports() {
  const { session, store } = await requireCurrentStore();
  const data = await withSessionContext(session, async (client) => {
    const suppliers = await client.query<SupplierRow>(`
      select s.code, s.name,
        coalesce((select sum(i.quantity) from public.operation_batches b join public.operation_batch_items i on i.batch_id=b.id where b.supplier_id=s.id and b.operation_type='arrival' and b.status='posted'), 0)::text arrival_qty,
        coalesce((select sum(l.delta_available) from public.inventory_ledger l join public.pending_receipts pr on pr.id=l.pending_receipt_id where pr.supplier_id=s.id and l.business_type='receipt'), 0)::text receipt_qty
      from public.suppliers s
      where s.store_id=$1
      order by coalesce((select sum(i.quantity) from public.operation_batches b join public.operation_batch_items i on i.batch_id=b.id where b.supplier_id=s.id and b.operation_type='arrival' and b.status='posted'), 0) desc, s.code
    `, [store.id]);
    const reasons = await client.query<ReasonRow>(`
      select coalesce(l.reason_code, 'none') reason_code, coalesce(l.reason_label, '无差异') reason_label,
        count(*)::text occurrences,
        coalesce(sum(case when l.business_type='receipt' then abs(l.before_pending-l.delta_available) when l.business_type='adjustment' then abs(l.delta_available) else abs(l.delta_available)+abs(l.delta_pending) end), 0)::text absolute_qty
      from public.inventory_ledger l
      where l.store_id=$1 and l.reason_code is not null
      group by l.reason_code, l.reason_label
      order by coalesce(sum(case when l.business_type='receipt' then abs(l.before_pending-l.delta_available) when l.business_type='adjustment' then abs(l.delta_available) else abs(l.delta_available)+abs(l.delta_pending) end), 0) desc
    `, [store.id]);
    let stores: { rows: StoreRow[] } = { rows: [] };
    if (session.isSystemAdmin || can(store, "view_cross_store_dashboard")) {
      stores = await client.query<StoreRow>(`select s.code,s.name,count(p.id)::text sku_count,coalesce(sum(b.available_qty),0)::text available_qty,coalesce(sum(b.pending_qty),0)::text pending_qty from public.stores s left join public.products p on p.store_id=s.id and p.is_active left join public.inventory_balances b on b.store_id=s.id and b.product_id=p.id where s.is_active and public.app_has_store_access(s.id) group by s.id order by s.code`);
    }
    return { suppliers: suppliers.rows, reasons: reasons.rows, stores: stores.rows };
  });
  return <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]"><div className="mx-auto max-w-[1440px]">
    <Link href="/operations" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16}/>返回总览</Link>
    <div className="border-b border-[#d8ded9] pb-6"><p className="mb-2 flex items-center gap-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]"><BarChart3 size={16}/>{store.code} · 数据分析</p><h1 className="text-4xl font-semibold tracking-[-.04em]">库存统计看板</h1><p className="mt-3 text-sm text-[#68736f]">跨店区域只展示汇总，不展示其他店铺 SKU 或流水明细。</p></div>
    {data.stores.length?<section className="mt-7"><h2 className="mb-4 text-xl font-semibold">各店铺汇总</h2><div className="grid gap-px overflow-hidden border border-[#d8ded9] bg-[#d8ded9] md:grid-cols-2 lg:grid-cols-4">{data.stores.map(row=><div key={row.code} className="bg-white p-5"><p className="text-sm font-bold text-[#0f7f6d]">{row.code} · {row.name}</p><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><span>SKU<strong className="mt-1 block text-xl tabular-nums">{row.sku_count}</strong></span><span>可用<strong className="mt-1 block text-xl tabular-nums">{row.available_qty}</strong></span><span>待入<strong className="mt-1 block text-xl tabular-nums">{row.pending_qty}</strong></span></div></div>)}</div></section>:null}
    <div className="mt-7 grid gap-7 lg:grid-cols-2"><section className="overflow-hidden border border-[#d8ded9] bg-white"><h2 className="border-b border-[#d8ded9] p-5 text-xl font-semibold">供应商货物统计</h2><table className="w-full text-left text-sm"><thead className="bg-[#f0f2ef]"><tr><th className="p-3">供应商</th><th className="p-3">到仓件数</th><th className="p-3">确认入库件数</th></tr></thead><tbody>{data.suppliers.map(row=><tr key={row.code} className="border-t border-[#e5e8e5]"><td className="p-3"><strong>{row.code}</strong><span className="ml-2 text-[#68736f]">{row.name}</span></td><td className="p-3 tabular-nums">{row.arrival_qty}</td><td className="p-3 tabular-nums">{row.receipt_qty}</td></tr>)}</tbody></table>{!data.suppliers.length?<p className="p-6 text-sm text-[#68736f]">暂无供应商数据。</p>:null}</section>
    <section className="overflow-hidden border border-[#d8ded9] bg-white"><h2 className="border-b border-[#d8ded9] p-5 text-xl font-semibold">差异原因统计</h2><table className="w-full text-left text-sm"><thead className="bg-[#f0f2ef]"><tr><th className="p-3">差异原因</th><th className="p-3">发生次数</th><th className="p-3">影响件数</th></tr></thead><tbody>{data.reasons.map(row=><tr key={row.reason_code} className="border-t border-[#e5e8e5]"><td className="p-3">{row.reason_label}</td><td className="p-3 tabular-nums">{row.occurrences}</td><td className="p-3 tabular-nums">{row.absolute_qty}</td></tr>)}</tbody></table>{!data.reasons.length?<p className="p-6 text-sm text-[#68736f]">暂无差异记录。</p>:null}</section></div>
  </div></main>;
}
