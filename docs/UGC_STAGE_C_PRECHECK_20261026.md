# UGC 阶段 C 联调前置审查报告

> 状态：**只读审查**。本轮未部署、未建集合、未改权限、未调用任何云函数、未改云端环境变量，也未修改现有代码、冻结映射、审批文件、初始化计划与生成器契约。
> 口径四档：**已实测（本地）** / **有官方依据** / **待云端验证** / **未实现**。本地模拟通过不等于云端安全验证通过。
> 适用对象：负责人（微信后台操作与决策）、本端（代码侧验证与证据整理）、运营（审核与投诉承接）。

---

## 0. 本轮范围

- 审查输入：`docs/INTEGRATION_CHECKLIST_UGC_20261026.md`（107 行）、`docs/UGC_MVP_DESIGN_FINAL_20261026.md`（558 行）、`docs/UGC_MVP_COMPLIANCE_GAP_REVIEW_20261026.md`（297 行）、`cloudfunctions/submit/index.js`（686 行）、`cloudfunctions/review/index.js`（533 行）、`pages/submit/*`、`pages/review/*`、`config/ugc.js`、`config/cloud/*`、`tools/test_ugc_submit.js`、`tools/test_ugc_review.js`。
- 产出：本文件。**没有第二处改动**。
- 只读测试：12 个套件 + `check_eol`，实际结果见 §11。

---

## 1. 结论摘要

| # | 审查重点 | 结论 | 状态 |
| --- | --- | --- | --- |
| 1 | 纠错目标引用 ≠ 投稿记录获得正式 `dishId` | 成立，代码有三道防线（§2） | 已实测（本地） |
| 2 | 集合必须「仅管理端可读写」，客户端不可直读投稿与审计 | 配置草稿正确，**云端未应用**（§3） | 待云端验证 |
| 3 | `ADMIN_OPENIDS` / `UGC_LOG_SALT` 要求与未配置行为 | 机制 fail-closed，真实值未配置（§4） | 待云端验证 |
| 4 | `security.msgSecCheck` 真实验证步骤与证据要求 | 权限证据存在（`40003`），配额/场景/图片未验（§5） | 部分确认 |
| 5 | 入口、隐私、删除、投诉、UGC 声明、灰度 | 六项均未闭合，逐项给出责任方与关闭条件（§6） | 未实现 / 待确认 |
| 6 | 不可妥协的安全条件与可延后改进 | 已分列（§9） | — |
| 7 | 每项云端变更的前后状态、验证与恢复 | 已列表（§8） | — |

**需要负责人先看的三个判断**

1. `target.dishId` 可以保留，但它只是"纠错指向哪道菜"的引用，**不是**给投稿记录分配身份；顶层 `dishId` 一律拒绝（裁决见 §2，未来命名建议见 §2.4）。
2. 阶段 C 联调**不需要**先关闭 B1（UGC 声明）、B2（隐私条款）、B6（类目结论），但这三项不关闭就**不得对公众灰度**；联调阶段只能停留在管理员/体验版范围。
3. 设计定稿里「submissions 90 天 / upload_logs 180 天」是**提案，不是已批准规则**，与本轮"保留期不得擅自认定"的口径冲突，需授权后修订（§10 D1）。

---

## 2. `dishId` 语义裁决

### 2.1 裁决

| 字段 | 语义 | 允许由谁产生 | 当前实现 |
| --- | --- | --- | --- |
| 顶层 `dishId` | 投稿记录的**身份字段**（等价于"这条纠错被分配了哪个正式菜品 ID"） | 任何一方都不允许 | 客户端传入即 400 `RESERVED_FIELD` 并记 `denied` 日志（`cloudfunctions/submit/index.js:51-56`、`:493-502`） |
| `target.dishId` | **纠错目标引用**：这条纠错指向一道已存在的公开菜品 | 只能由用户在表单里选择/带入；服务端只校验、不赋值 | 允许为 `null`；非空时必须命中 `dishes` 且 `dataClass==='field_unverified'`（`cloudfunctions/submit/index.js:434-459`） |

判定「引用」与「身份」的分界线只有一条：**approved 之后，任何 `dishes` 文档都不会因为这条投稿而增加字段或改变状态，`target.dishId` 也不会回流成记录的 `dishId`**。这一点有代码与测试双重证据（§2.2、§2.3）。

### 2.2 证据

| 证据点 | 位置 | 结论 |
| --- | --- | --- |
| 保留字清单含 `dishId`，且只对顶层生效 | `cloudfunctions/submit/index.js:51-56` | 顶层 `dishId` 走拒绝分支 |
| 保留字触发时先写 `denied` 审计再返回 400 | `cloudfunctions/submit/index.js:493-502` | 越权尝试留痕，不被静默吞掉 |
| 目标白名单只允许 `dishId`/`stallId`/`shopId` 三个键 | `cloudfunctions/submit/index.js:47` | `target` 不能夹带其它身份字段 |
| 目标校验读多写零：只 `get` 菜品与档口 | `cloudfunctions/submit/index.js:434-459` | 无任何 `update`；静态测试 A5 断言源码无 `collection(...).update/remove` |
| 落库字段写死 `verifyStatus:'unverified'`、`verifiedAt:null`、`importEligibility:'blocked'` | `cloudfunctions/submit/index.js:602-628` | 投稿永远不获得"已核实"身份 |
| approve 只改 `submissions` 文档，不碰 `dishes` | `cloudfunctions/review/index.js:258-320`（`transition` 在 `:196-202`，只 `where({_id, rev}).update`） | 审核通过不等于改写菜品 |
| 测试断言 approve 后菜品集合无变化 | `tools/test_ugc_review.js` E 段（"审核不写菜品库"）I3 | 本地行为已锁死 |
| 测试断言客户端传顶层 `dishId` 被拒 | `tools/test_ugc_submit.js` C 段 | 已实测 |

### 2.3 三道防线

1. **入口拒绝**：顶层 `dishId`、`status`、`reviewerOpenid`、`verifyStatus`、`role`、`openid`、`isAdmin` 等一律 400。
2. **服务端不推断**：`target.dishId` 为空就存 `null`，绝不从演示数据、候选 ID 或冻结映射里"补一个"；非空则必须能在 `dishes` 里查到且为 `field_unverified`，否则 404/422。
3. **通过后不写库**：审核只更新 `submissions`，`importEligibility` 恒 `blocked`；即便 approved，也不产生 `records.json`、不写 `data/dishes.js`、不改 `id-map.json`。

### 2.4 未来命名建议（本轮不改接口）

`target.dishId` 的语义是"引用"，但字段名与"记录身份"同形，长期有被误读、被复用到身份赋值的风险。建议在**未来单独授权**的版本里改为：

- `target.dishRefId`（推荐）：明确"引用某道公开菜品"；`submissions` 顶层继续不出现任何 dish 身份字段。
- 迁移策略：`schemaVersion` 从 1 升到 2；服务端**双读单写**（同时接受 `dishId` 与 `dishRefId`，新记录只写 `dishRefId`）；保留一个版本后停止接受旧名；`config/cloud/schema.submissions.json` 与隐私/协议文案同步。
- 成本与影响：涉及 `submit`、`review` 两个函数、`pages/submit`、schema 草稿、两个测试文件、本文档与联调清单；**本轮不动**，仅登记为技术债。

---

## 3. 集合权限核对

### 3.1 期望 vs 现状

| 集合 | 期望权限 | 配置草稿 | 云端现状 |
| --- | --- | --- | --- |
| `submissions` | 仅管理端可读写；客户端 read/write 均为 false；云函数可读写 | `config/cloud/permissions.json:15-24` | **集合不存在**，权限未配置 |
| `upload_logs` | 仅管理端可读写；客户端 read/write 均为 false；云函数只 add | `config/cloud/permissions.json:25-34` | **集合不存在**，权限未配置 |

**关键提醒**：现有业务集合 `restaurants`/`stalls`/`dishes` 的历史状态是「所有用户可读」（`docs/COLLECTION_STATUS_REPORT_20261023.md:51`）。新集合**不得照抄**该状态，否则 `submissions` 的正文与 openid 对任何客户端可读——这是本轮最需要盯住的一条。

### 3.2 验证方法（三条独立证据，缺一不通过）

1. **控制台证据**：集合权限页截图，显示"仅管理端可读写"（或自定义规则 `read:false, write:false`）。
2. **客户端直连证据**：在开发者工具里用普通用户身份执行 `wx.cloud.database().collection('submissions').get()`，必须返回权限拒绝（错误码通常 `-502003` 一类），**不能返回空数组**（空数组也可能是"查询成功但无数据"，不能当作权限生效）。
3. **云函数证据**：管理员 `list` 能读到待审记录、`upload_logs` 有对应行——证明云函数运行身份没有被误伤。

### 3.3 通过证据与失败处置

| 项 | 通过证据 | 失败停止条件 | 恢复 |
| --- | --- | --- | --- |
| `submissions` 权限 | 截图 + 客户端拒绝码 + 云函数可读 | 客户端能读到任何一条投稿正文或 openid | 立即改回"仅管理端"，删除已建索引重来，**不得继续 C2 之后步骤** |
| `upload_logs` 权限 | 截图 + 客户端拒绝码 + 云函数只 add 成功 | 客户端可读审计日志 | 同上；并检查是否有客户端直连代码 |
| 索引 | 控制台索引列表截图（5 + 3 条） | 唯一索引建不出来（平台限制） | 记录限制，改为应用层幂等（已有 `clientToken` 查询），并在清单标注降级 |

---

## 4. 环境变量核对

### 4.1 配置要求

| 变量 | 归属 | 必填 | 未配置行为 | 代码位置 |
| --- | --- | --- | --- | --- |
| `UGC_LOG_SALT` | `submit`（所有请求）、`review`（仅 approve/reject/delete） | 是 | `submit` 直接 500 `INTERNAL` 且**不落库**；`review` 变更类动作 500，`session`/`list`/`detail` 仍可用 | `cloudfunctions/submit/index.js:477-480`；`cloudfunctions/review/index.js:505-508` |
| `ADMIN_OPENIDS` | **仅 `review`**；`submit` 完全不读 | 是（review 全部动作） | 403 `FORBIDDEN` + `reason=ADMIN_OPENIDS_NOT_CONFIGURED`，且零数据库调用 | `cloudfunctions/review/index.js:86-88`、`:496-499` |

补充规则：

- `ADMIN_OPENIDS` 解析：按 `[\s,;，；]+` 切分、去重、保序（`cloudfunctions/review/index.js:66-92` 区段），大小写不归一——openid 本身区分大小写，这是刻意的。
- 闸门顺序：**先鉴权、后动作白名单**（`:496-503`），非管理员连"有哪些动作"都探不到。
- `UGC_LOG_SALT` 只用于 `openidHash = HMAC-SHA256(openid, salt)`；日志与响应都不出现盐值、明文 openid 与正文（测试 L 段、M 段与 review A 段静态断言）。
- 轮换影响：盐一换，历史 `openidHash` 与新 hash 不可关联。若轮换，必须记录轮换时间点，并把旧盐销毁时间写入内部记录；否则审计追溯会断。

### 4.2 验证方法

1. 部署后先调用 `review` 的 `session`：管理员应 `ok:true`；换普通用户应 403 且 `reason` 可读。
2. 临时移除 `ADMIN_OPENIDS`（测试环境）→ 403 `ADMIN_OPENIDS_NOT_CONFIGURED`，确认 fail-closed 后再恢复。
3. 临时移除 `UGC_LOG_SALT` → `submit` 返回 500 且集合内**没有新记录**；`review` 的 approve 返回 500 且记录仍为 `pending`。
4. 恢复变量后重跑一次正常提交，确认 `upload_logs.actor.openidHash` 为 32 位十六进制、且与明文 openid 不同。

### 4.3 证据与失败处置

- 通过证据：两次故障注入的返回码截图 + 集合前后条数对比 + 日志 hash 样例（只截图前 8 位）。
- 失败停止条件：未配置时仍能读/改数据；日志出现明文 openid 或正文全文；盐值出现在返回值里。
- 恢复：删除变量即回到 fail-closed；若已产生带明文泄露的日志，按事故流程删除对应日志并记录。

---

## 5. `security.msgSecCheck` 真实验证

### 5.1 现行实现口径

- 调用参数：`content`（`note` + 换行 + `nameSuggestion`）、`version:2`、`scene:1`、`openid`（`cloudfunctions/submit/index.js:296-308`）。
- 超时与重试：单次 4s、最多 2 次（`LIMITS.SECURITY_TIMEOUT_MS` / `SECURITY_ATTEMPTS`，`:58-66`）。
- 结果分类：`pass`/`review`/`risk`/`error` 四态；`errCode!==0`、异常、超时、超时后仍失败 → 一律 `error`，**绝不判 pass**（`:310-330` 区段 `classifySecurity`）。
- 落库与审核：`error` 也落库为 `pending`，但审核端 approve 会被 503 拒绝（`cloudfunctions/review/index.js:276-281`，`APPROVABLE_SECURITY=['pass','review']` 在 `:66`）。

### 5.2 真实接口验证步骤（阶段 C 执行）

1. 用**测试文本**（不使用真实用户内容）调用一次正常内容 → 期望 `errCode=0`、`result.suggest='pass'`。
2. 调用一次明显风险样本（平台示例/公开测试语料）→ 期望 `suggest='risky'` 或 `errCode=87014`，落库 `state=risk`。
3. 用一条含敏感词但非明显违规的文本 → 观察是否 `review`；若平台只返回 pass/risk，则记录"review 分支在真实环境未观测到，本地仅为模拟"。
4. 记录每次的 `errCode`、`errMsg`、`rid`（若有）、耗时（`latencyMs`）。
5. 在云开发控制台「调用额度」页截图，记录当日已用/上限；若页面不显示逐接口数值，**标注「未取得配额数值」**，不得推定无限额。
6. 故障注入：断网/临时改域名不可行，改用一次超时（例如把 transport 指向不返回的测试桩只在本地做）——**云端故障注入不做**，以本地 `error` 分支测试为准（`tools/test_ugc_submit.js` J 段）。
7. 图片：本轮**不做**。若未来开放，需另测 `mediaCheckAsync`（异步回调、结果拉取、审核未回时的兜底），不得沿用文本接口结论。

### 5.3 错误码与判定表

| 观测 | 语义 | 落库状态 | 审核端 | 备注 |
| --- | --- | --- | --- | --- |
| `errCode=0` + `suggest=pass` | 通过 | `pass` | 可 approve | 仍建议人工抽查 |
| `suggest=review` | 需人工复核 | `review` | 可 approve（人工判断后） | 不得自动通过 |
| `suggest=risky` / `errCode=87014` | 明确风险 | `risk` | **503 拒绝 approve** | 需驳回并记录理由 |
| `errCode=40003` | openid 无效（权限已具备） | `error` | 503 | 真实调用若出现，先查 openid 是否为当前用户 |
| `errCode=48001` | 接口未授权 | `error` | 503 | 权限缺失，停止联调 |
| `-1` / 其它 | 系统错误 | `error` | 503 | 按故障处理，不计通过 |
| 超时（4s × 2） | 未知 | `error` | 503 | 记录耗时；若频发需评估限流参数 |

**证据要求**：每条路径保留 `{调用时间, errCode, suggest, rid, latencyMs, 落库 security.state}` 六项；配额页截图单独存档。没有这六项，不得在汇报中写"内容安全已验证"。

---

## 6. 运营与合规前置核对

| 项 | 当前状态 | 证据 | 联调前必须？ | 责任人 | 关闭条件 |
| --- | --- | --- | --- | --- | --- |
| 投稿入口 | **零链接**：`pages/**` 无 `navigateTo` 到 submit/review，只有 `app.json:7-8` 注册 | 本轮 grep（见 §11 复现） | 否（阶段 C 用开发者工具/体验版带参数进入） | 本端 | 阶段 D 再定是否加入口 |
| 隐私告知 | 草稿 `docs/DRAFT_PRIVACY_NOTICE_20261026.md`，**未上线**；隐私弹窗未实现 | 仓库无协议页；无 `onNeedPrivacyAuthorization` | **否（联调）** / 是（灰度） | 负责人 + 本端 | 后台指引含四项条款；提交页展示同意 |
| 删除渠道 | 接口在（`review` 的 `delete` 动作），**用户侧渠道未定** | `cloudfunctions/review/index.js` delete 分支；设计 §7.7 | 否（联调可用管理员代执行验证） | 负责人 | 指定渠道（客服/反馈）+ 24h 内执行人 |
| 投诉处理 | 入口存在（客服/用户反馈），**承接人与 SLA 未定** | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:19-20` | 否（联调） / 是（灰度） | 负责人 + 运营 | 承接人 + 时限（建议 2 个工作日）+ 记录方式 |
| UGC 场景声明 | **未提交**（后台表单为空） | `docs/EVIDENCE_BACKEND_CHECK_20261026.md:17`、`:141` | 否（联调） / **是（任何对外）** | 负责人 | 提交并留存审核结果 |
| 灰度条件 | 仅允许**体验版/管理员灰度**；真实用户开放依赖真实数据接入（阶段 D） | 设计定稿 `:47`（C11） | 是（联调即按此范围） | 负责人 + 本端 | 阶段 D 授权 |
| 主体与类目 | 个人主体「工具—信息查询」；**UGC 是否被允许无书面结论** | `docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:8-19` | 否（联调） / 是（灰度） | 负责人 | 书面确认或按路径 B 变更 |

> 阶段 C 的判定：以上"联调前必须=否"的项，**不阻碍在管理员范围内跑通 C1–C9**；但任何一项未关闭就向公众开放，属于越权。

---

## 7. C1–C9 执行卡

> 每项都写明"做完就停在哪一步"。任何一项失败，**停止后续步骤**，先修当前项，不带病往下跑。

### C1 部署与鉴权

- **依赖**：`submit`/`review` 两个函数已上传、`wx-server-sdk` 依赖安装完成、`ADMIN_OPENIDS` 与 `UGC_LOG_SALT` 已配。
- **责任方**：负责人（部署与环境变量）；本端（调用与判读）。
- **验证方法**：管理员调 `review.session` → `{ok:true, role:'admin'}`；普通用户调 → 403 `FORBIDDEN` + `NOT_ADMIN`；空 `ADMIN_OPENIDS` → 403 + `ADMIN_OPENIDS_NOT_CONFIGURED`。
- **通过证据**：三次调用的返回体截图（含 `requestId`）。
- **失败停止条件**：普通用户能拿到 `ok:true`；或未配置时仍可读列表。
- **回滚**：删函数或清空变量即失效。

### C2 首条投稿落库

- **依赖**：C1 通过；集合已建；`UGC_LOG_SALT` 已配。
- **责任方**：本端。
- **验证方法**：管理员用体验版/开发者工具提交一条 `price_fix`（目标选一条 `field_unverified` 的菜品），检查 `submissions` 出现 `pending` 记录、`upload_logs` 出现 `submit` 行。
- **通过证据**：两条文档的字段截图（隐藏 openid 明文，只显示 `openidHash` 前 8 位）+ 返回 `submissionId`。
- **失败停止条件**：返回成功但集合无记录；或记录里出现明文 openid、出现 `verifyStatus:'verified'`、出现 `importEligibility!=='blocked'`。
- **回滚**：删除该记录与对应日志；不改代码。

### C3 重复提交去重

- **依赖**：C2 通过；`dedupe.key+status` 索引存在。
- **验证方法**：同内容同目标再提交一次 → 409 `DUPLICATE` + `dupOf`；集合条数不变。
- **通过证据**：返回体 + 前后条数。
- **失败停止条件**：出现两条相同 `dedupe.key` 的 `pending`。
- **回滚**：删重复记录（若有）。

### C4 伪造字段

- **依赖**：C2 通过。
- **验证方法**：客户端构造带 `status:'approved'`、`reviewerOpenid`、`verifyStatus:'verified'`、`role:'admin'` 各一次的请求 → 均 400 `RESERVED_FIELD`；`upload_logs` 有 `denied` 行。
- **通过证据**：四次返回体 + `denied` 日志计数。
- **失败停止条件**：任意一次被接受。
- **回滚**：无（拒绝即正确）。

### C5 非管理员访问审核页

- **依赖**：C1 通过；`pages/review` 已在体验版可访问。
- **验证方法**：普通用户打开审核页 → 页面只显示"无权限"，无列表数据；再直接调 `review.list` → 403。
- **通过证据**：页面截图 + 403 返回。
- **失败停止条件**：页面渲染出任何一条投稿。
- **回滚**：无（403 即正确）。

### C6 管理员 approve

- **依赖**：C2 通过；记录 `security.state ∈ {pass, review}`。
- **验证方法**：带 `expectedRev=1` 调 approve → 记录变 `approved`、`rev=2`、`review.byOpenidHash` 为 32 位；`upload_logs` 有 `review_approve` 行；**`dishes` 集合无任何变化**。
- **通过证据**：记录前后 diff + `dishes` 条数/内容快照 + 日志行。
- **失败停止条件**：`verifyStatus` 被改为 `verified`；`dishes` 被写入；日志缺失。
- **回滚**：记录回滚为 `pending` 需管理员操作（表内 `rev` 已变，只能再 approve/reject 或由后续授权接口修复）；无法回滚的部分记录到内部台账。

### C7 管理员 reject

- **依赖**：C2 通过。
- **验证方法**：`reasonCode=inaccurate` + 理由文本 → `rejected`，`reasonText` 归一后落库；日志 `review_reject`（`errorCode=reasonCode`）。
- **通过证据**：记录 diff + 日志行。
- **失败停止条件**：reasonCode 非法仍被接受；日志缺失。
- **回滚**：同 C6。

### C8 删除请求

- **依赖**：C2 通过。
- **验证方法**：调 `delete` → `payload=null`、`payloadRedactedAt` 有值、`submitter.openid='deleted'`、`status='rejected'`、`review.reasonCode='user_deleted'`；`upload_logs` 有 `delete_request`。
- **通过证据**：记录 diff + 日志行；再调一次确认幂等。
- **失败停止条件**：正文仍可读；日志被删改。
- **回滚**：不可逆（正文已清除），执行前须确认测试数据可弃。

### C9 内容安全故障注入

- **依赖**：C2 通过。
- **验证方法**：云端**不做**故障注入；以本地 `tools/test_ugc_submit.js` J 段（含超时）为证据，云端只验证"真实风险样本 → `risk` → approve 503"。
- **通过证据**：风险样本记录 + 503 返回 + 本地 J 段测试输出。
- **失败停止条件**：`risk` 记录被 approve 成功；或接口故障被判 `pass`。
- **回滚**：无（拒绝即正确）；若记录已误通过，按 C6 的台账方式记录。

---

## 8. 云端变更：前后对照与恢复

> 所有变更在**阶段 C 授权后**由负责人执行；本端只给步骤、判据与恢复方式。

| # | 变更项 | 变更前 | 预期状态 | 验证方法 | 失败恢复 |
| --- | --- | --- | --- | --- | --- |
| 1 | 建集合 `submissions` | 不存在 | 存在，权限仅管理端，**联调必建 4 条索引**（`status+createdAt`、`submitter.openid+createdAt`、`submitter.openid+clientToken` 唯一、`dedupe.key+status`）；`security.state+status` 可延后 | 权限页截图 + 客户端直连拒绝 + 索引列表（逐条核对名称与字段） | 删除集合（无数据时零成本） |
| 2 | 建集合 `upload_logs` | 不存在 | 存在，权限仅管理端，3 条索引**可延后**（随清理任务与统计功能一起建） | 同上 | 删除集合 |
| 3 | 部署 `submit` | 不存在 | 运行中，环境变量就绪 | C2 成功且日志有 `submit` 行 | 删除函数或回滚版本 |
| 4 | 部署 `review` | 不存在 | 运行中 | C1 session + C5 403 | 删除函数 |
| 5 | 配 `ADMIN_OPENIDS` | 空 | 真实管理员 openid，去重保序 | 管理员 200 / 非管理员 403 | 删除即回到全拒 |
| 6 | 配 `UGC_LOG_SALT` | 空 | 32 字节 hex，不落任何文件 | 故障注入（移除）→ 500 且不落库 | 删除即回到 fail-closed；**轮换需记录时间点** |
| 7 | 后台声明 UGC 场景 | 未声明 | 已声明并通过 | 后台截图 + 审核结果 | 撤回声明（若允许） |
| 8 | 隐私指引补条款 | 未覆盖投稿 | 四项条款齐备并通过 | 指引全文截图 | 改回上一版并重提 |
| 9 | 页面收录屏蔽审核页 | `disallow` 已写但未在后台确认 | 审核页未被收录 | 公众平台"页面收录"截图 | 无需恢复（只是收录状态） |
| 10 | **存储地域取证（只读，无变更）** | 未记录 | 记录环境 ID 与地域同框截图 | 云开发控制台「环境设置/概览」→ 地域字段 | 无需恢复；未取得截图前标记「待验证」 |

**不可逆点**：C8 的正文清除、以及任何对真实用户数据的处理。阶段 C 全部使用测试数据，避免踩到不可逆点。

---

## 9. 不可妥协 vs 可延后

### 9.1 联调前不可妥协（八条，缺一不进入 C2）

1. `submissions` 与 `upload_logs` 权限为「仅管理端可读写」，客户端直连必须被拒（§3）。
2. `UGC_LOG_SALT` 已配；未配置时 `submit` 不落库、`review` 不变更状态（§4）。
3. `ADMIN_OPENIDS` 已配；未配置时全拒且零 DB 调用（§4）。
4. 内容安全四态判定正确，`error` 不判 pass、`risk` 不能 approve（§5）。
5. 日志不含明文 openid、正文全文、盐值、AppSecret/access_token（测试已锁）。
6. approve 不写 `dishes`、不改 `verifyStatus`、不生成正式产物（C6 判据）。
7. 审核页 403 时不渲染任何数据（C5 判据）。
8. 每步留证：返回码、截图、前后条数（§11 记录格式）。

### 9.2 可延后（不阻塞联调，但需登记）

1. 审核列表分页游标（当前固定 20 条，`cloudfunctions/review/index.js:211-222`）。
2. 驳回理由前端只固定 `inaccurate`（服务端已支持 9 种枚举）。
3. 举报/投诉工单系统（N9 明确不在 MVP）。
4. 审核结果通知用户（默认不通知）。
5. 图片上传与 `mediaCheckAsync`（当前整体关闭）。
6. 导出 `submissions_approved.json`（设计 C3 已推迟）。
7. `target.dishRefId` 命名迁移（§2.4）。
8. 索引调优与清理任务（保留期确认后一并做）。

**分界依据**：是否触及"数据暴露面、合规承诺、不可逆写入"。触及即硬条件；只影响效率、体验或未来扩展的，可延后。

---

## 10. 文档一致性发现与修订（D1–D4）

修订轮次：2026-10-26 第二次（下表「修订位置」为修订后的实际位置；设计定稿行号因扩写已整体后移）。

| 编号 | 原问题 | 修订位置 | 修订内容 | 状态 |
| --- | --- | --- | --- | --- |
| D1 | 设计定稿把保留期写成既定值：「`submissions` 90 天、`upload_logs` 180 天」（另 `:217`「≤90 天」、§6.5 隐私文案「≤90 天」、§9.1「90 天是否合适」） | `docs/UGC_MVP_DESIGN_FINAL_20261026.md` §3.5.2（新增）、§3.4 表、P7、§6.5 第 3 条、§9.1 第 3 项 | 全部改为「待负责人决策」；§3.5.2 列出 A（30/90 天）、B（90/180 天，原提案）、C（180/365 天）三档及影响，**不替负责人选择**；并写明决策前/决策后的动作与清理纪律 | 已修订 |
| D2 | 设计 §3.5 只列 4 条索引，实现声明 5+3 条，且未区分「声明」与「已建」 | `docs/UGC_MVP_DESIGN_FINAL_20261026.md` §3.5.1（重写） | 新增三层状态表（设计必需 / 代码声明 / 云端已建=0）；逐条对照 4 vs 5 并给差异理由（复合唯一、复合非唯一、预留）；按真实查询路径说明每条索引支撑哪段代码、是否必需；结论「联调必需 4 条、可延后 4 条」 | 已修订 |
| D3 | 联调清单写「`ADMIN_OPENIDS`…仅 review 需要也可，submit 不读它」，易误读为"submit 也可不配" | `docs/INTEGRATION_CHECKLIST_UGC_20261026.md` §2.2 第 2 条 | 拆成两条独立说明：`ADMIN_OPENIDS` 只配给 `review`、`submit` 完全不读；`UGC_LOG_SALT` 两个函数都要配；分别写明缺失时的真实失败行为与只读路径不受影响 | 已修订 |
| D4 | 存储地域只在合规核验列为待确认，未进入阶段 C 取证 | `docs/INTEGRATION_CHECKLIST_UGC_20261026.md` §2.7（新增）、本文 §8 第 10 行、§12 第 4 项 | 新增「云开发控制台 → 环境 → 地域」的查看入口、需记录的证据（环境 ID + 地域同框截图）、判定问题；未取得截图前一律「待验证」 | 已修订 |

修订后四份文档（设计定稿、联调清单、合规核验、本文）在本轮已不再存在 D1–D4 所述的互相矛盾；隐私草稿与协议草稿中涉及保留期的表述同步为「待确认」（见 `docs/DRAFT_PRIVACY_NOTICE_20261026.md` 的 PN 项）。若后续再发现冲突，按同一格式登记，不擅自裁决政策问题。

---

## 11. 复现与副作用

### 11.1 本轮只读检查命令

```powershell
# 入口核对：应只有 app.json 注册，无任何 navigateTo
Select-String -Path 'pages/**/*.js','pages/**/*.wxml' -Pattern 'pages/submit|pages/review|navigateTo'

# 环境变量与闸门
Select-String -Path 'cloudfunctions/submit/index.js' -Pattern 'UGC_LOG_SALT|ADMIN_OPENIDS|scene:|version:'
Select-String -Path 'cloudfunctions/review/index.js' -Pattern 'checkAdmin|getSalt|ADMIN_OPENIDS'

# 保留字与目标校验
Select-String -Path 'cloudfunctions/submit/index.js' -Pattern 'RESERVED_KEYS|resolveTarget|TARGET_KEYS'

# 只读测试（不写仓库）
node tools/test_ugc_submit.js
node tools/test_ugc_review.js
node tools/check_eol.js
```

### 11.2 测试结果（本轮实跑）

| 套件 | 结果 | 退出码 |
| --- | --- | --- |
| `tools/test_ugc_submit.js` | 91 通过 / 0 失败 | 0 |
| `tools/test_ugc_review.js` | 84 通过 / 0 失败 | 0 |
| `tools/test_records_spec.js` | 290 通过 / 0 失败 / 11 待实现 | 0 |
| `tools/test_cloudrepo.js` | 102 通过 | 0 |
| `tools/test_index_state.js` | 203 通过 | 0 |
| `tools/test_pages.js` | 106 通过 / 0 失败 | 0 |
| `tools/test_verify_data.js` | 122 通过 | 0 |
| `tools/test_import_data.js` | 217 通过 | 0 |
| `tools/test_seed_auth.js` | 52 通过 | 0 |
| `tools/test_seed_pilot.js` | 113 通过 | 0 |
| `tools/test_seed_s21.js` | 33 通过 | 0 |
| `tools/test_check_eol.js` | 57 通过 / 0 失败 | 0 |
| `node tools/check_eol.js` | 43 文件违规 0 | 0 |

> 上述均为**本地执行**；两个 UGC 套件使用假数据库与可注入内容安全传输，属**模拟执行**，不构成云端验证。

### 11.3 副作用

- 本文件是唯一新增；未改代码、配置、设计定稿、契约、映射、审批、初始化计划。
- 无 Git 写操作；`HEAD`、分支、暂存区不变（详见交付报告）。
- 无云端调用、无集合创建、无权限修改、无环境变量修改。

---

## 12. 下一步（等待单独授权）

阶段 C 需要负责人给出的一次性授权清单：

1. 创建两个集合并配置「仅管理端可读写」，按草稿建 5 + 3 条索引。
2. 部署 `submit`、`review`，配置 `ADMIN_OPENIDS`（真实管理员）与 `UGC_LOG_SALT`。
3. 允许本端以管理员身份执行 C2–C9 的测试调用（使用测试数据，不触碰真实用户）。
4. 允许在公众平台后台截图留证（UGC 声明入口、隐私指引、调用额度、页面收录、存储地域）。
5. 明确阶段 C 结束后**必须停止**：对真实用户开放、写正式数据源、提交 UGC 声明，都属阶段 D。

以上任一项未授权，本端停留在文档与本地验证，不越界。
