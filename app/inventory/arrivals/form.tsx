"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2, Warehouse } from "lucide-react";
import { postArrivalAction, type ArrivalState } from "./actions";

type Product={id:string;sku:string;name:string;unitsPerCarton:number};
type Supplier={id:string;code:string;name:string};
type Row={key:string;productId:string;cartons:number;loose:number};
const initial:ArrivalState={};

export function ArrivalForm({products,suppliers,idempotencyKey,today}:{products:Product[];suppliers:Supplier[];idempotencyKey:string;today:string}){
  const [state,action,pending]=useActionState(postArrivalAction,initial);
  const [rows,setRows]=useState<Row[]>([{key:"row-1",productId:products[0]?.id??"",cartons:0,loose:0}]);
  const productMap=useMemo(()=>new Map(products.map(p=>[p.id,p])),[products]);
  const items=rows.map(({productId,cartons,loose})=>({productId,cartons:Number(cartons)||0,loose:Number(loose)||0}));
  const total=items.reduce((sum,item)=>sum+(productMap.get(item.productId)?.unitsPerCarton??0)*item.cartons+item.loose,0);
  const patch=(key:string,value:Partial<Row>)=>setRows(current=>current.map(row=>row.key===key?{...row,...value}:row));
  return <form action={action} className="grid gap-6">
    <input type="hidden" name="idempotencyKey" value={idempotencyKey}/><input type="hidden" name="itemsJson" value={JSON.stringify(items)}/>
    <div className="grid gap-4 md:grid-cols-3"><label className="grid gap-2 text-sm font-semibold">供应商<select name="supplierId" required className="h-11 rounded-md border border-[#ccd4cf] bg-white px-3 font-normal"><option value="">请选择供应商</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label><label className="grid gap-2 text-sm font-semibold">业务日期<input name="businessDate" type="date" defaultValue={today} required className="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal"/></label><label className="grid gap-2 text-sm font-semibold">备注<input name="note" maxLength={1000} className="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal"/></label></div>
    <div className="border border-[#d8ded9]"><div className="grid grid-cols-[minmax(250px,1fr)_130px_130px_90px] gap-3 bg-[#f0f2ef] px-4 py-3 text-sm font-semibold"><span>商品 SKU</span><span>箱数</span><span>尾数</span><span></span></div>{rows.map((row,index)=>{const product=productMap.get(row.productId);const rowTotal=(product?.unitsPerCarton??0)*row.cartons+row.loose;return <div key={row.key} className="grid grid-cols-[minmax(250px,1fr)_130px_130px_90px] items-center gap-3 border-t border-[#e3e7e4] px-4 py-3"><select aria-label={`第 ${index+1} 行商品`} value={row.productId} onChange={e=>patch(row.key,{productId:e.target.value})} className="h-10 rounded border border-[#ccd4cf] bg-white px-2"><option value="">请选择商品</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} · {p.name} · {p.unitsPerCarton}/箱</option>)}</select><input aria-label={`第 ${index+1} 行箱数`} type="number" min="0" value={row.cartons} onChange={e=>patch(row.key,{cartons:Number(e.target.value)})} className="h-10 rounded border border-[#ccd4cf] px-2"/><input aria-label={`第 ${index+1} 行尾数`} type="number" min="0" max={(product?.unitsPerCarton??1)-1} value={row.loose} onChange={e=>patch(row.key,{loose:Number(e.target.value)})} className="h-10 rounded border border-[#ccd4cf] px-2"/><div className="flex items-center justify-between"><span className="text-sm tabular-nums">{rowTotal} 件</span><button type="button" aria-label={`删除第 ${index+1} 行`} onClick={()=>setRows(current=>current.filter(item=>item.key!==row.key))} disabled={rows.length===1} className="text-[#a23f2d] disabled:opacity-30"><Trash2 size={16}/></button></div></div>})}</div>
    <div className="flex flex-wrap items-center justify-between gap-4"><button type="button" onClick={()=>setRows(current=>[...current,{key:crypto.randomUUID(),productId:products[0]?.id??"",cartons:0,loose:0}])} className="flex h-10 items-center gap-2 rounded border border-[#0f7f6d] px-4 text-sm font-semibold text-[#0f7f6d]"><Plus size={16}/>增加商品</button><p className="text-lg font-semibold">合计 <span className="tabular-nums text-[#0f7f6d]">{total}</span> 件</p></div>
    {state.error?<p role="alert" className="border-l-2 border-[#b94b35] bg-[#fbece7] p-3 text-sm text-[#8d3424]">{state.error}</p>:null}{state.success?<p role="status" className="border-l-2 border-[#0f7f6d] bg-[#e7f4ef] p-3 text-sm text-[#0a6254]">{state.success} 批次：{state.batchId}</p>:null}
    <button disabled={pending||products.length===0||suppliers.length===0||total<=0} className="flex h-12 w-fit items-center gap-2 rounded-md bg-[#0f7f6d] px-6 font-semibold text-white disabled:opacity-50"><Warehouse size={18}/>{pending?"原子入账中…":"确认到仓待入"}</button>
  </form>;
}
