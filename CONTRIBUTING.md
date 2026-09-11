# Contributing

感谢关注。本仓库主要用于作品展示，仍欢迎通过 Issue 提交可复现的问题描述。

提交 Pull Request 前请确保：

1. 不包含真实业务数据、凭据、域名或个人信息。
2. 数据库变更同时包含约束、RLS、授权、索引和测试。
3. 库存写入覆盖幂等、并发、负库存和整批回滚场景。
4. `npm run lint`、`npm run typecheck`、`npm test` 与 `npm run build` 全部通过。
5. 不通过删除测试或降低断言规避失败。

提交信息建议使用 Conventional Commits，例如 `fix(inventory): reject cross-store supplier references`。
