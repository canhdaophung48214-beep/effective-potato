# 首页 test_index_state 独立诊断与验收（2026-10-28）

**结果：PASS。** 实跑旧测试为 **200 通过、3 失败，退出码 1**。逐项核对 `pages/index/index.js`、`.wxml` 与 G1-c 的 `tools/test_home_datasource.js` 后，三项均为测试断言陈旧；本轮未修改首页代码或模板。

| 失败项 | 事实证据 | 判定与修正 |
|---|---|---|
| S1 | 首页 `index.js:270` 初始 `dataSource:'unknown'`；G1-c 测试 A1 也要求加载前 unknown | 旧断言期望 local 已过时；改为 unknown，保留“不假装本地来源”的强断言 |
| S8 | 首页 `index.js:12,393-402` 已通过 `loadCloudDataset({db:wx.cloud.database()})` 只读加载；G1-c L1/L2 要求统一入口且零直接写库 | 旧断言“没有云端调用点”已过时；改为要求统一入口与无直接数据库写调用 |
| S13 | WXML 使用 cloud / local / unknown 三分支；local 用 `wx:elif="{{dataSource === 'local'}}"`，unknown 用 `wx:else` 警示；G1-c L6/L8 同口径 | 旧断言要求 `dataSource !== 'unknown'` 这个旧表达式；改为明确检查 local 条件、cloud 分支和未知告示 |

**变更范围：** 仅 `项目/tools/test_index_state.js`。完整修改前后 unified diff：[首页test_index_state_精确diff_20261028.patch](首页test_index_state_精确diff_20261028.patch)，2,548 字节，SHA-256 `AAE71AF0D0FB4A234D0849EDD0436301AEF1FD48B1FCF9413D510A7D806A30D7`。没有删除首页功能、伪造 dataSource、取消必要条件或放松断言。

修改前独立备份：`C:\Users\25975\Desktop\食神寻味小程序开发\备份\index-state-20261028-2336\test_index_state.js`，46,519 字节；原件与备份 SHA-256 均为 `70F88F4B2E73FC2ECBD913EECC2D929E3CFFAC6B45B0211EA2EF5367B3A6A26A`。修改后 SHA-256 `7D8206F3956C65A4A5BC523C1719EEC784F51ED43768B37900DD26BC5286651B`。

| 测试命令 | 实际输出 | 退出码 |
|---|---|---:|
| `node tools/test_index_state.js` | 205 通过、0 失败 | 0 |
| `node tools/test_home_datasource.js` | G1-c：68 PASS、0 FAIL | 0 |
| `node tools/test_pages.js` | 106 通过、0 失败 | 0 |
| `node --check tools/test_index_state.js` | 无语法错误 | 0 |

Git HEAD 仍为 `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、分支 `main`、暂存区空；该测试文件本来就是未跟踪文件，修改内容不会增加仓库状态行数。本轮未触云、未生成正式产物、未执行 Git 写操作。未覆盖风险：离线测试只验证首页状态机和调用边界，不能代替微信开发者工具或真实云端数据验收。
