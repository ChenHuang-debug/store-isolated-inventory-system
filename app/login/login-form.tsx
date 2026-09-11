"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { loginAction, type LoginState } from "./actions";
import styles from "./login.module.css";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="email">工作邮箱</label>
        <input id="email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="mfaCode">验证器中的 6 位数字</label>
        <input
          id="mfaCode"
          name="mfaCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="公网启用后必填"
        />
      </div>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <button className={styles.submit} type="submit" disabled={pending}>
        {pending ? <LoaderCircle className={styles.spin} size={18} /> : <ArrowRight size={18} />}
        {pending ? "正在验证…" : "登录工作台"}
      </button>
      <p className={styles.help}>无公开注册入口。账号由管理员创建；公网环境必须使用双重验证。</p>
    </form>
  );
}
