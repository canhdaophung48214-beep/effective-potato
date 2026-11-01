# UGC MVP 设计定稿（2026-10-26）

> 性质：**设计定稿 + 边界声明**。本轮零代码改动、零云端操作、零集合/权限变更、零正式产物写入、零 Git 写操作。
> 定位：本文是「投稿是数据收集入口，不是发布入口」的唯一设计口径。与 `docs/AUDIT_PRODUCT_BOUNDARY_AND_UPLOAD_MVP_20261025.md`、`docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md` 的冲突以本文 §0.4 的裁决为准；本文不推翻任何合规结论。
> 标注纪律：`[实测]` = 本机文件/命令可复核；`[官方原文]` = 微信官方文档抓取原文；`[后台截图]` = 负责人提供并已归档的后台事实；`[待后台确认]` = 尚未取得证据，**不得当作已具备**；`[设计]` = 未实现、未验证的方案。

---

## 〇、结论与裁决

### 0.1 一句话结论

**可以在「保留个人主体 + 工具-信息查询」的前提下做私有纠错投稿（路径 A）；不得做任何形式的公开展示（路径 B）。** MVP 第一版收到的是「对已存在真实菜品的价格/信息纠错」，只进管理员审核队列，永不自动进入正式数据，永不获得 `dishId`，永不改变 `verifyStatus`。

### 0.2 五个必须分开的概念

| 层 | 谁做 | 落点 | 谁能看到 | 本轮是否已具备 |
|---|---|---|---|---|
| ① 用户提交 | 普通用户 | `submissions`（`status=pending`） | 提交者本人（经云函数）+ 管理员 | 无（页面无入口） |
| ② 运营审核 | 管理员 | `submissions.status=approved/rejected` + `upload_logs` | 管理员 | 无 |
| ③ 事实核验 | 运营者现场/凭证 | `verifyStatus=verified` + `verifiedAt` | 全站（若展示） | 无（口径已定，见 `data/provenance.js:228-260`） |
| ④ 正式数据接入 | 运营者 + 独立审批 | `records.json` → CSV → `data/dishes.js` | 不适用 | 无（三产物不存在） |
| ⑤ 公开展示 | 产品决策 + 类目资格 | 客户端读取 | 全体用户 | **不允许**（§6.2） |

> 「①→②」是 MVP 的全部范围。「②→⑤」不是同一条流水线的后续步骤，而是各自需要独立资格与独立审批的**五道不同闸门**。把它们写成一条自动链路是本项目最危险的误解。

### 0.3 本轮判定

- **可以做**：设计文档（本文）、后台待确认清单、验收标准、只读测试复核。
- **不得做**：任何代码/契约/映射/审批/初始化计划改动；任何云函数、集合、权限、部署操作；任何正式产物生成；任何 `unverified → verified` 变更；任何把投稿接入公开数据的动作。
- **不得假设**：类目允许公开展示 UGC；内容安全接口全族可用；后台接口权限已确认；隐私指引已覆盖投稿数据。

### 0.4 与既有文档的冲突与裁决

| # | 冲突 | 双方出处 | 裁决 | 理由 |
|---|---|---|---|---|
| C1 | 投稿类型范围 | `docs/AUDIT_PRODUCT_BOUNDARY_AND_UPLOAD_MVP_20261025.md:59-63` 列 `dish/price/photo/stall_info` 四类 | **收窄为 `price_fix` / `info_fix` 两类**，不收图片、不收新菜品、不收档口信息 | 图片接口 `media_check_async` 未实测（`docs/EVIDENCE_BACKEND_CHECK_20261026.md:128`）；新菜品必然触发 ID 规划，触碰冻结映射（`docs/RECORD_GENERATOR_CONTRACT_20261023.md:391-407`） |
| C2 | `approved` 之后是否进正式数据集 | AUDIT `:81`「approved ──(导出/导入轮)──> 进入正式数据集」；`docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:110`「approved 内容仅供运营者参考，不进入公开数据集」 | **以 COMPLIANCE 为准**：不自动接入。接入须走 §5.5 的独立审批路径 | 审批效力边界：批准映射初始化 ≠ 批准 CSV 导入 ≠ 批准云端写入（`docs/RECORD_GENERATOR_CONTRACT_20261023.md:805`） |
| C3 | 导出到云存储 | AUDIT `:96` 云函数 `exportApproved` 写 `submissions_approved.json` 到 CloudBase 存储 | **MVP 不实现导出**；推迟到阶段 D 且需单独评估存储对象私有性 | 云存储对象默认访问级别未核实，导出即等于扩大数据暴露面 |
| C4 | 内容安全不通过如何处置 | AUDIT `:105`「任一不通过 → 直接 rejected」；`docs/EVIDENCE_BACKEND_CHECK_20261026.md:93-94` 官方要求 REVIEW 需人工确认、PASS 需抽查 | **双轨**（§6.4）：`risk` → `rejected`；`review` → 进队列但标注"接口建议人工审核"；`pass` → 抽查 | 官方 FAQ 原文「请不要完全依赖内容安全服务」 |
| C5 | 审核页可见性 | AUDIT `:90`「仅管理员 openid 可见」 | 页面在 `app.json` 注册（编译必需）但**零入口**；所有数据经云函数，服务端 403 兜底 | 客户端无法可信判定管理员身份；`openid` 属服务端上下文 |
| C6 | 集合权限档位 | AUDIT `:85`「客户端 `db` 权限设为『仅创建者可读自己记录』」 | **改为「仅管理端可读写」**，客户端零直读，仅经云函数 | 现有三集合为「所有用户可读」（`docs/COLLECTION_STATUS_REPORT_20261023.md:51`）；沿用该档位会公开投稿内容 |
| C7 | 集合与云函数数量 | AUDIT `:114` 2 集合 + 3 云函数 | **2 集合 + 2 云函数**（`submit` / `review`） | `exportApproved` 见 C3；少一个云端写路径就少一个越权面 |
| C8 | `payload` 是否允许自由字段 | AUDIT `:63` `payload` 含 `name`/`stallId` 自由组合 | **`target` 必须先指向已存在的真实记录**；`name` 仅作改名建议，不新建记录 | 自由 `stallId` 会造出"名册外新档口"，直接威胁已冻结的 37 + 2 档口身份 |
| C9 | 隐私指引是否已覆盖投稿 | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:16` 记「用户隐私保护指引：已更新」 | **不得据此认为已覆盖投稿数据**；文本不在仓库内，属 `[待后台确认]` | 页面存在 ≠ 条款覆盖；§6.5 列出必须核对的三项 |
| C10 | 类目表述 | AUDIT `:53`「类目为『信息查询』，UGC 受限」；COMPLIANCE `:8-19` 有官方原文与个人主体类目表 | 以 COMPLIANCE 官方原文为准：**个人主体无 UGC 类目，信息查询类目排除用户原创内容的传播与公开访问** | AUDIT 该句未区分主体，属概括表述；原文结论更强 |
| C11 | 投稿面向谁（真实用户 / 灰度） | AUDIT 默认「已有可纠错的真实数据」；实测 `pages/**` 不引用 `utils/cloudRepo.js`、不调 `wx.cloud`，`utils/cloudRepo.js:5` 明写「不切首页数据源，页面仍用本地 `data/index.js`」，`cloudfunctions/seed/pilot-data.js` 的 `DISHES` 为 12 条样板菜 | **阶段 B 只允许体验版 / 管理员灰度**；面向真实用户开放的前提是先完成真实数据接入（阶段 D） | 否则用户"纠错"的对象是演示菜名，既产生无意义数据，也浪费审核人力；这一点不改设计，只改灰度范围 |

### 0.5 证据索引（本文引用的事实出处）

- 类目与运营规范：`docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:8-35`
- 后台截图事实（UGC 声明未声明、隐私指引已更新、内容风控可配置）：`docs/EVIDENCE_BACKEND_CHECK_20261026.md:6-20`、`:55-61`
- 文本内容安全接口权限实测（`errcode=40003`，非 `48001`）：`docs/EVIDENCE_BACKEND_CHECK_20261026.md:107-130`
- 待验证六项：`docs/CHECKLIST_CONTENT_SECURITY_BACKEND_20261025.md:66-75`
- ID 冻结与分配规则：`docs/RECORD_GENERATOR_CONTRACT_20261023.md:391-470`
- 资格断言 C17–C20：`docs/RECORD_GENERATOR_CONTRACT_20261023.md:307-316`
- P1 十阶段与 `PUBLISH_OK` 语义：`docs/RECORD_GENERATOR_CONTRACT_20261023.md:1174-1191`
- 读侧完整性六条件（E17）：`docs/RECORD_GENERATOR_CONTRACT_20261023.md:1222`
- 可信度裁决：`data/provenance.js:23-28`、`:115-124`、`:182-270`
- 云端读取白名单与"不抬升可信度"：`utils/cloudRepo.js:12-19`、`:43-47`
- 管理员鉴权范式：`cloudfunctions/seed/index.js:255-285`
- 价格规则 D5：`tools/verify_data.js:28`、`:327-340`
- 现状无投稿入口：`pages/community/community.wxml:12`、`pages/profile/profile.js:9`

---

## 一、产品目标与明确不做的事

### 1.1 目标（MVP 第一版的全部范围）

1. 让用户能用**最少字段**报告一条已存在菜品的问题：价格不对、菜名/规格描述不对。
2. 让运营者在一个**私有队列**里看到这些报告，逐条采纳或驳回，并留下不可改写的审计。
3. 让"投稿"与"正式数据"之间保持**物理隔离**：投稿表里永远不出现 `dishId`、`verified`、`candidate_only` 这类会被下游误读为"可用"的值。
4. 让整条链路在**内容安全接口不可用/超时**时默认关闭（fail-closed），而不是默认放行。

### 1.2 明确不做的事

| # | 不做 | 依据 |
|---|---|---|
| N1 | 不做任何形式的公开展示：不展示投稿原文、不展示投稿人、不展示"用户贡献"标识、不做投稿列表页 | §6.2 类目无依据 |
| N2 | 不做图片上传（`photos` 字段保留但恒为空，服务端拒绝非空） | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:128` 图片接口未实测 |
| N3 | 不做新菜品投稿（不接受"我们这儿还有个菜没收录"） | 新菜品 = 新 `dishId` = 触碰冻结映射（`docs/RECORD_GENERATOR_CONTRACT_20261023.md:391-407`） |
| N4 | 不做档口信息投稿（不接受新档口、改名档口、换位） | 档口身份由名册位次唯一决定，`c01_t01`–`c01_t37` 已冻结；名册外入册须负责人裁决 |
| N5 | 不做评分、评论、点赞、回复、关注 | 均为 UGC 传播，且当前类目下无依据 |
| N6 | 不做"采纳后自动改数据"：不写 `data/dishes.js`、不生成 `records.json`、不写云端 `dishes` | §5.1 三道隔离；审批边界 `:805` |
| N7 | 不做投稿导出（CSV/JSON/云存储） | C3 |
| N8 | 不做跨用户可见的任何计数（如"已有 N 人反馈"） | 计数即公开传播的一种形式 |
| N9 | 不在 MVP 内实现"举报/投诉工单系统"，只保证投诉入口存在且有人承接 | `docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:32`（3.10）要求入口，未要求系统化 |

### 1.3 为什么必须收窄（不是保守，是约束）

- **类目**：个人主体类目表中不存在「社区/论坛」「笔记」等 UGC 类目；「工具-信息查询」的排除条款明确针对"用户原创内容的传播及公开访问"。→ 公开面为零。
- **接口**：文本检测已实测可用，图片检测未实测。→ 只做文本。
- **映射**：`tools/pilot/id-map.json` 的 104 条已冻结（`approvalRef=ap-20261025-01`），`entries` 全 `active`、`orphans=0`，只有 `add-only`、退役不复用。任何"投稿生成新菜"都会破坏"补拍不重编号"的前提。→ 只做纠错。
- **产物**：`records.json` / `records_blockers.json` / `gen-manifest.json` 当前**均不存在**，490 条候选全 `import_eligibility=blocked`。→ 不存在"投稿可以顺着现有流水线流出去"的通道。

---

## 二、推荐的 MVP 流程

### 2.1 流程总览

```
[用户] 提交页（仅对已存在真实菜品）
   │  S1 客户端预校验（含幂等 token）
   ▼
[云函数 submit]
   S2 身份（OPENID，服务端取） → S3 限流 → S4 字段复校 → S5 目标校验
   → S6 去重 → S7 内容安全（文本） → S8 落库 pending（私有） → S9 返回
   ▼
[管理员] 审核页（隐藏、服务端鉴权）
   S10 列表 / 详情 / 通过 / 驳回（必填理由）
   ▼
[运营者·离线] S11 采纳建议 → 本地改写 → 独立审批轮（阶段 D，不在 MVP）
```

### 2.2 阶段定义（成功 / 失败 / 重试 / 审计）

| 阶段 | 成功 | 失败 | 重试 | 审计 |
|---|---|---|---|---|
| **S0 入口** | 页面显示「仅运营者可见，不会公开展示」声明；目标选择器只列允许目标（服务端白名单查询结果） | 目标列表拉取失败 → 显示「暂不可用」，**不缓存旧列表**、不猜 | 用户手动刷新，客户端退避（≥1s，≤3 次/分钟） | 不记录浏览 |
| **S1 客户端预校验** | 字段齐备、长度/价格通过；生成 `clientToken`（32 hex UUID） | 就地提示，**不发请求** | 用户修改后重提 | 无 |
| **S2 身份** | 取 `cloud.getWXContext().OPENID`；入参只保留白名单键 | `NO_OPENID` → 401；入参含 `status`/`review`/`verified` 等保留键 → 400 `RESERVED_FIELD` | 不重试（身份失败重试无意义） | `denied` 行（含 `requestId`，不含内容） |
| **S3 限流** | 未超配额 | `RATE_LIMITED` → 429 + `retryAfter` 秒 | 按 `retryAfter`；不得自动轮询 | `throttle` 行 |
| **S4 字段复校** | 通过（服务端独立复算，不信任客户端） | `INVALID_FIELD` → 400，指明字段名与原因码 | 用户修正 | 仅计数 |
| **S5 目标校验** | `target` 指向云端 `dishes` 中 `batchId=pilot`、`dataClass='field_unverified'` 的记录，且 `stallId`/`shopId` 与文档一致 | `TARGET_NOT_FOUND` 404 / `TARGET_IS_DEMO` 422 / `TARGET_MISMATCH` 409 / `TARGET_NOT_VERIFIABLE` 422 | 否（目标不存在就是不存在，不建） | 记 `target` 三元组与结果码 |
| **S6 去重** | 新键 → 继续 | `DUPLICATE` → 409 + 已有记录的 `submissionId` 与状态文案（不返回内容） | 否（等待原记录处理） | `dedupe` 命中行 |
| **S7 内容安全** | `pass` → 继续；`review` → 继续但标记人工确认；`risk` → 落库即 `rejected`（`reasonCode=security_risk`） | `error`/超时 → 落库 `pending` + `security.state='error'`，**不可 approve** 直到重试成功 | 云函数内 1 次（总预算 ≤8s）；持久重试最多 3 次、间隔 ≥10 分钟 | 每次调用记 `provider/version/errcode/rid/latency/attempts`，**不记原文** |
| **S8 落库** | 先写 `submissions`，成功后写 `upload_logs`；返回 `submissionId` | `DATABASE_ERROR` → 500，不声称成功；`upload_logs` 写失败 → 提交仍成功但写 `alarm` 行并计数 | 幂等重试（同 `clientToken` 返回同一结果） | `submit` + `security_call` 行 |
| **S9 返回** | 「已提交，等待审核；不会公开展示」+ `submissionId` + 预计审核时长 | 超时 → 客户端提示「结果未知，可用同一凭据重试」，用 `clientToken` 查询 | 用同一 `clientToken` 重试（幂等） | 无 |
| **S10 审核** | 状态 `pending → approved/rejected`，写 `review.*` 与 `rev+1`，追加日志 | 403 非管理员 / 409 状态已变更（并发）/ 422 缺少驳回理由 | 刷新列表后重试；409 以重新读取的状态为准 | `review_approve` / `review_reject` 行（含 before/after） |
| **S11 采纳后处理** | 运营者在本地把建议并入 CSV/代码，走独立审批轮 | 不适用（离线人工） | 不适用 | 审批文件 `ap-*` 与 `planDigest` |

### 2.3 失败关闭（fail-closed）四原则

1. **默认为私有**：任何未明确标记 `pass` 的内容都不可被管理员"一键通过"。
2. **默认为未核实**：`verifyStatus` 恒 `unverified`，不因审核通过而改变。
3. **默认为不可导入**：`importEligibility` 恒 `blocked`，不提供任何升格 API。
4. **错误不降级为放行**：接口超时、日志写失败、去重查询失败，一律不产生"看起来成功"的状态；宁可让用户重试，不可让内容混入。

### 2.4 上线阻塞项（未确认即不得上线）

| # | 阻塞项 | 当前状态 | 证据 |
|---|---|---|---|
| B1 | 「用户生成内容场景声明」未提交 | **未声明** | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:17`（`[后台截图]`） |
| B2 | 隐私保护指引是否含投稿条款 | 未知（文本不在仓库） | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:16` |
| B3 | 文本内容安全接口**配额**（次/日） | 未确认 | `docs/CHECKLIST_CONTENT_SECURITY_BACKEND_20261025.md:31` |
| B4 | 云端是否存在可供纠错的 pilot 真实记录 | 未核实（本轮零云端操作） | `cloudfunctions/seed/pilot-data.js` 有 `DISHES` 12 条；实际是否已写入 `dishes` 集合以云开发控制台为准 |
| B5 | 管理员 `openid` 白名单由谁担任 | 未指定 | `docs/AUDIT_PRODUCT_BOUNDARY_AND_UPLOAD_MVP_20261025.md:128` |
| B6 | 数据保留期与删除流程 | 期限已裁决；T-2 清理、删除流程和线上验收未完成 | §3.5.2；`docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:127` 为旧依据 |

> B1–B6 任一未关闭，MVP 只能停留在**开发者工具/体验版内部灰度**，不得提交审核、不得对公众开放。

---

## 三、数据模型

### 3.1 `submissions`（投稿主表）

| 字段 | 类型 | 写入方 | 约束与说明 |
|---|---|---|---|
| `_id` | string | 服务端 | 自动 |
| `schemaVersion` | number | 服务端 | 恒 `1`；结构变更须升版并同步本文 |
| `clientToken` | string | 客户端 | 32 hex；与 `openid` 组合**唯一**，用于幂等重试 |
| `kind` | enum | 客户端 | 仅 `price_fix` / `info_fix` |
| `target` | object | 客户端 | `{ dishId, stallId, shopId }`；三者必须与服务端读到的 dish 文档**逐字段一致**，否则 409 |
| `payload` | object | 客户端 | `{ price?, nameSuggestion?, note? }`；**禁止其它键**；`note` ≤100 字；`nameSuggestion` ≤20 字 |
| `photos` | array | 服务端 | 恒 `[]`；入参非空 → 400 `PHOTO_NOT_SUPPORTED` |
| `security` | object | 服务端 | `{ state: pass\|review\|risk\|error\|pending, labels:[], provider:'msg_sec_check', version:2, checkedAt, rid, attempts }` |
| `status` | enum | **仅服务端** | `pending` / `approved` / `rejected` / `expired`；`expired` 仅系统保留期流程写入，客户端传值一律忽略并记 `denied` |
| `review` | object | **仅服务端** | `{ decision, byOpenidHash, at, reasonCode, reasonText, edits }`；`rejected` 必须 `reasonCode` |
| `submitter` | object | 服务端 | `{ openid }`；仅管理端可读，任何对外响应都不返回 |
| `dedupe` | object | 服务端 | `{ key, dupOf }`；`key = dishId\|norm(note)\|price` |
| `dataClass` | string | 服务端 | 恒 `user_submission`（与 `demo` / `field_unverified` 并列，供下游显式排除） |
| `verifyStatus` | string | 服务端 | 恒 `unverified`（见 §5.2） |
| `verifiedAt` | null | 服务端 | 恒 `null` |
| `importEligibility` | string | 服务端 | 恒 `blocked`（见 §5.3） |
| `reopenOf` | string? | 服务端 | 复议/重新提交时指向前一条 `_id`；**不改写旧记录** |
| `createdAt` / `updatedAt` | date | 服务端 | `db.serverDate()`；客户端时间不采信 |
| `rev` | number | 服务端 | 乐观锁；每次状态迁移 `+1`，审核写入须带 `expectedRev` |
| `retention` | object? | 系统保留期流程 | T-1 标记时写 `markedAt` 与 `policyConfirmedBy`；不含正文、维护令牌或投稿人身份 |

### 3.2 `upload_logs`（审计表，只追加）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 自动 |
| `event` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` / `retention_mark` / `retention_purge` |
| `action` | string | 云函数实际动作；系统到期标记和清理分别为 `retention_mark`、`retention_purge`。系统逐条事件长期仅投影已裁决的八个逻辑字段，批次 `prepare` / `complete` 另含运行统计 |
| `submissionId` | string? | `throttle`/`denied`（未关联记录时）为空 |
| `actor` | object | 投稿人／管理员：`{ openidHash, role }`，其中哈希为 32 位小写十六进制 HMAC 摘要；系统：`{ role:'system', openidHash:null }`；**日志内不存明文 openid，也不使用虚构哈希** |
| `at` / `rev` | date / integer | 运行日志均写 `at=db.serverDate()`、`rev=1`；90 天后逐条摘要仅投影八个已裁决逻辑字段，不含这两项 |
| `before` / `after` | object? | 仅状态迁移类：`{ status, rev }` |
| `reasonCode` / `reasonText` | string? | `reasonText` 为管理员手写理由（≤100 字），不含用户原文 |
| `requestId` | string | 云函数 `request_id`，用于串联同一次调用 |
| `errorCode` | string? | 平台错误码原文（如 `48001` / `45009`），**不猜含义** |
| `note` | string? | ≤200 字；只允许写长度、标签、耗时等元信息 |

> 两表都不含：昵称、头像、手机号、位置、IP、设备指纹、用户原文全文（正文只在 `submissions.payload`，受保留期约束）。

### 3.3 状态机（服务端唯一可写）

```
pending ──approve──> approved（终态）
   └─────reject────> rejected（终态，必须 reasonCode）
   └─────expire──> expired（仅系统保留期流程）
```

- **允许**：人工 `pending → approved`、`pending → rejected`；仅系统保留期流程可执行 `pending → expired`，`expire` 是独立决策，不复用 `reject`。
- **禁止**：`approved → pending`、`rejected → pending`、`approved ⇄ rejected`、任何客户端发起的状态写入。
- **复议**：不改写历史。用户重新提交生成新记录并写 `reopenOf`；管理员如需"回收已通过的建议"，只能新建一条 `rejected(reasonCode=revoked)` 的关联记录，**旧记录保持原样**（append-only 精神）。
- **超时（2026-10-28 裁决）**：`createdAt < now-29d` 且仍为 `pending` 时，系统标记 `expired`，正文不清；空 `payload` 仍须标记。`createdAt < now-30d` 时清正文，覆盖 `approved`、`rejected`、`expired`；若此时仍为 `pending`，先用状态与 rev 条件安全标记 `expired`，另记补救审计事件，再清正文。两处边界均为严格 `<`，人工审核接口不得执行 `expire`。

### 3.4 敏感字段最小化

| 数据 | 是否存 | 位置 | 理由 |
|---|---|---|---|
| `openid` 明文 | 是 | `submissions.submitter.openid` | "仅自己可见"查询与限流需要；集合权限为仅管理端 |
| `openid` 哈希 | 是 | `upload_logs.actor.openidHash` | 审计可追溯但不扩散标识符；盐在云函数环境变量 |
| 投稿正文 | 是（≤100 字） | `submissions.payload.note` | 审核必需；30 天期限已裁决（§3.5.2），清理未部署前不得对外声称已按期删除 |
| 昵称/头像/手机号 | **否** | — | 无业务必要（运营规范 5.12/15.1） |
| 位置/IP/设备 | **否** | — | 纠错不需要；限流用 openid 维度足够 |
| 图片 | **否** | — | §1.2 N2 |
| 密钥/令牌/AppSecret | **否** | 云函数环境变量 | 任何日志、任何响应、任何前端代码都不得出现 |

### 3.5 索引与保留

#### 3.5.1 索引（三种状态必须分开说）

| 状态 | 内容 | 当前值 |
| --- | --- | --- |
| 设计必需 | 本节最初列的 4 条 | 见下表左列 |
| 代码声明 | `config/cloud/schema.submissions.json` 5 条 + `schema.upload_logs.json` 3 条 | 8 条，**均为草稿** |
| 云端已建 | 控制台实际创建并验证的索引 | **0 条**（两集合尚未创建） |

任何汇报都必须区分这三层：`config/cloud/*.json` 里有 `indexes` 数组，只代表"代码声明"，**不代表云端已生效**；只有控制台截图 + 列表核对后才可写"已建"。

设计与实现的逐条对照（4 条 vs 5 条）：

| # | 设计稿 | 实现声明 | 差异与理由 |
| --- | --- | --- | --- |
| 1 | `(status, createdAt)` | `ix_status_created`，同列同序 | 一致；支撑待审队列 |
| 2 | `(submitter.openid, createdAt)` | `ix_submitter_created`，同列同序 | 一致；支撑限流两条计数 |
| 3 | `clientToken` 唯一 | `uk_submitter_clienttoken`，**复合唯一** | 单列唯一会让两个用户偶然撞上同一令牌时互相阻塞（概率极低，但后果是"合法用户提交被拒"且无法自救）；复合后仍保证"同一用户同一令牌只落一条"，幂等语义不变 |
| 4 | `dedupe.key` 唯一 | `ix_dedupe_status`，**复合非唯一** | 去重语义是"`pending` 期内不重复"，不是"永远不许重复"；唯一索引会让某条纠错被驳回后无法再次提交。改为复合非唯一 + 应用层只查 `status='pending'`（`cloudfunctions/submit/index.js` 去重分支） |
| 5 | — | `ix_security_status`（`security.state, status`） | 预留：审核端按安全态筛 `review`/`error` 队列；当前 `list` 未使用，**可最后建或暂缓** |

各索引支撑的真实查询（"必要性"以当前代码为准，不以未来设想为准）：

| 索引 | 查询路径 | 代码位置 | 必要性 |
| --- | --- | --- | --- |
| `ix_status_created` | `where({status:'pending'}).orderBy('createdAt','asc').limit(20)` | `cloudfunctions/review/index.js` 的 `doList` | **必需**：待审列表 |
| `ix_submitter_created` | `where({submitter.openid}).orderBy('createdAt','desc')` + `count`（24h / 5min 两次） | `cloudfunctions/submit/index.js` 限流分支 | **必需**：限流计数 |
| `uk_submitter_clienttoken` | `where({submitter.openid, clientToken})` | `cloudfunctions/submit/index.js` 幂等分支 | **必需**；同时承担并发兜底（唯一性冲突 → 视为重复） |
| `ix_dedupe_status` | `where({dedupe.key, status:'pending'})` | `cloudfunctions/submit/index.js` 去重分支 | **必需** |
| `ix_security_status` | 暂无调用 | — | 预留，**可延后** |
| `upload_logs.ix_at` | 保留期清理按时间删除；审计倒查 | 清理任务**尚未实现** | 延后（随清理任务一起建） |
| `upload_logs.ix_event_day` | 按事件统计（管理端未实现） | — | 延后 |
| `upload_logs.ix_actor_at` | 按人追溯（管理端未实现） | — | 延后 |

结论：**联调必需 4 条**（均属 `submissions`：待审列表、限流计数、幂等、去重各一条），`upload_logs` 的 3 条与 `ix_security_status` 随功能补齐；若控制台索引数量受限，按上表"必需 → 预留 → 延后"顺序建。

#### 3.5.2 保留期（2026-10-28 已裁决，尚未部署）

**现行裁决**：投稿正文自 `createdAt` 起 30 天，审计明细 90 天；逐条摘要采用 `schemaVersion/event/action/submissionId/day/result.code/errorCode/role` 八个逻辑字段，自生成起保留 180 天。每批追加 `prepare` 与 `complete` 两条运行摘要，失败需区分全失败和部分成功。系统运行日志填写 `actor.openidHash:null`，人工操作者沿用 32 位 HMAC 摘要；运行日志填写 `at/rev`，到期后的逐条摘要仍严格只投影八字段。T-1 标记和 T-2 正文清理已有本地代码，日志轮转、真实云端索引和触发器尚未实现或部署；本节规则不代表线上已生效。下列 A/B/C 表仅保留历史候选背景，不再作为待决选项。

本节此前把「`submissions` 90 天 / `upload_logs` 180 天」写成既定值，属于越权设定；以下 A/B/C 仅为裁决前的历史候选，不再要求负责人重新选择：

| 候选 | `submissions` | `upload_logs` | 好处 | 代价 / 风险 |
| --- | --- | --- | --- | --- |
| A 最短 | 30 天 | 90 天 | 暴露面最小、删除成本最低 | 申诉与复盘窗口短；客服事后核对困难 |
| B 中间（原提案） | 90 天 | 180 天 | 覆盖一次完整纠错周期 + 季度复盘 | 必须在隐私条款中明确承诺，承诺后必须做到 |
| C 最长 | 180 天 | 365 天 | 审计追溯最完整 | 个人数据留存最久，合规解释成本最高 |

- **本地与线上状态**：`config/ugc.js` 仍标 `pending_confirmation`，表示尚未部署和验收，不能再解释为业务期限未裁决。上线前须先完成隐私指引、清理实现与触发器验收并留截图。
- **清理纪律**：T-1 只改状态、不清正文；T-2 独立按严格 30 天边界清正文，若仍为 pending，先补标 expired；过期标记与正文清理各自留痕，不得用 `delete_request` 冒充系统保留事件。正文删除后保留符合八字段口径的最小摘要；用户主动删除请求见 §7.7。
- **T-2 本地实现（云端待验收）**：`purge` 不直接处理 pending；返回超期 `needsMark`，由独立 T-1 标记及审计恢复完成后再清。终态候选满足 `createdAt < now-30×24h`、状态为 approved/rejected/expired、`payload != null`；若 `retention.audit.state='pending'` 则延后处理并保留标记。按 `retention.purge.retryAfter/createdAt/_id` 稳定排序和有界批次逐次消退；写入前以 `_id+status+rev+payload 非空` 条件更新，只将正文置 null、写 `payloadRedactedAt` 与待补清理审计标记，保留记录外壳及 `verifyStatus`。`retention_purge` 逐条事件使用稳定 ID，可由下一次 purge 自动补记；日志与正文写入不在同一事务，真实云端原子性、索引及调度均待验收。批次互斥分类为 `purgedAudited/auditFailedCount/deferredAudit/deferredRetry/skipped/conflicts/failed/unprocessed`，其和等于 `selected`，`purged=purgedAudited+auditFailedCount`；另报 `needsMark` 与清理审计恢复结果。
- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。`recoverPending` 在相同鉴权下按 `retention.audit.state='pending'` 查询，并按 `retryAfter/createdAt/_id` 稳定排序、限批处理；成功项退出队列，失败项延后一分钟，重复触发可继续处理下一批而不依赖偏移量。每批 `selected=recovered+deferred+conflicts+failed+unprocessed`；真实复合索引、数据库原子性和进程中断行为未验收，不得把本地模拟称为云端可靠恢复。
- **R-3 批次审计与只读对账（本地实现，云端待验收）**：`mark`/`purge` 沿用 `retention_mark`/`retention_purge` 运行日志；有实际待补记录的 `recoverPurgePending` 与每次 `recoverPending` 也各写 `prepare` 和 `complete`，`result.stats.operation` 区分动作，`batchId` 在同次执行中固定。恢复批次的 `selected=recovered+deferred+conflicts+failed+unprocessed`；准备日志失败则不处理记录，收尾日志失败不得返回批次完成。逐条审计仍用原稳定事件 ID，`upload_logs` 永远只追加。
- **R-3 对账阈值与范围**：维护令牌保护的 `reconcile` 只读动作一次只查 `retention_mark` 或 `retention_purge` 一个事件，按 `(event,_id)` 升序做 `_id > cursor` 续页；单页最多 **50** 条、单次最多 **500** 条，超过时返回 `truncated=true/nextCursor`，未配对项为 `unmatchedWindow`、窗口内配对项为 `pairedWindow`，均不得冒充全局孤儿或闭合。完整扫描且无续页时，以相同 `event+operation+batchId` 配对；从 prepare 的 `at` 起满 **10 分钟（≥600000 ms）** 且无 complete 才标“疑似孤儿”，未满为“运行中”，不代表数据丢失。另识别 complete 无 prepare、重复 prepare/complete、计数不守恒、关联 ID/日期/时间缺失或不合法。对外只返回批次 ID 的稳定哈希引用 `batchRef`，不返回原始 ID、正文或身份。旧日志缺 operation 时只按事件推断为 mark/purge；跨窗口配对和大于 500 条的全局对账仍需后续只读聚合或可持久的游标状态方案及真实云端索引验收，不能把本地有限扫描说成全量对账。
- **R-3 批次结果裁决（2026-10-29，本地实现）**：`closed` 仅表示 prepare 与 complete 配对、计数闭合的生命周期结束，不表示成功。对账项独立返回原日志 `completeCode` 与归一化 `outcome`：`COMPLETE → OK`、`PARTIAL → PARTIAL`、`FAILED → FAILED`、`DEFERRED → DEFERRED`；`counts.outcomes` 分别计数。完整扫描仅有 `OK` 批次且无结构异常时才整体 `ok=true/code=OK`；存在 `PARTIAL` 或 `FAILED` 时整体 `ok=false/code=RECONCILE_ANOMALIES`，仅有 `DEFERRED` 时为 `ok=false/code=RECONCILE_DEFERRED`。若日志声称 `COMPLETE/DEFERRED` 却有失败计数，归 `countMismatch`。截断与结构异常沿用原有分类优先级，历史日志只追加，不改写。正常 COMPLETE 批次的 `closed` 与整体 `OK` 保持兼容。

---

## 四、管理员权限与审计

### 4.1 身份只来自服务端上下文

- 管理员身份 = `cloud.getWXContext().OPENID` **且** 命中环境变量白名单（复用 `cloudfunctions/seed/index.js:255-285` 的范式）：
  - 变量未配置 / 空串 / 纯空白 / 只有分隔符 → **一律拒绝**（fail-closed，不存在"空配置等于放行"）；
  - 每次调用读 `process.env`，不在模块加载时缓存；
  - 不做大小写归一（OPENID 区分大小写）；
  - 拒绝原因分级（`ADMIN_OPENIDS_NOT_CONFIGURED` / `NO_OPENID` / `NOT_ADMIN`）返回给调用方，但**任何响应都不含白名单内容**。
- 绝不读取入参里的 `openid` / `role` / `isAdmin`。客户端传来的身份字段一律丢弃并记 `denied`。

### 4.2 未授权用户不能做的事（验收必须逐条覆盖）

| # | 行为 | 期望 |
|---|---|---|
| A1 | 直接 `db.collection('submissions').get()` | 拒绝（权限档位为仅管理端；不得返回任何文档） |
| A2 | 直接 `add/update/remove` 投稿表 | 拒绝（`-502003 DATABASE_PERMISSION_DENIED` 或等价） |
| A3 | 调 `review` 云函数（非白名单） | 403，且**不泄露**待审数量、字段名、动作清单 |
| A4 | 调 `review` 并传 `openid=管理员` | 仍 403（身份只取上下文） |
| A5 | 提交时传 `status=approved` | 被忽略，落库 `pending`，写 `denied` 行 |
| A6 | 通过 `submissionId` 猜读他人投稿 | 403（非本人且非管理员） |
| A7 | 遍历 `clientToken` / `_id` 探测存在性 | 响应不区分"不存在"与"无权限"（统一 403/404 语义） |

### 4.3 入口与页面

- 页面：`pages/review/`（非 tabBar，不进任何导航、不进分享卡片、不加 `onShareAppMessage`）。
- 页面必须在 `app.json` 的 `pages` 注册（否则无法编译），但**入口为零**：不添加任何按钮/链接/二维码。
- 页面进入即调用 `review` 的 `session` 动作；403 → 显示"无权限"，且**不渲染任何数据、不留缓存、不写 storage**。
- 页面不得把"是否管理员"写入 `storage`/全局变量作为后续判断依据（每次请求都由服务端判定）。

### 4.4 审核操作与二次确认

| 操作 | 前置 | 二次确认 | 审计 |
|---|---|---|---|
| 列表（`pending` 优先） | 服务端鉴权 | 否 | 不记录（避免噪声） |
| 查看详情（含原文） | 服务端鉴权 | 否 | 可选（敏感操作才记） |
| 通过 | `status=pending` 且 `security.state ∈ {pass, review}` | 是（展示"通过后仅作建议，不会公开"） | `review_approve` |
| 驳回 | `status=pending` 且 `reasonCode` 非空 | 是 | `review_reject` |
| 拒绝通过（安全未完成） | `security.state='error'` | — | 按钮置灰 + 提示原因 |

### 4.5 审计不可改写

- `upload_logs` 只允许 `add`；不存在更新/删除接口。管理员也不能删日志。
- 状态迁移与日志写入的顺序：先写 `submissions`（带 `expectedRev` 乐观锁），后写日志；日志失败 → 写 `alarm` 行并返回 500（**不谎报成功**）。
- 任何"补写历史"的需求一律拒绝：审计只记当时事实。

### 4.6 越权测试点（阶段 B 必测）

1. 非管理员 × 7 个动作（§4.2 A3–A7 + 列表/详情）全部 403。
2. 管理员白名单为空时，连合法管理员也被拒。
3. 客户端直接读写两集合全部失败。
4. 伪造 `openid`/`role` 字段全部无效。
5. 日志中不出现明文 openid、不出现用户原文全文、不出现任何 token。

---

## 五、数据真实性与生成器边界

### 5.1 三道隔离（任何一条被破坏，MVP 立即停止）

| 隔离 | 规则 | 现状依据 |
|---|---|---|
| **ID 隔离** | 投稿记录**不得**拥有 `dishId`；**不得**写入 `tools/pilot/id-map.json`；不得分配 `c01_dNNN` 号段 | 映射 104 条冻结、`entries` 全 `active`、`orphans=0`；只 `add-only`、退役不复用（`docs/RECORD_GENERATOR_CONTRACT_20261023.md:391-470`） |
| **可信度隔离** | 投稿 `verifyStatus` 恒 `unverified`、`verifiedAt` 恒 `null`；`approved` 不产生任何可信度提升 | `data/provenance.js:228-260`：`verified` 需来源 ∈ `official/merchant/user/web/field` + `detail` 非空 + 日期严格合法 + `web` 需 `ref`；投稿默认 `detail` 为空 |
| **资格隔离** | 投稿 `importEligibility` 恒 `blocked`；不存在 `candidate_only` 升格通道 | C17 枚举只允许 `blocked`/`candidate_only`；C19 要求 `candidate_only` 计数当前必须为 0，>0 报 `E11_UNEXPECTED_ELIGIBLE` 并整体失败（`:309-316`） |

### 5.2 `approved ≠ verified`

审核通过只说明两件事：**内容合规**（安全检测 + 人工确认）与**信息完整**（字段齐备）。它**不说明**这条信息在现实中成立。要让一条数据变成 `verified`，必须同时具备：可追溯来源、来源说明非空、`verifiedAt` 是合法的过去日期（`web` 还需链接）。这三项都由现场核实/凭证环节产生，与"用户说了什么"无关。

### 5.3 `PUBLISH_OK ≠ 发布许可`

`PUBLISH_OK` 只表示 S1–S10 十阶段流水线与结构自洽通过（`docs/RECORD_GENERATOR_CONTRACT_20261023.md:1174-1191`），**不解除**任何证据阻塞，也不构成上线许可。当前三项正式产物均不存在，490 条候选**全部** `blocked`，525 条 blockers 如实保留。

### 5.4 阻塞必须保留（不得因"有人投稿"而消解）

| 阻塞类型 | 处理 | 禁止 |
|---|---|---|
| 价格冲突（同一菜品双值） | 两侧数值都保留，标 `price_conflict`，等现场核实 | 用投稿值覆盖任一现有值 |
| 档口不明确 | 标 `stall_unknown`，记录不进入可导入候选 | 由投稿人指定档口 |
| 来源不充分 | 标 `source_insufficient` | 把"用户说"当来源证据 |
| 名称待定 | 保留暂定名 + `name_pending` | 用投稿名替换正式名 |

### 5.5 未来如何由运营人员核实并接入（阶段 D，独立审批）

1. 运营者按 `tools/REAL_DATA_COLLECTION_SPEC.md` 现场核实，产出**新的取证材料**（照片/公示/凭证），而不是引用投稿原文。
2. 走**独立规划轮**：新增记录/改价分别对应新的 CSV 批次与新的候选计划。
3. 生成新的 `approvalRef`（`ap-*`）与新的 `planDigest`；**不得复用** `ap-20261025-01` / `4ed23cb4…9981ce`。
4. 运行既有生成器（P1 十阶段），产物必须满足 E17 读侧六条件（`:1222`）后才可作为输入。
5. 经 CSV 导入工具与 `tools/verify_data.js` 校验，人工合并进 `data/dishes.js`。
6. 全程与 `submissions` 表**没有代码级耦合**：接入的是"运营者核实后的新数据"，不是"投稿记录"。

### 5.6 不得触碰的清单（本 MVP 全程）

`tools/pilot/id-map.json`、`docs/decisions/ID_MAP_T48_T49_20261025.json`、`tools/pilot/approvals/ap-20261025-01.json`、`tools/pilot/init-plans/ip-20261025-01.md`、`tools/pilot/gen_records.js`、`docs/RECORD_GENERATOR_CONTRACT_20261023.md`、三项正式产物、`data/dishes.js` 的业务语义、`utils/cloudRepo.js` 的三集合白名单（`:43-47`）。

---

## 六、微信平台合规决策

### 6.1 两种性质完全不同的"UGC"

| 维度 | 路径 A：私下向运营者提供资料 | 路径 B：公开传播用户原创内容 |
|---|---|---|
| 谁能看到用户原文 | 仅运营者（管理员） | 全体用户 |
| 是否构成"传播/公开访问" | 否 | 是 |
| 当前主体+类目是否有依据 | **有**（信息查询不排除"向服务者反馈"） | **无**（个人主体无 UGC 类目） |
| 是否仍需内容安全检测 | **需要**（运营规范 5.18/10.2：存在 UGC 即须检测） | 需要 |
| 是否需要 UGC 场景声明 | **需要**（后台声明项，未声明即为事实不符） | 需要 |
| 本 MVP 选择 | ✅ | ❌（阶段 C 才讨论） |

> 关键判断：路径 A 的合法性**不来自**"投稿内容不被公开"这一事实本身，而来自"对外展示的始终是运营者自己撰写/核实的内容"。因此任何把用户原文直接搬到前端的做法（包括"用户贡献"角标、原文摘录、截图展示）都会把 A 变成 B。

### 6.2 当前类目依据（`[官方原文]`，可复核）

- 个人主体「工具」类目包含「信息查询」，资质要求栏为空；同类目内对 UGC 的排除原文要点：备忘录「不涉及用户原创内容的传播及公开访问」、记账排除「提供用户自定义生成内容记录及分享」。
- 个人主体类目列表中**不存在**「社区/论坛」「笔记」等 UGC 类目（此类只出现在非个人主体列表）。
- → 结论：**公开展示用户投稿在当前主体+类目下没有依据**；本文不假设"以后可能会放宽"。

### 6.3 待官方后台确认清单

| # | 事项 | 当前证据 | 状态 | 阻塞级别 | 确认方式 |
|---|---|---|---|---|---|
| P1 | 「用户生成内容场景声明」 | 后台截图：**未声明** | `[后台截图]` 已确认缺口 | **上线阻塞** | 后台提交声明（只查看要求，不代填） |
| P2 | 隐私保护指引是否覆盖投稿（收集内容、用途、保留期、删除方式） | 指引「已更新」，文本不在仓库 | `[待后台确认]` | **上线阻塞** | 后台逐条比对，补齐三项条款 |
| P3 | 文本内容安全接口**权限** | 实测 `errcode=40003`（非 `48001`） | `[实测]` **已具备** | 已关闭 | 已由负责人授权实测 |
| P4 | 文本接口**配额**（次/日） | 「调用额度」页未列逐接口数值 | `[待后台确认]` | 灰度阻塞（影响限流参数） | 后台调用额度页 / 首次超限实测 |
| P5 | 图片接口 `media_check_async` | 未实测 | `[待后台确认]` | 阻塞图片功能（MVP 已关闭） | 需素材 URL 后单独实测 |
| P6 | 投诉举报承接方式与响应时限 | 客服 + 用户反馈入口存在 | `[后台截图]` 入口有，**流程未定义** | 上线阻塞（3.10/10.3） | 产品定义承接人与 SLA |
| P7 | 数据保留期与删除流程 | 期限已裁决，执行未验收 | `[待实现/验收]` | 上线阻塞（15.3） | 按 §3.5.2 完成 T-2、日志轮转、隐私声明与线上验证 |
| P8 | 管理员 `openid` 名单 | 未指定 | `[待确认]` | 灰度阻塞 | 负责人指定 |
| P9 | 审核员是否会被认定为"变相 UGC" | 无官方口径 | `[待确认]` 风险中 | 提审风险 | 提审说明中明确"不公开展示、仅纠错参考" |
| P10 | 内容安全接口 `scene` 参数在个人主体下的可填范围 | 未核实 | `[待后台确认]` | 灰度阻塞 | 首次调用按 `scene=1`，异常则记录原文 |

> 「接口页里看不到内容安全接口」**不能**推出"不可用"：该页管理的是客户端 `wx.*` 接口，`msgSecCheck`/`mediaCheckAsync` 是服务端 HTTP 接口（`docs/EVIDENCE_BACKEND_CHECK_20261026.md:24-25`）。同理，「内容风控页面可配置关键词」是**强证据但非权限结论**，权限只以实际调用返回为准。

### 6.4 内容安全：双轨而不是单轨（`[官方原文]`）

| 接口判定 | MVP 处置 | 依据 |
|---|---|---|
| `pass` | 可进人工队列；按比例抽查（建议 10%，记录抽查人） | 官方 FAQ：「API 判断为 PASS 的内容…可以按照一定比例抽查」 |
| `review` | 必须人工确认后才可通过；页面标注"接口建议人工审核" | 官方 FAQ：「API 判断为 REVIEW 的内容…需要人工确认」 |
| `risk` | 直接 `rejected(reasonCode=security_risk)`，不进人工队列、不向管理员展示原文 | 运营规范 10.2 + 5.18 |
| `error` / 超时 | 落库 `pending` + `security.state='error'`，**不可通过**，等待重试 | 失败关闭（§2.3） |

**硬规则**：任何人不得以"接口返回 pass"为唯一理由通过投稿；抽查记录缺失即视为流程缺陷。

### 6.5 隐私与数据保留（对应 P2 / P7）

隐私指引必须新增三条（每一项都要能被用户读到，而不是只写在代码注释里）：

1. **收集什么**：投稿文本（≤100 字）与你选择的菜品/档口标识；不收集昵称、头像、手机号、位置。
2. **用途**：仅供运营者核实与改进菜品信息；**不公开展示、不向第三方提供**。
3. **保留与删除**：已裁决投稿正文自创建起 30 天、审计明细 90 天、逐条摘要自生成起 180 天（§3.5.2）；清理和删除流程上线验收前不得对外声称已生效。你可申请删除；具体处理时限须与实际部署能力和隐私声明一致（审计行不保留正文）。

> 运营规范 15.3：服务终止后 24 小时内删除数据 —— 该义务同样适用于"项目停止运营"场景，需在阶段 B 的验收里以"删除演练"覆盖。

### 6.6 投诉举报（3.10 / 10.3）

- 入口：现有「客服」与「用户反馈」可用（`[后台截图]`），无需新建系统。
- 必须有：承接人、响应时限（建议 2 个工作日）、处理记录（可复用 `upload_logs` 的 `delete_request`/`denied` 之外的独立工单，MVP 允许线下登记）。
- 不得宣称"已建立投诉机制"而实际无人承接。

### 6.7 一句话红线

**内容安全接口可用 ≠ 公开 UGC 获准。** 前者解决"内容是否合规"，后者是"主体+类目是否有资格"。本文的 MVP 只在前者上做文章，绝不由前者推导后者。

---

## 七、安全与异常处理

### 7.1 默认私有与最小权限

- 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
- 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending/purge/reconcile`。`reconcile` 只读且先鉴权，再验证扫描参数；`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。

### 7.2 输入校验（服务端独立复算）

| 项 | 规则 | 失败码 |
|---|---|---|
| 请求体大小 | ≤8KB | `PAYLOAD_TOO_LARGE` 413 |
| `kind` | 枚举内 | `INVALID_FIELD` 400 |
| `target` 三字段 | 非空、格式 `^c\d{2}_d\d{3}$` / `^c\d{2}_t\d{2}$`，且与云端文档一致 | `TARGET_MISMATCH` 409 |
| `payload.price` | 有限正数、最多一位小数、≤100 只警告不拒（D5 语义，`tools/verify_data.js:28`） | `INVALID_PRICE` 400 |
| `payload.note` | 1–100 字，NFKC 归一、折叠空白、拒绝全空白与不可见字符 | `INVALID_NOTE` 400 |
| `payload.nameSuggestion` | 1–20 字，同上归一 | `INVALID_NAME` 400 |
| 未定义键 | 拒绝（白名单），`status`/`review`/`verified`/`openid` 属保留键 | `RESERVED_FIELD` 400 |
| `photos` 非空 | 拒绝 | `PHOTO_NOT_SUPPORTED` 400 |

### 7.3 限流与去重

| 维度 | 阈值 | 实现 | 超限 |
|---|---|---|---|
| 单 openid 每日 | ≤10 次提交 | 查 `submissions` 近 24h 计数 | 429 + `retryAfter` |
| 单 openid 5 分钟 | ≤3 次 | 同上（`createdAt ≥ now-300s`） | 429 |
| 同一 `clientToken` | 幂等，不重复落库 | `(openid, clientToken)` 唯一 | 200 返回既有 `submissionId` |
| 同一 `dedupe.key` 待审中 | 不重复入队 | `dedupe.key` 唯一 | 409 + `dupOf` |

> 不使用内存计数器作为唯一依据（云函数实例会冷启动/扩容）；数据库计数为主，内存只做快速拒绝。

### 7.4 内容安全调用（超时与重试）

- 超时预算：单次 ≤4s，函数内最多 2 次（总 ≤8s）；整体超过 8s 判 `error`。
- 失败重试：持久重试最多 3 次、间隔 ≥10 分钟；超过 7 天仍失败 → `rejected(security_unavailable)`。
- 记录：`provider/version/errcode/rid/latency/attempts`；`errcode` 原样记录（`48001` = 未授权，`45009` = 频控，**不猜含义**）。
- 不允许：把"接口不可用"降级为"跳过检测直接通过"。

### 7.5 审核失败与并发

- 审核必须带 `expectedRev`；`rev` 不匹配 → 409，管理员以重新读取的状态为准。
- 同一 `submissionId` 的两次通过请求，第二次必然 409（终态不可再迁移）。
- 日志写失败 → `alarm` 行 + 500；不返回"审核成功"。

### 7.6 越权与探测

- 统一错误语义：非本人且非管理员 → 403；不存在 → 404；两者**不区分细节**（避免枚举）。
- 响应中不含：集合名、字段清单、栈信息、白名单、文档总数。
- 频率异常（同一 openid 连续 403）→ `denied` 行 + 计数，可用于人工封禁（MVP 不自动封）。

### 7.7 删除请求

1. 用户申请删除（客服/用户反馈/页面说明的渠道）→ 管理员核对 `openid` 与 `submissionId` 归属。
2. **24 小时内**物理删除 `payload` 正文（`note`/`nameSuggestion`/`price`）并置 `status=rejected(reasonCode=user_deleted)`；`submitter.openid` 同时替换为 `deleted` 占位。
3. 保留匿名审计行（`submissionId` + 动作 + 时间 + `openidHash`），不含任何内容。
4. 删除动作写 `delete_request` 行；该行**不可被后续操作覆盖**。

### 7.8 日志纪律（禁止写入）

- 禁止：AppSecret、`access_token`、会话密钥、白名单原文、用户正文全文、任何图片外链。
- 禁止：把 `console.log` 的用户对象整包打印（可能夹带 `openid`）。
- 允许：长度、标签、耗时、错误码、`rid`、哈希后的标识符。

### 7.9 错误码表（云函数返回，前端只按码显示文案）

| 码 | HTTP | 含义 | 是否可重试 |
|---|---|---|---|
| `NO_OPENID` | 401 | 无服务端身份 | 否 |
| `FORBIDDEN` | 403 | 非管理员 / 非本人 | 否 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体超限 | 否 |
| `INVALID_FIELD` / `INVALID_PRICE` / `INVALID_NOTE` / `INVALID_NAME` | 400 | 字段非法 | 修正后 |
| `RESERVED_FIELD` | 400 | 含保留键 | 否 |
| `PHOTO_NOT_SUPPORTED` | 400 | 传了图片 | 否 |
| `TARGET_NOT_FOUND` | 404 | 目标不存在 | 否 |
| `TARGET_IS_DEMO` | 422 | 目标是演示数据 | 否 |
| `TARGET_MISMATCH` | 409 | 目标三元组不一致 | 否 |
| `TARGET_NOT_VERIFIABLE` | 422 | 目标不属可纠错批次 | 否 |
| `DUPLICATE` | 409 | 命中待审去重 | 否（等原记录） |
| `RATE_LIMITED` | 429 | 超限 | 按 `retryAfter` |
| `SECURITY_UNAVAILABLE` | 503 | 检测不可用 | 是（后端重试） |
| `STATE_CONFLICT` | 409 | `rev` 不匹配 | 刷新后 |
| `DATABASE_ERROR` | 500 | 落库失败 | 是（幂等） |
| `INTERNAL` | 500 | 未分类 | 有限次 |

---

## 八、分阶段实施与验收

### 阶段 A：文档与后台资格确认（本轮所在阶段，只读）

- **交付**：本文 + 待确认清单（§6.3）+ 只读测试结果。
- **验收**：
  1. 本文八章齐备，且每条未确认事实都有 `[来源]` 或 `[待确认]` 标记；
  2. `node tools/check_eol.js` 退出码 0（新文档纳入强制范围，计数字段以实测为准）；
  3. `git diff --check` 退出码 0；新文档 UTF-8 无 BOM、全 LF、末尾恰一个换行；
  4. `git status --short` 仅新增本文，无其它改动、暂存区为空；
  5. P1–P10 中每一项在后台都有明确归属人（负责人填写，本轮不代填）。
- **门槛（禁止越过）**：不得因为"文档写完"就认为合规已完成；不得据本文去申请类目或提交声明。

### 阶段 B：私有投稿与审核（需单独授权后实施）

- **交付**：2 个云函数（`submit`/`review`）、1 个隐藏页 `pages/review/`、2 个集合与权限、隐私条款与 UGC 声明（由负责人操作后台）。
- **验收（可执行、逐条可复现）**：
  1. 单测覆盖 §2.2 每个阶段的成功/失败/重试/审计分支，且**共享夹具失败时逐用例独立登记**；
  2. 越权测试 §4.2 A1–A7 全绿；
  3. 内容安全注入测试：`pass`/`review`/`risk`/`error`/超时五种返回都能触发对应处置，`error` 时无法通过；
  4. 幂等测试：同一 `clientToken` 两次提交只产生一条记录；
  5. 状态机负例：`approved → pending`、客户端直写 `status` 均被拒；
  6. 删除演练：申请删除后 24 小时内正文消失、审计行仍在；
  7. 日志抽查：无明文 openid、无正文、无 token；
  8. 部署后云端权限实测：客户端读两集合失败（记录错误码原文）。
- **门槛**：不得写 `data/dishes.js`、不得生成三项正式产物、不得改 `id-map.json`、不得写入云端 `dishes`；B1/B2/B6 未关闭不得对外灰度。

### 阶段 C：公开展示决策（默认不发生）

- **前置**：主体/类目变更为允许 UGC 的类目（个人 → 企业/个体工商户），且后台明确允许公开 UGC；内容安全全族（含图片）可用；巡查机制与投诉工单就绪。
- **交付**：新的类目证据截图、公开读接口设计、举报闭环设计。
- **验收**：任一项前置未满足 → 本阶段**不启动**；不得以"先灰度公开"作为推进方式。
- **门槛**：阶段 C 的启动必须由负责人以书面决策触发，本轮不做任何预设。

### 阶段 D：正式数据接入（独立审批）

- **前置**：阶段 B 已闭环 ≥1 个真实批次；运营者完成现场核实；新 `ap-*` 审批与新 `planDigest`；生成器 E17 读侧六条件通过。
- **验收**：`records.json`/`records_blockers.json`/`gen-manifest.json` 由既有 P1 链路在独立临时目录产生；`COMMITTED` 存在；`PUBLISHING` 不存在；manifest 五字段严格相等；sha256 回读一致；`verifyStatus` 未被提升；导入后 `tools/verify_data.js` 全绿。
- **门槛**：不得把 `submissions` 直接当输入；不得复用旧审批与旧 digest；不得跳过 CSV 导入工具。

### 全局门槛表（任何阶段都成立）

| 门槛 | 判据 |
|---|---|
| 不公开 | 前端任何页面都不出现用户原文、投稿人标识、"用户贡献"角标 |
| 不自动接入 | `data/dishes.js`、`id-map.json`、三项产物、云端 `dishes` 在 MVP 中零写入 |
| 不抬升可信度 | `verifyStatus` 恒 `unverified`；`verifiedAt` 恒 `null` |
| 不放宽断言 | 测试失败不得通过修改断言转绿 |
| 不越权 | 管理员判定只在服务端；客户端零身份判定 |

---

## 九、未决事项与停止条件

### 9.1 未决（需负责人决策，本文不代决）

1. **P1–P10 归属人与时限**（§6.3）。
2. **是否接受路径 A 的"变相 UGC"提审风险**（风险中，需产品签字）。
3. **保留期实施与验收**（期限已在 §3.5.2 裁决；T-2、日志轮转、隐私声明和真实云端验证仍阻塞上线，见 P7）。
4. **管理员人数与轮值**（单点会有不可用窗口）。
5. **是否允许"用户收到审核结果通知"**（当前设计不通知；通知本身会引入新的合规面——需单独评估）。

### 9.2 停止条件（本轮）

若完成本文必须修改现有契约、映射、审批文件、代码或云端资源，则立即记录为后续事项，**不扩大授权**。本轮已确认无需任何此类改动。

### 9.3 本轮边界声明

- 零代码改动、零集合创建、零云函数部署/调用、零权限变更、零云数据库写入。
- 零正式产物生成；未改 `id-map.json`、审批文件、初始化计划、冻结副本。
- 零 Git 写操作（仅新建本文档，未暂存、未提交）。
- 未把任何 `unverified` 改为 `verified`；未把任何推测写成平台规则。
