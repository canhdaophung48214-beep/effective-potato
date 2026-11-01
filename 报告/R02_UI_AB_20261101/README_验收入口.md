# 《食神寻味》A+B 三屏隔离原型

## 打开方式

使用微信开发者工具打开 `mini/`。默认启动页为 `pages/home/index`，列表页为 `pages/menu/index`，详情页为 `pages/detail/index`。

## 边界

- 39 条数据来自 `R02_M3_4_20261101/mini/adapted_records_39.json`，复制前后 SHA-256 一致。
- 页面只显示历史菜单金额和“当前价格未知”；不提供交易报价。
- 不展示未经事实支持的窗口号、口味、评分、当前价格或推荐理由。
- 本目录是隔离原型，不属于正式小程序页面，不得直接合并。

## 验收入口

- `执行报告.md`：PASS/PENDING 结论。
- `tests/test_ui.js`：离线专项测试。
- `test_output.txt`：测试原始输出。
- `evidence/`：微信开发者工具实际渲染截图及失败过程证据。
- `SHA256SUMS.json`：交付文件哈希。
