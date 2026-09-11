import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "登录" };

export default async function LoginPage() {
  if (await getCurrentSession()) redirect("/operations");

  return (
    <main className="landing-shell">
      <section className="brand-panel">
        <div className="wordmark"><span aria-hidden="true" />多店库存</div>
        <div className="brand-copy">
          <p className="eyebrow">安全库存工作台</p>
          <h1>每一次入账，<br />都有据可查。</h1>
          <p className="brand-description">账号、角色与店铺范围在服务端和数据库双重校验。</p>
        </div>
        <p className="brand-footnote">企业内部系统 · 仅限授权员工</p>
      </section>
      <section className="entry-panel">
        <div className="entry-content">
          <p className="eyebrow">欢迎回来</p>
          <h2>登录库存工作台</h2>
          <p className="entry-description">使用管理员创建的邮箱和密码登录。</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
