"use client";

import { useActionState } from "react";
import { PackagePlus, Save } from "lucide-react";
import { saveProductAction, type ProductState } from "./actions";

const initialState: ProductState = {};
export type ProductFormValue = {
  id: string; sku: string; model: string; styleNumber: string; nameZh: string;
  color: string; size: string; unit: string; warningQty: string; unitsPerCarton: number | null;
  cartonSpecStatus: "pending" | "confirmed";
};

export function ProductForm({ value }: { value?: ProductFormValue }) {
  const [state, action, pending] = useActionState(saveProductAction, initialState);
  const field = "grid gap-2 text-sm font-semibold";
  const input = "h-11 rounded-md border border-[#ccd4cf] bg-white px-3 font-normal outline-none focus:border-[#0f7f6d]";
  return <form action={action} className="grid gap-5">
    {value ? <input type="hidden" name="productId" value={value.id} /> : null}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <label className={field}>商品 SKU<input className={input} name="sku" defaultValue={value?.sku} required /></label>
      <label className={field}>型号<input className={input} name="model" defaultValue={value?.model} required /></label>
      <label className={field}>店铺款号<input className={input} name="styleNumber" defaultValue={value?.styleNumber} /></label>
      <label className={field}>中文名<input className={input} name="nameZh" defaultValue={value?.nameZh} required /></label>
      <label className={field}>颜色<input className={input} name="color" defaultValue={value?.color} /></label>
      <label className={field}>尺码<input className={input} name="size" defaultValue={value?.size} /></label>
      <label className={field}>单位<input className={input} name="unit" defaultValue={value?.unit ?? "件"} required /></label>
      <label className={field}>预警库存<input className={input} name="warningQty" type="number" min="0" defaultValue={value?.warningQty ?? "0"} required /></label>
      <label className={field}>每箱件数 <span className="font-normal text-[#7a8580]">可填写临时值</span><input className={input} name="unitsPerCarton" type="number" min="1" defaultValue={value?.unitsPerCarton ?? ""} /></label>
      <label className={field}>箱规状态<select className={input} name="cartonSpecStatus" defaultValue={value?.cartonSpecStatus ?? "pending"}><option value="pending">待确认（禁止按箱业务）</option><option value="confirmed">已核对并确认</option></select></label>
    </div>
    <p className="border-l-2 border-[#d29a19] bg-[#fff3d9] p-3 text-sm text-[#805d09]">临时箱规不会自动变为已确认。只有逐 SKU 核对真实箱规后，才可明确选择“已核对并确认”。</p>
    {state.error ? <p role="alert" className="border-l-2 border-[#b94b35] bg-[#fbece7] p-3 text-sm text-[#8d3424]">{state.error}</p> : null}
    {state.success ? <p role="status" className="border-l-2 border-[#0f7f6d] bg-[#e7f4ef] p-3 text-sm text-[#0a6254]">{state.success}</p> : null}
    <button disabled={pending} className="flex h-11 w-fit items-center gap-2 rounded-md bg-[#0f7f6d] px-5 font-semibold text-white disabled:opacity-50">{value ? <Save size={17} /> : <PackagePlus size={17} />}{pending ? "保存中…" : value ? "保存修改" : "新增商品"}</button>
  </form>;
}
