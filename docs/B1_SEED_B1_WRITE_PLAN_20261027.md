# B1 云端写入执行计划（只读审阅稿）

> 状态：**待批准**。本文只是计划，不构成授权；文中出现的"预期响应"都没有实际执行。
> 生成时间：2026-10-27 · 依据：`seed_b1` 的 `plan` 实测结果（14 条 `would-create`、0 冲突）

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 动作 | 调用云函数 `seed_b1` 一次，`action: "write"` |
| 批次 | `pilot_c02_batch1_20261022` |
| 写入条数 | **14**（1 店铺 + 1 档口 + 12 菜品） |
| 依赖的已实测事实 | 管理员鉴权通过（`review.session` 返回 `role: admin`）；`plan` 返回 14 条 `would-create`、0 `conflict` |
| 仍需先决 | ①`seed_b1` 超时 3 s 是否先调大；②是否接受这 14 条写入后对客户端可读；③是否预授权回滚 |

## 1. 范围与不变量

| 项 | 值 |
|---|---|
| 云环境 | `shishen-dev-d2g4t8rgj7d0bd1e7` |
| 云函数 | `seed_b1`（2026-10-27 部署，代码与 `seed` 同哈希） |
| 入口 | `index.main` |
| 目标集合白名单 | `restaurants` / `stalls` / `dishes` |
| 批次号 | `pilot_c02_batch1_20261022`（必须精确相等） |

**写入过程必须保持的不变量**

1. 只做 `add`；已存在且内容相同 → `skipped`；内容不同 → `conflict`，**绝不覆盖**。
2. 集合名来自代码内冻结常量，不接受入参传入。
3. ID 一律 `c02` / `c02_t02` / `c02_d0NN` 形状，不生成、不重编号、不碰 `c01` 冻结映射。
4. `dataClass` 恒为 `field_unverified`，`verifyStatus` 恒为 `unverified`，`verifiedAt` 恒为 `null`——**不会把任何记录标成 verified**。
5. 不写 `data/dishes.js`，不生成 `records.json` / `records_blockers.json` / `gen-manifest.json`。
6. 不改集合权限、不改索引、不改环境变量、不重部署任何函数、不触碰旧 `seed`。
7. 不做任何 Git 写操作。
8. 前端仍读本地 `data/index.js`，本轮不接线、不发布。

## 2. 将写入的 14 条记录

公共字段（14 条全部带）：`batchId = pilot_c02_batch1_20261022`、`dataClass = field_unverified`、`verifyStatus = unverified`、`verifiedAt = null`、`rev = 1`、`contentHash`（写入时按内容计算）、`createdAt` / `updatedAt`（服务端时间），以及来自 CSV 的 `source = { kind, detail, ref }`（写入时 `ref` 缺省为 `""`）。

| 集合 | `_id` | 名称 | 价格 | `tastes` | `source.kind` |
|---|---|---|---|---|---|
| restaurants | `c02` | 三餐（第三餐厅） | — | — | field |
| stalls | `c02_t02` | 韩小面 | — | — | field |
| dishes | `c02_d060` | 重庆小面（素） | 7 | spicy | field |
| dishes | `c02_d061` | 杂酱面（素） | 9 | spicy | field |
| dishes | `c02_d062` | 招牌豌杂面（素） | 11 | spicy | field |
| dishes | `c02_d063` | 酸菜面（素） | 8 | mild_spicy | field |
| dishes | `c02_d064` | 牛肉面（荤） | 15 | mild_spicy | field |
| dishes | `c02_d065` | 干拌小面（素） | 7 | spicy | field |
| dishes | `c02_d066` | 干拌杂酱面（素） | 9 | spicy | field |
| dishes | `c02_d067` | 干拌豌杂面（素） | 11 | spicy | field |
| dishes | `c02_d068` | 清汤小面 | 7 | choice | field |
| dishes | `c02_d069` | 清汤杂酱面 | 9 | choice | field |
| dishes | `c02_d070` | 清汤豌杂面 | 11 | choice | field |
| dishes | `c02_d071` | 麻酱凉面 | 8 | choice | field |

## 3. 执行前置检查（S0，全部只读）

| 编号 | 检查 | 通过标准 | 失败处理 |
|---|---|---|---|
| S0-1 | 复跑 `plan` | `creates` 仍为 14 条、`conflicts` 为空、`identical` 为空 | 出现 conflict 立即停 |
| S0-2 | 跑 `rollbackPlan` 预演 | 返回 `missing: 14`、`wouldDelete: []`（还没写，所以没有可删项） | 报错即停，说明回滚路径不可用 |
| S0-3 | 记录三集合计数基线 | `dishes`=4、`restaurants`=1、`stalls`=3（写后应分别 +12/+1/+1） | 与基线不符先停 |
| S0-4 | 确认超时 | 当前 3 s；如需 10 s，先由负责人改配置（可用可不用） | 出错即停 |
| S0-5 | 确认无并发写者 | 无人同时在控制台改这三个集合 | 有则重新排期 |

## 4. 写入调用（S1）

请求（与控制台"云函数测试"或调试器 Console 等价）：

```json
{ "action": "write", "batchId": "pilot_c02_batch1_20261022" }
```

预期响应形态：

```json
{ "ok": true, "action": "write", "dataset": "pilot",
  "batchId": "pilot_c02_batch1_20261022",
  "done": ["c02","c02_t02","c02_d060","..."],
  "failed": [], "notAttempted": [],
  "results": [ { "collection": "restaurants", "id": "c02", "action": "created" }, "..." ],
  "elapsedMs": 1500 }
```

判读规则：

| 观测 | 含义 | 处理 |
|---|---|---|
| `done` 14、`failed` 空 | 全部创建成功 | 进入 S2 核验 |
| 某条 `action: "skipped"` | 已存在且哈希相同（幂等） | 正常，计入 14 |
| 某条 `action: "conflict"` | 已存在但内容不同 | **停止**，报告，不回滚也不继续 |
| `failed` 非空 | 该条写入异常；`blocked=true` 后其余记入 `notAttempted` | **停止**，先核对已写入条数再决定回滚或补写 |

## 5. 写入后核验（S2，全部只读）

1. 复跑 `plan`：期望 `identical = 14`、`creates = []`、`conflicts = []`。
2. 跑 `action: "verify"`：逐字段读回比对 + 关联校验，期望 `ok: true`、`diffs: []`。
3. 控制台计数：`dishes` 4→16、`restaurants` 1→2、`stalls` 3→4。
4. 抽查 3 条文档（`c02`、`c02_t02`、`c02_d060`）：确认 `dataClass=field_unverified`、`verifyStatus=unverified`、`verifiedAt=null`、`batchId` 精确、`rev=1`。
5. 确认 `submissions` / `upload_logs` 未被写入、集合权限未变化。

## 6. 回滚方案（S3，仅在被单独授权时）

| 步骤 | 动作 | 预期 |
|---|---|---|
| S3-1 | `action: "rollbackPlan"` | `clean: true`、`wouldDelete` = 14 条、`missing: []`、`blockers: []` |
| S3-2 | `action: "rollback"` | 先内部再复核一次；`deleted` 14 条；`alreadyAbsent: []`、`blockedNow: []` |
| S3-3 | 复核 | `plan` 应回到 14 条 `would-create`；三集合计数回到 4/1/3 |

**回滚的已知限制（必须如实理解）**

- 没有数据库事务，**不是原子操作**；删到一半失败会留下部分文档。
- 删除前对每条做五项字段复核（`batchId` / `dataClass` / `verifyStatus` / `verifiedAt` / 重算 `contentHash`）；任一漂移即阻断，**不会误删被改过的记录**。
- 删除顺序固定为 菜品 → 档口 → 店铺；`removed=0` 时记 `already-absent`，不会虚报"我删了"。
- 若回滚中途失败，只能再跑一次 `rollback`（幂等，已删的记为 absent）。

## 7. 停止条件（任一条触发即停，不做下一步）

1. `plan` 复跑出现 `conflict` 或条数 ≠ 14。
2. `write` 返回 `failed` 非空或出现 `conflict`。
3. 写入后计数增量 ≠ +14。
4. `verify` 返回 `ok: false` 或 `diffs` 非空。
5. 出现任何非本批次 ID（`c01*`、`s01*`、`d01*` 等）。
6. 超时/网络异常导致响应不明（先查计数再决定，禁止盲重试）。
7. 权限、索引、环境变量出现非预期变化。
8. 回滚不可执行（`rollbackPlan` 报错或 `blockers` 非空）。

## 8. 风险与影响

| 风险 | 说明 | 缓解 |
|---|---|---|
| 写入后对客户端可读 | 三个集合当前是"所有用户可读"，写入即可被小程序端查询 | 若不可接受，先改权限（需单独授权）；当前前端不读云端，UI 不会自动变化 |
| 超时 | `seed_b1` 仅 3 s；plan 用 747 ms，write 预计 1.5–2.5 s | 建议先调 10 s |
| 无快照 | 写入不可"还原到前一秒"，只能按 ID 删除 | add-only + 回滚补偿；14 条 ID 已固定 |
| 数据性质 | 全部是 `field_unverified`，名称/价格有照片支持，楼层/方位仍待核实 | 不标 verified；前端不接线 |

## 9. 验收判据

1. `write.ok = true`，`done` 含 14 条 ID，`failed` 为空。
2. `plan` 复跑：`identical` 14。
3. `verify.ok = true`，`diffs` 为空。
4. 三集合计数分别为 4/1/3 → 16/2/4。
5. 无其他集合、权限、函数、环境变量被修改。

## 10. 需要批准的清单

| 编号 | 事项 | 缺省建议 |
|---|---|---|
| A-1 | 授权执行 `write` | 需要明确一句"授权写入" |
| A-2 | 是否先把 `seed_b1` 超时从 3 s 调到 10 s | 建议调 |
| A-3 | 是否接受这 14 条写入后对客户端可读 | 需明确 |
| A-4 | 是否预授权一次 `rollback`（写入失败或需要撤回时） | 建议预授权，但执行前再确认 |
| A-5 | 写入后是否允许跑 `verify` 与 `plan`（只读） | 建议允许 |

## 11. 证据留存与脱敏

- 每次调用返回的 JSON 原样存到独立文件（建议 `docs/evidence/` 或桌面归档目录），**先删除/打码 `actorOpenId` 字段**。
- 报告只引用：ID 列表、`ok`、计数、`elapsedMs`、错误码。
- 不记录 openid 明文、不记录任何密钥。

## 12. 本轮明确不做

- 不写 `write`、不写数据、不删数据、不改权限、不改环境变量、不部署。
- 不改任何代码、测试、配置、CSV、映射、审批、初始化计划。
- 不生成正式产物，不做 Git 写操作。
- 不把 `unverified` 数据描述为"已核实"。

## 附录：代码依据

| 行为 | 位置 |
|---|---|
| 管理员鉴权（三种拒绝原因） | `cloudfunctions/seed_b1/index.js:278-284` |
| `plan` 只读 | `cloudfunctions/seed_b1/index.js:441-467` |
| `write` 实现（add-only / 冲突不覆盖 / 失败即封盘） | `cloudfunctions/seed_b1/index.js:470-539` |
| 写前证据闸门 P4 | `cloudfunctions/seed_b1/index.js:317-336`、`:479-491` |
| 写入字段与 `contentHash` | `cloudfunctions/seed_b1/index.js:344-356` |
| `verify` 读回比对 | `cloudfunctions/seed_b1/index.js:542` 起 |
| 回滚五项复核 | `cloudfunctions/seed_b1/index.js:809-829` |
| `rollbackPlan` / `rollback` | `cloudfunctions/seed_b1/index.js:902-917`、`:919-1001` |
