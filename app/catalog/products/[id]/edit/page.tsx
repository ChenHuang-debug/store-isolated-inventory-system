import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withSessionContext } from "@/lib/auth/session";
import { requireCurrentStore, can } from "@/lib/stores/current-store";
import { ProductForm, type ProductFormValue } from "../../product-form";

type Row = { id:string;sku:string;model:string;style_number:string;name_zh:string;color:string;size:string;unit:string;warning_qty:string;units_per_carton:number|null;carton_spec_status:"pending"|"confirmed" };
export const metadata={title:"编辑商品 SKU"};
export default async function EditProductPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const {session,store}=await requireCurrentStore();
  if(!can(store,"manage_products")) redirect("/catalog/products");
  const result=await withSessionContext(session,(client)=>client.query<Row>("select id,sku,model,style_number,name_zh,color,size,unit,warning_qty,units_per_carton,carton_spec_status from public.products where id=$1 and store_id=$2",[id,store.id]));
  const row=result.rows[0]; if(!row) notFound();
  const value:ProductFormValue={id:row.id,sku:row.sku,model:row.model,styleNumber:row.style_number,nameZh:row.name_zh,color:row.color,size:row.size,unit:row.unit,warningQty:row.warning_qty,unitsPerCarton:row.units_per_carton,cartonSpecStatus:row.carton_spec_status};
  return <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]"><div className="mx-auto max-w-[1200px]"><Link href="/catalog/products" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16}/>返回商品目录</Link><div className="border-b border-[#d8ded9] pb-6"><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">{store.code} · {row.sku}</p><h1 className="text-4xl font-semibold tracking-[-.04em]">编辑商品与箱规</h1></div><section className="mt-7 border border-[#d8ded9] bg-white p-6"><ProductForm value={value}/></section></div></main>;
}
