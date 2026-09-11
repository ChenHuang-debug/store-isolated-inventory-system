"use client";

import { useActionState } from "react";
import { Factory } from "lucide-react";
import { saveSupplierAction, type SupplierState } from "./actions";

const initial: SupplierState = {};
export function SupplierForm() {
  const [state, action, pending] = useActionState(saveSupplierAction, initial);
  const field="grid gap-2 text-sm font-semibold";
  const input="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal outline-none focus:border-[#0f7f6d]";
  return <form action={action} className="grid gap-5"><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    <label className={field}>供应商代码<input className={input} name="code" required/></label>
    <label className={field}>供应商名称<input className={input} name="name" required/></label>
    <label className={field}>货源地<input className={input} name="origin" placeholder="省 / 市 / 国家或地区"/></label>
    <label className={field}>联系人<input className={input} name="contactName"/></label>
    <label className={field}>联系电话<input className={input} name="contactPhone"/></label>
    <label className={field}>备注<input className={input} name="notes"/></label>
  </div>{state.error?<p role="alert" className="border-l-2 border-[#b94b35] bg-[#fbece7] p-3 text-sm text-[#8d3424]">{state.error}</p>:null}{state.success?<p role="status" className="border-l-2 border-[#0f7f6d] bg-[#e7f4ef] p-3 text-sm text-[#0a6254]">{state.success}</p>:null}<button disabled={pending} className="flex h-11 w-fit items-center gap-2 rounded-md bg-[#0f7f6d] px-5 font-semibold text-white disabled:opacity-50"><Factory size={17}/>{pending?"保存中…":"新增供应商"}</button></form>;
}
