import Link from "next/link";
import { ArrowLeft, Box, PackageSearch } from "lucide-react";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";
import { formatCartonSpec } from "@/lib/catalog/carton-spec";
import { ProductForm } from "./product-form";
import { setProductActiveAction } from "./actions";

type Product = { id:string; sku:string; model:string; style_number:string; name_zh:string; color:string; size:string; unit:string; warning_qty:string; units_per_carton:number|null; carton_spec_status:"pending"|"confirmed"; is_active:boolean };

export const metadata = { title: "商品 SKU" };

export default async function ProductsPage() {
  const { session, store } = await requireCurrentStore();
  const products = await withSessionContext(session, (client) => client.query<Product>(`
    select id, sku, model, style_number, name_zh, color, size, unit,
      warning_qty, units_per_carton, carton_spec_status, is_active
    from public.products where store_id=$1 order by is_active desc, sku
  `, [store.id]));
  const manageable = can(store, "manage_products");
  return <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]"><div className="mx-auto max-w-[1440px]">
    <div className="mb-7 flex gap-5"><Link href="/operations" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16}/>返回总览</Link><Link href="/suppliers" className="text-sm font-semibold text-[#0f7f6d]">供应商管理</Link></div>
    <div className="flex items-end justify-between border-b border-[#d8ded9] pb-6"><div><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">{store.code} · 商品主数据</p><h1 className="text-4xl font-semibold tracking-[-.04em]">商品 SKU</h1></div><p className="text-sm text-[#68736f]">共 {products.rowCount} 个型号</p></div>
    {manageable ? <section className="mt-7 border border-[#d8ded9] bg-white p-6"><h2 className="mb-5 flex items-center gap-2 text-xl font-semibold"><Box className="text-[#0f7f6d]"/>新增商品</h2><ProductForm/></section> : null}
    <section className="mt-7 overflow-hidden border border-[#d8ded9] bg-white"><div className="flex items-center gap-2 border-b border-[#d8ded9] px-6 py-5"><PackageSearch className="text-[#0f7f6d]"/><h2 className="text-xl font-semibold">商品目录</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[#f0f2ef] text-[#59645f]"><tr><th className="px-5 py-3">商品 SKU</th><th className="px-5 py-3">中文名</th><th className="px-5 py-3">型号 / 款号</th><th className="px-5 py-3">颜色 / 尺码</th><th className="px-5 py-3">箱规</th><th className="px-5 py-3">状态</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody>{products.rows.map((p)=><tr key={p.id} className="border-t border-[#e5e8e5]"><td className="px-5 py-4 font-semibold">{p.sku}</td><td className="px-5 py-4">{p.name_zh}</td><td className="px-5 py-4">{p.model}{p.style_number?` / ${p.style_number}`:""}</td><td className="px-5 py-4">{[p.color,p.size].filter(Boolean).join(" / ")||"—"}</td><td className="px-5 py-4">{p.carton_spec_status==="confirmed"?formatCartonSpec(p.units_per_carton,p.carton_spec_status,p.unit):<span className="font-semibold text-[#9a6a00]">{formatCartonSpec(p.units_per_carton,p.carton_spec_status,p.unit)}</span>}</td><td className="px-5 py-4">{p.is_active?"启用":"已停用"}</td><td className="px-5 py-4 text-right">{manageable?<div className="flex justify-end gap-4"><Link className="font-semibold text-[#0f7f6d]" href={`/catalog/products/${p.id}/edit`}>编辑</Link><form action={setProductActiveAction}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="active" value={p.is_active?"false":"true"}/><button className="font-semibold text-[#0f7f6d]">{p.is_active?"停用":"启用"}</button></form></div>:"—"}</td></tr>)}</tbody></table></div></section>
  </div></main>;
}
