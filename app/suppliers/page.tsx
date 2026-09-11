import Link from "next/link";
import { ArrowLeft, Factory } from "lucide-react";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";
import { SupplierForm } from "./form";
import { setSupplierActiveAction } from "./actions";

type Supplier={id:string;code:string;name:string;origin:string;contact_name:string;contact_phone:string;notes:string;is_active:boolean};
export const metadata={title:"供应商"};
export default async function SuppliersPage(){
  const {session,store}=await requireCurrentStore();
  const suppliers=await withSessionContext(session,(client)=>client.query<Supplier>("select id,code,name,origin,contact_name,contact_phone,notes,is_active from public.suppliers where store_id=$1 order by is_active desc,code",[store.id]));
  const manageable=can(store,"manage_suppliers");
  return <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]"><div className="mx-auto max-w-[1280px]">
    <div className="mb-7 flex gap-5"><Link href="/operations" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16}/>返回总览</Link><Link href="/catalog/products" className="text-sm font-semibold text-[#0f7f6d]">商品 SKU</Link></div>
    <div className="flex items-end justify-between border-b border-[#d8ded9] pb-6"><div><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">{store.code} · 货源档案</p><h1 className="text-4xl font-semibold tracking-[-.04em]">供应商</h1></div><p className="text-sm text-[#68736f]">共 {suppliers.rowCount} 个供应商</p></div>
    {manageable?<section className="mt-7 border border-[#d8ded9] bg-white p-6"><h2 className="mb-5 flex items-center gap-2 text-xl font-semibold"><Factory className="text-[#0f7f6d]"/>新增供应商</h2><SupplierForm/></section>:null}
    <section className="mt-7 overflow-hidden border border-[#d8ded9] bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f0f2ef] text-[#59645f]"><tr><th className="px-5 py-3">代码</th><th className="px-5 py-3">供应商</th><th className="px-5 py-3">货源地</th><th className="px-5 py-3">联系人</th><th className="px-5 py-3">状态</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody>{suppliers.rows.map(s=><tr key={s.id} className="border-t border-[#e5e8e5]"><td className="px-5 py-4 font-semibold">{s.code}</td><td className="px-5 py-4"><strong className="block">{s.name}</strong>{s.notes?<span className="text-[#68736f]">{s.notes}</span>:null}</td><td className="px-5 py-4">{s.origin||"待补充"}</td><td className="px-5 py-4">{[s.contact_name,s.contact_phone].filter(Boolean).join(" · ")||"—"}</td><td className="px-5 py-4">{s.is_active?"启用":"已停用"}</td><td className="px-5 py-4 text-right">{manageable?<form action={setSupplierActiveAction}><input type="hidden" name="supplierId" value={s.id}/><input type="hidden" name="active" value={s.is_active?"false":"true"}/><button className="font-semibold text-[#0f7f6d]">{s.is_active?"停用":"启用"}</button></form>:"—"}</td></tr>)}</tbody></table></div></section>
  </div></main>;
}
