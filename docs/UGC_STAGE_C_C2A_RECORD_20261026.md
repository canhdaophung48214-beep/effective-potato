# Stage C · C2-A 执行记录（鉴权 / 校验 / Demo 目标拒绝 / 审计日志 / 空队列 / 客户端直读）

日期：2026-10-26（16:20–16:35，Asia/Shanghai）
授权依据：用户 2026-10-26 16:20《C2-A 受控联调执行指令》
环境：`shishen-dev-d2g4t8rgj7d0bd1e7`（与 `config/cloud.js:23` 一致）
性质：受控联调记录。**只读成功路径未打通**（无 `field_unverified` 数据），本记录不含任何业务数据写入。

---

## 1 授权红线（本轮遵守）

不修改任何集合记录；不创建测试菜品/投稿/审核记录；不调用 approve/reject/delete；不部署或改云函数；不改权限、索引、环境变量；不执行 Git 写操作；不进 C3–C9、不开放真实用户；不输出 OpenID、盐、令牌；未执行项不写成通过。

例外说明：本轮实际**新增了 1 条审计日志**（`upload_logs`），来源是 A2 被拒时 `cloudfunctions/submit/index.js:493-502` 的既定 `denied` 记录。这属于授权书 A2 条"可接受的审计副作用"，非业务数据。

## 2 执行前只读预检

| 项 | 结论 | 依据 |
|---|---|---|
| 项目路径 | `C:\Users\25975\Desktop\文件all\微信小程序` | 工作目录 |
| Git | `HEAD 274ebd6`、`main`、暂存 0、`status --short` 68 行 | `git rev-parse/status`（只读） |
| 环境 ID | 匹配 `shishen-dev-d2g4t8rgj7d0bd1e7` | `config/cloud.js:23` |
| 本地函数指纹 | `submit` `D013D7D7…`、`review` `4EC04424…` | SHA-256 前 16 位 |
| 部署版本 | 无法从本地直证；以行为指纹推定为本项目版本 | 调用均返回本项目结构化响应（`ok/code/httpStatus`），非平台默认错误 |
| `submit` 判定顺序 | 动作→openid→盐→8KB→photos→保留字段（写 `denied`）→字段校验（不写日志）→目标校验（不写日志）→幂等→去重→限流→内容安全→落库 | `cloudfunctions/submit/index.js:469-516` |
| `review.list` 参数 | `{action:'list'}`，只读 | `cloudfunctions/review/index.js:211-222` |
| 集合规模（执行前） | `submissions` 0 条；`upload_logs` 0 条 | 负责人控制台只读观察 |

## 3 逐项结果

| 编号 | 前提 | 调用方式（凭据已隐藏） | 预期 | 实际 | 集合变化 | 审计日志 | 业务副作用 | 判定 |
|---|---|---|---|---|---|---|---|---|
| A1 | 需非管理员微信身份 | 未调用 | 403 | — | — | — | — | **BLOCKED / 待准备**（缺少可用的非管理员测试身份；不借用账号、不改管理员名单） |
| A2 | 管理员（DevTools 登录态） | `submit`，请求体附 `status:"approved"` | `RESERVED_FIELD` 400 | `{ok:false,code:"RESERVED_FIELD",httpStatus:400,fields:["status"]}` | `submissions` 0→0 | `upload_logs` 0→1 | 无 | **通过** |
| A3a | 同上 | `submit`，`price:12.55` | `INVALID_PRICE` 400 | `{ok:false,code:"INVALID_PRICE",httpStatus:400,message:"PRICE_DECIMALS"}` | 0→0 | 无新增 | 无 | **通过** |
| A3b | 同上 | `submit`，`note` 101 字 | `INVALID_NOTE` 400 | `{ok:false,code:"INVALID_NOTE",httpStatus:400,message:"TOO_LONG"}` | 0→0 | 无新增 | 无 | **通过** |
| A3c | 同上 | `submit`，`clientToken:"abc"` | `INVALID_FIELD` 400 | `{ok:false,code:"INVALID_FIELD",httpStatus:400,message:"CLIENT_TOKEN"}` | 0→0 | 无新增 | 无 | **通过** |
| A4 | 需一条 `_id` 合规且 `demo` 的菜品 | 两次尝试（见 §4） | `TARGET_IS_DEMO` 422 | 先 `SHOP_ID`、后 `DISH_ID`（均 400，格式校验先拒） | 0→0 | 无新增 | 无 | **云端未验证（BLOCKED-数据）** |
| A5 | A2 已执行 | 只读看 `upload_logs` | 1 条 `denied` | 1 条，`actor.openidHash` 为 32 位十六进制 | — | 见 A2 | 无 | **通过**（盐值路径成立） |
| A6 | 管理员 | `review`，`{action:'list'}` | 空队列 | `{ok:true,code:"OK",httpStatus:200,items:[]}` | — | 无新增 | 无 | **通过** |
| A7 | 普通客户端副作用面 | 客户端 SDK 直读两集合 | 权限拒绝 | 均 `errCode:-502003`（`DATABASE_PERMISSION_DENIED`），未读到数据 | — | 无新增 | 无 | **通过** |

## 4 A4 为什么"不可达"（发现 F-1）

`dishes` 现有 4 条 demo 文档的实际取值（只读取得一条）：

```json
{"_id":"d01","dataClass":"demo","restaurantId":"s01","shopId":null,"stallId":"s01_t2"}
```

ID 契约要求 `shopId`∼`c01`、`stallId`∼`c01_t01`、`dishId`∼`c01_d001`（`cloudfunctions/submit/index.js:371-379` 的 `ID_RE`）。demo 数据是 `s01 / s01_t2 / d01` 这套早期命名。

两次尝试的路径：

1. 用文档真实字段（`shopId='s01'`）→ 被 `SHOP_ID` 挡（400）；
2. 用合规占位（`shopId='c01'`、`stallId='c01_t01'`）+ 真实 `dishId='d01'` → 被 `DISH_ID` 挡（400）。

两处都发生在 `resolveTarget` 之前（`:504-505`），所以 `TARGET_IS_DEMO`（`:438`）在云端**无法通过真实请求触达**。要触达必须存在一条 `_id` 形如 `c99_d001` 且 `dataClass:"demo"` 的文档。

判定：**不是缺陷，是数据与 ID 契约不同源**；格式校验先拒是正确顺序。该分支的代码正确性由本地 `tools/test_ugc_submit.js` 覆盖（`TARGET_IS_DEMO` 断言），**云端状态记为"未验证（BLOCKED-数据）"**。

附带发现（不改代码，仅记录）：`cloudfunctions/submit/index.js:76-77` 的注释说"演示数据（s01 / d01）不匹配，会被 `TARGET_NOT_FOUND` 或 `TARGET_IS_DEMO` 挡住"——实测不是这两个码，而是 `INVALID_FIELD`（`SHOP_ID`/`DISH_ID`），因为形状校验在 `:371-379` 先执行、`resolveTarget` 在 `:512` 才被调用。注释与行为不一致，属文档瑕疵；修注释需改代码，本轮禁止，留待编码窗口。

## 5 盐值证据（C2-A5）

- 日志条数 1，`event:"denied"`，`errorCode:"RESERVED_FIELD"`；
- `actor.openidHash` 为 32 位十六进制（HMAC-SHA256 截断），非明文 OpenID；
- 说明 `getSalt()` 已取到值、`hashOpenid()` 实际执行、`upload_logs` 写入路径成立；
- **未验证**：盐错误/缺失时的行为（需临时改配置，本轮禁止），以及 `review` 侧变更类动作的日志（无数据可改，需成功路径）。

## 6 副作用与 Git

- 云端：`submissions` 0→0；`upload_logs` 0→1（A2 的 `denied`）；`dishes` 未改；无审核动作。
- 本地：无代码/配置/文档改动（本记录文件为新增 Markdown，不属于应用资产）。
- Git：`HEAD 274ebd6`、`main`、暂存 0、`status --short` 68 行（与预检一致）；未执行任何 Git 写操作。

## 7 未执行项与下一步

| 项 | 状态 | 原因 | 解除条件 |
|---|---|---|---|
| A1 普通用户 403 | **BLOCKED / 待准备** | 缺少可用的非管理员测试身份 | 提供可安全使用的非管理员账号；此前保持此状态，不借用不改名单 |
| A4 demo 目标拒绝 | **云端未验证** | 云端无 `_id` 合规且 `demo` 的文档 | 方案 B-2，或等正式数据；本地测试已覆盖 |
| 成功入库 / 去重 / 限流 / 内容安全 / approve / reject / delete | 未执行 | 无 `field_unverified` 目标 | 同上 |

**进入 C2-B 前需负责人确认**：是否解除"C2-A 禁令第 2 条"以执行 B-2（写一条测试菜品）。A1 已按负责人决定记为 BLOCKED/待准备，不再等待。

---

## 8 源码只读核对（本地源 vs 云端行为）

**核对边界**：云函数的部署代码不可下载，本地**无法读取云端版本号/文件**；只能做两件事——核对本地源，与用已发生的调用行为反向比对。以下凡标注"行为一致"者，指云端响应与本地源语义吻合，不指"读了云端代码"。

| 项 | 本地源（行号） | 云端可观察证据 | 结论 |
|---|---|---|---|
| ID 格式契约 | `ID_RE` = `^c\d{2}$` / `^c\d{2}_t\d{2}$` / `^c\d{2}_d\d{3}$`（`cloudfunctions/submit/index.js:78-82`） | `s01` → `SHOP_ID`；`d01` → `DISH_ID`（均 400） | **行为一致** |
| 字段校验顺序 | 形状校验在 `:371-379`，先于 `resolveTarget`（`:512`） | 两次尝试都停在 400 形状校验，未进入目标查询 | **行为一致** |
| 目标查询方式 | `db.collection('dishes').doc(id).get()`（`:179-187`，`:436`）；档口 `stalls.doc(id)`（`:449`） | **未触达**（被前置校验拦截），无法验证 | 未验证 |
| `TARGET_IS_DEMO` 分支 | `dish.dataClass === 'demo'` → 422（`:438`）；档口同（`:451`） | **未触达** | 未验证 |
| 保留字段拦截 | `collectReservedKeys` → `RESERVED_FIELD` 400 + `denied` 日志（`:493-502`） | 返回 `RESERVED_FIELD`、`fields:["status"]`，`upload_logs` +1 | **行为一致** |
| 价格/长度/token 校验 | `:386-391`（`PRICE_DECIMALS`）、`:396-399`（`TOO_LONG`）、`:358-363`（`CLIENT_TOKEN`） | 三个错误码逐一命中 | **行为一致** |
| 审计脱敏 | `hashOpenid` → HMAC-SHA256 截断 32 hex（日志点 `:496-499`） | `actor.openidHash` 32 位十六进制 | **行为一致** |

**结论**：可与云端对上的六项全部一致，没有发现"云端跑的是别的版本"的反证；但 `TARGET_IS_DEMO`、目标查询与档口分支因数据前置未触达，**一律记为未验证**，不作"已通过"表述。

## 9 本地测试结果（`tools/test_ugc_submit.js`）

| 项 | 结果 |
|---|---|
| 执行命令 | `node tools/test_ugc_submit.js` |
| 退出码 | 0 |
| 汇总 | **PASS 91 / FAIL 0**，末行 `RESULT: OK（本地模拟，未验证云端真实行为）` |
| 是否覆盖 `TARGET_IS_DEMO` | **是**：`F1 演示数据不可投稿`（`tools/test_ugc_submit.js:166-168`），夹具为 `_id:"c02_d060"`、`dataClass:"demo"`，断言 `r.code === 'TARGET_IS_DEMO'` |
| 相邻覆盖 | `F2` 目标不存在（`TARGET_NOT_FOUND`）、`F3` 档口不一致（`TARGET_MISMATCH`）、`F4` 非待核实（`TARGET_NOT_VERIFIABLE`） |
| 与云端的差别 | 本地夹具使用**合规 ID** `c02_d060`，正是云端缺失的那类文档；本地是假 DB + 桩 `msgSecCheck`，不含真实网络与配额 |
| 表述纪律 | 该结果只证明"本地逻辑覆盖该分支"，**不构成云端验证**；云端 A4 仍为"未验证（BLOCKED-数据）" |
