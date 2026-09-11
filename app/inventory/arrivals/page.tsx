import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft, Clock3, Warehouse } from "lucide-react";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";
import { ArrivalForm } from "./form";

type Product={id:string;sku:string;name_zh:string;units_per_carton:number};
type Supplier={id:string;code:string;name:string};
type Pending={id:string;sku:string;name_zh:string;supplier_name:string;expected_qty:string;remaining_qty:string;expected_cartons:number;expected_loose_units:number;units_per_carton_snapshot:number;created_at:Date};
export const metadata={title:"到仓待入"};
export default async function ArrivalsPage(){
  const {session,store}=await requireCurrentStore();
  const data=await withSessionContext(session,async(client)=>{
    const products=await client.query<Product>("select id,sku,name_zh,units_per_carton from public.products where store_id=$1 and is_active and carton_spec_status='confirmed' order by sku",[store.id]);
    const suppliers=await client.query<Supplier>("select id,code,name from public.suppliers where store_id=$1 and is_active order by code",[store.id]);
    const pending=await client.query<Pending>(`select pr.id,p.sku,p.name_zh,s.name supplier_name,pr.expected_qty,pr.remaining_qty,pr.expected_cartons,pr.expected_loose_units,pr.units_per_carton_snapshot,pr.created_at from public.pending_receipts pr join public.products p on p.id=pr.product_id join public.suppliers s on s.id=pr.supplier_id where pr.store_id=$1 and pr.status in ('pending','partially_received') order by pr.created_at desc`,[store.id]);
    return {products:products.rows,suppliers:suppliers.rows,pending:pending.rows};
  });
  const allowed=can(store,"record_arrival"); const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date());
  return <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]"><div className="mx-auto max-w-[1440px]"><Link href="/operations" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16}/>返回总览</Link><div className="flex items-end justify-between border-b border-[#d8ded9] pb-6"><div><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">{store.code} · 仓库操作</p><h1 className="text-4xl font-semibold tracking-[-.04em]">到仓待入</h1></div><p className="text-sm text-[#68736f]">只增加待入库，不增加可用库存</p></div>
    {allowed?<section className="mt-7 border border-[#d8ded9] bg-white p-6"><h2 className="mb-2 flex items-center gap-2 text-xl font-semibold"><Warehouse className="text-[#0f7f6d]"/>登记到仓货物</h2><p className="mb-6 text-sm text-[#68736f]">按照实际箱数和尾数录入；系统根据已确认箱规计算总件数。</p>{data.products.length&&data.suppliers.length?<ArrivalForm products={data.products.map(p=>({id:p.id,sku:p.sku,name:p.name_zh,unitsPerCarton:p.units_per_carton}))} suppliers={data.suppliers} idempotencyKey={randomUUID()} today={today}/>:<p className="bg-[#fff3d9] p-4 text-sm text-[#805d09]">请先维护至少一个已确认箱规的商品和一个启用供应商。</p>}</section>:null}
    <section className="mt-7 overflow-hidden border border-[#d8ded9] bg-white"><div className="flex items-center gap-2 border-b border-[#d8ded9] px-6 py-5"><Clock3 className="text-[#0f7f6d]"/><h2 className="text-xl font-semibold">当前待入库</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[#f0f2ef] text-[#59645f]"><tr><th className="px-5 py-3">商品 SKU</th><th className="px-5 py-3">供应商</th><th className="px-5 py-3">到仓清点</th><th className="px-5 py-3">待入库</th><th className="px-5 py-3">登记时间</th></tr></thead><tbody>{data.pending.map(row=><tr key={row.id} className="border-t border-[#e5e8e5]"><td className="px-5 py-4"><strong className="block">{row.sku}</strong><span className="text-[#68736f]">{row.name_zh}</span></td><td className="px-5 py-4">{row.supplier_name}</td><td className="px-5 py-4">{row.expected_cartons} 箱 + {row.expected_loose_units} 件 <span className="text-[#7a8580]">({row.units_per_carton_snapshot}/箱)</span></td><td className="px-5 py-4 font-semibold tabular-nums">{row.remaining_qty} 件</td><td className="px-5 py-4 text-[#68736f]">{new Date(row.created_at).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</td></tr>)}</tbody></table>{data.pending.length===0?<p className="p-8 text-center text-sm text-[#7a8580]">暂无待入库货物</p>:null}</div></section>
  </div></main>;
}
