import { ArrowRight, Boxes, ClipboardCheck, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <main className="landing-shell">
      <section className="brand-panel">
        <div className="wordmark"><span aria-hidden="true" />多店库存</div>
        <div className="brand-copy">
          <p className="eyebrow">多店铺库存运营系统</p>
          <h1>每一笔库存，<br />都有据可查。</h1>
          <p className="brand-description">
            到仓、清点、入库、出库与纠错形成完整流水，店铺数据严格隔离。
          </p>
        </div>
        <p className="brand-footnote">企业内部系统 · 仅限授权员工</p>
      </section>

      <section className="entry-panel">
        <div className="entry-content">
          <p className="eyebrow">工作空间已就绪</p>
          <h2>多店库存管理系统</h2>
          <p className="entry-description">
            使用公司分配的账号、密码与双重验证码安全登录。
          </p>

          <div className="capability-list" aria-label="系统能力">
            <div><Boxes /><span><strong>多店隔离</strong>STORE_A、STORE_B、STORE_C、STORE_D 各自独立</span></div>
            <div><ClipboardCheck /><span><strong>原子入账</strong>批次失败整批回滚</span></div>
            <div><ShieldCheck /><span><strong>全程审计</strong>时间、人员、原因均留痕</span></div>
          </div>

          <a className="primary-action" href="/login">
            进入登录 <ArrowRight size={18} aria-hidden="true" />
          </a>
          <p className="build-status"><span />HTTPS 安全访问</p>
        </div>
      </section>
    </main>
  );
}
