"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, UserPlus } from "lucide-react";
import { createUserAction, type UserActionState } from "./actions";
import { permissionCatalog } from "@/lib/auth/permissions";

const initialState: UserActionState = {};

export function CreateUserForm({ stores }: { stores: Array<{ id: string; code: string; name: string }> }) {
  const [state, action, pending] = useActionState(createUserAction, initialState);
  const [role, setRole] = useState("operator");
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">姓名<input className="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal" name="displayName" required maxLength={80} /></label>
        <label className="grid gap-2 text-sm font-semibold">工作邮箱<input className="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal" name="email" type="email" required /></label>
        <label className="grid gap-2 text-sm font-semibold">初始密码<input className="h-11 rounded-md border border-[#ccd4cf] px-3 font-normal" name="password" type="password" minLength={12} required /></label>
        <label className="grid gap-2 text-sm font-semibold">首个店铺<select className="h-11 rounded-md border border-[#ccd4cf] bg-white px-3 font-normal" name="storeId" required>{stores.map((store) => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}</select></label>
        <label className="grid gap-2 text-sm font-semibold">成员类型<select className="h-11 rounded-md border border-[#ccd4cf] bg-white px-3 font-normal" name="role" value={role} onChange={(event) => setRole(event.target.value)}><option value="operator">操作员</option><option value="viewer">只读用户</option></select></label>
      </div>
      <fieldset className="border-t border-[#e1e5e2] pt-5" disabled={role === "viewer"}>
        <legend className="mb-3 text-sm font-semibold">操作权限 <span className="font-normal text-[#7a8580]">（查看库存默认授予）</span></legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {permissionCatalog.filter(([code]) => code !== "view_inventory").map(([code, label]) => <label key={code} className="flex items-center gap-2 text-sm"><input type="checkbox" name="permissions" value={code} />{label}</label>)}
        </div>
        {role === "viewer" ? <p className="mt-3 text-xs text-[#7a8580]">只读用户只获得查看库存权限。</p> : null}
      </fieldset>
      {state.error ? <p role="alert" className="border-l-2 border-[#b94b35] bg-[#fbece7] p-3 text-sm text-[#8d3424]">{state.error}</p> : null}
      {state.success ? <p role="status" className="border-l-2 border-[#0f7f6d] bg-[#e7f4ef] p-3 text-sm text-[#0a6254]">{state.success}</p> : null}
      <button type="submit" disabled={pending || stores.length === 0} className="flex h-11 w-fit items-center gap-2 rounded-md bg-[#0f7f6d] px-5 font-semibold text-white disabled:opacity-50">{pending ? <LoaderCircle className="animate-spin" size={17} /> : <UserPlus size={17} />}{pending ? "创建中…" : "创建用户"}</button>
    </form>
  );
}
