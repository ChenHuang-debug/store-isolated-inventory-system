import Link from "next/link";
import { cookies } from "next/headers";
import { Boxes, ClipboardClock, LogOut, ShieldCheck, Store } from "lucide-react";
import { requireSession, resolveCurrentStore, withSessionContext } from "@/lib/auth/session";
import { logoutAction, switchStoreAction } from "./actions";

export const metadata = { title: "库存总览" };

export default async function OperationsPage() {
  const session = await requireSession();
  const cookieStore = await cookies();
  const currentStore = resolveCurrentStore(session, cookieStore.get("inventory_demo_current_store")?.value);
  const metrics = currentStore ? await withSessionContext(session, async (client) => {
    const result = await client.query<{ sku_count: string; available_qty: string; pending_qty: string }>(`
      select count(p.id)::text sku_count,
        coalesce(sum(b.available_qty), 0)::text available_qty,
        coalesce(sum(b.pending_qty), 0)::text pending_qty
      from public.products p
      left join public.inventory_balances b on b.store_id=p.store_id and b.product_id=p.id
      where p.store_id=$1 and p.is_active
    `, [currentStore.id]);
    return result.rows[0];
  }) : { sku_count: "0", available_qty: "0", pending_qty: "0" };

  return (
    <main className="min-h-screen bg-[#f5f4ef] text-[#17221f]">
      <header className="flex h-16 items-center justify-between border-b border-[#dfe3df] bg-[#11241f] px-7 text-white">
        <div className="flex items-center gap-3 text-lg font-bold"><span className="h-3 w-5 -skew-x-12 bg-[#46d1b1]" />多店库存管理系统</div>
        <div className="flex items-center gap-5 text-sm text-[#c8d4cf]">
          {session.isSystemAdmin ? <Link className="hover:text-white" href="/settings/users">用户权限</Link> : null}
          <span>{session.displayName} · {session.isSystemAdmin ? "系统管理员" : "成员"}</span>
          <form action={logoutAction}><button className="flex items-center gap-2 hover:text-white" type="submit"><LogOut size={16} />退出</button></form>
        </div>
      </header>
      <div className="mx-auto max-w-[1440px] px-7 py-8">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-[#d8ded9] pb-7">
          <div><p className="mb-2 text-sm font-bold tracking-[.12em] text-[#0f7f6d]">库存总览</p><h1 className="text-4xl font-semibold tracking-[-.04em]">{currentStore?.name ?? "暂无授权店铺"}</h1></div>
          <form action={switchStoreAction} className="flex items-center gap-3">
            <label htmlFor="storeId" className="text-sm font-semibold">当前店铺</label>
            <select id="storeId" name="storeId" defaultValue={currentStore?.id} className="h-11 min-w-44 rounded-md border border-[#ccd4cf] bg-white px-3" disabled={session.stores.length === 0}>
              {session.stores.map((store) => <option key={store.id} value={store.id}>{store.code} · {store.name}</option>)}
            </select>
            <button type="submit" className="h-11 rounded-md bg-[#0f7f6d] px-4 font-semibold text-white disabled:opacity-50" disabled={session.stores.length === 0}>切换</button>
          </form>
        </div>
        <section className="grid gap-px overflow-hidden rounded-lg border border-[#d8ded9] bg-[#d8ded9] md:grid-cols-3 mt-7">
          {[
            { label: "商品 SKU", value: metrics.sku_count, detail: "当前店铺启用商品", icon: Boxes },
            { label: "可用库存", value: metrics.available_qty, detail: "已完成实点入库", icon: ShieldCheck },
            { label: "待入库", value: metrics.pending_qty, detail: "已到仓尚未实点", icon: ClipboardClock },
          ].map((item) => <div key={item.label} className="bg-white p-6"><item.icon className="mb-8 text-[#0f7f6d]" /><p className="text-sm text-[#68736f]">{item.label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-xs text-[#87908c]">{item.detail}</p></div>)}
        </section>
        <section className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Link href="/catalog/products" className="border border-[#d8ded9] bg-white p-7 transition hover:border-[#0f7f6d]">
            <Boxes className="mb-6 text-[#0f7f6d]" />
            <h2 className="text-xl font-semibold">商品 SKU 与箱规</h2>
            <p className="mt-2 text-sm leading-7 text-[#68736f]">维护严格保留的商品 SKU、中文名、店铺款号与每箱件数。</p>
          </Link>
          <Link href="/suppliers" className="border border-[#d8ded9] bg-white p-7 transition hover:border-[#0f7f6d]">
            <Store className="mb-6 text-[#0f7f6d]" />
            <h2 className="text-xl font-semibold">供应商与货源地</h2>
            <p className="mt-2 text-sm leading-7 text-[#68736f]">按当前店铺维护供应商、货源地、联系人和启停状态。</p>
          </Link>
          <Link href="/inventory/arrivals" className="border border-[#d8ded9] bg-white p-7 transition hover:border-[#0f7f6d]">
            <ClipboardClock className="mb-6 text-[#0f7f6d]" />
            <h2 className="text-xl font-semibold">到仓待入</h2>
            <p className="mt-2 text-sm leading-7 text-[#68736f]">按照箱数与尾数登记已到仓货物，只增加待入库数量。</p>
          </Link>          <Link href="/inventory/workbench" className="border border-[#d8ded9] bg-white p-7 transition hover:border-[#0f7f6d]">
            <ShieldCheck className="mb-6 text-[#0f7f6d]" />
            <h2 className="text-xl font-semibold">库存操作台</h2>
            <p className="mt-2 text-sm leading-7 text-[#68736f]">实点入库、出库和异常纠错，全部原子入账并记录人员时间。</p>
          </Link>        </section>
      </div>
    </main>
  );
}
