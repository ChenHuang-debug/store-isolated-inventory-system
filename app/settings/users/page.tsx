import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { CreateUserForm } from "./create-user-form";
import { setUserStatusAction } from "./actions";

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  status: "invited" | "active" | "disabled";
  is_system_admin: boolean;
  last_login_at: Date | null;
  created_at: Date;
  store_access: Array<{ storeId: string; storeCode: string; storeName: string; role: string; permissions: string[] }>;
};

export const metadata = { title: "用户与权限" };

export default async function UsersPage() {
  const session = await requireSession();
  if (!session.isSystemAdmin) redirect("/operations");
  const users = await db.query<UserRow>("select * from public.admin_list_users($1)", [session.tokenHash]);

  return (
    <main className="min-h-screen bg-[#f5f4ef] px-6 py-8 text-[#17221f]">
      <div className="mx-auto max-w-[1280px]">
        <Link href="/operations" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#0f7f6d]"><ArrowLeft size={16} />返回库存总览</Link>
        <div className="flex items-end justify-between border-b border-[#d8ded9] pb-6"><div><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">系统设置</p><h1 className="text-4xl font-semibold tracking-[-.04em]">用户与权限</h1></div><div className="flex items-center gap-2 text-sm text-[#68736f]"><ShieldCheck size={18} />所有变更均写入审计</div></div>
        <section className="mt-7 border border-[#d8ded9] bg-white p-6"><h2 className="mb-5 flex items-center gap-2 text-xl font-semibold"><Users className="text-[#0f7f6d]" />创建受邀成员</h2><CreateUserForm stores={session.stores} /></section>
        <section className="mt-7 overflow-hidden border border-[#d8ded9] bg-white">
          <div className="border-b border-[#d8ded9] px-6 py-5"><h2 className="text-xl font-semibold">现有成员</h2><p className="mt-1 text-sm text-[#68736f]">停用账号会立即撤销其全部会话。</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead className="bg-[#f0f2ef] text-[#59645f]"><tr><th className="px-5 py-3">成员</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">店铺范围</th><th className="px-5 py-3">最近登录</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody>
            {users.rows.map((user) => <tr key={user.id} className="border-t border-[#e5e8e5]"><td className="px-5 py-4"><strong className="block">{user.display_name}{user.is_system_admin ? " · 管理员" : ""}</strong><span className="text-[#68736f]">{user.email}</span></td><td className="px-5 py-4"><span className={user.status === "active" ? "text-[#0f7f6d]" : "text-[#a23f2d]"}>{user.status === "active" ? "正常" : user.status === "disabled" ? "已停用" : "待激活"}</span></td><td className="px-5 py-4">{user.is_system_admin ? "全部店铺" : user.store_access.map((access) => access.storeCode).join("、") || "无"}</td><td className="px-5 py-4 text-[#68736f]">{user.last_login_at ? new Date(user.last_login_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未登录"}</td><td className="px-5 py-4 text-right">{user.id === session.userId ? <span className="text-[#89928e]">当前账号</span> : <form action={setUserStatusAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="status" value={user.status === "active" ? "disabled" : "active"} /><button className="font-semibold text-[#0f7f6d]" type="submit">{user.status === "active" ? "停用" : "启用"}</button></form>}</td></tr>)}
          </tbody></table></div>
        </section>
      </div>
    </main>
  );
}
