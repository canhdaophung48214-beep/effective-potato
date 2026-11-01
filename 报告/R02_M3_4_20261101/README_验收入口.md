# M3.4.2实际验收入口

当前架构：adapter.js → adapted_records_39.json；mini/app.json → mini/pages/history/index → mini/components/history-menu/index。文件名按磁盘真实架构，不存在lib/menu-data.js/pages/home/prototype/demo.html，不需要这些旧描述路径。

运行：node test_adapter.js；node test_m342.js；node test_html_layout.js（需要本机Edge，会启动独立无头临时profile并关闭自己启动的浏览器）。微信离线编译及记录：python run_final_checks.py（内部仍为原版wcc/wcsc及数据测试）；组件WXSS单独编译命令见M342_evidence/wechat_offline_compile_results.json。不要运行历史build_and_verify.js/repair_m342.py覆盖当前交付；它们只是过程来源快照。

微信工具打开工程：mini/（project.config.json无BOM，隔离工程，使用本机已有项目AppID）。当前CLI要求重新登录；登录完成后用工具打开本工程，确认pages/history/index，编译并检查首屏/底部39卡、320/375px、长名称和长来源。工具日志在M342_evidence/devtools_open.json；CLI进程退出0但API错误code10，不能计成功。无需上传/预览二维码/云端部署。真机另行授权。

HTML查看historical_menu_preview.html，仅证明HTML效果；六张截图及DOM几何测量位于M342_evidence，不是微信截图。最终执行报告、最终manifest为本轮权威交付，旧报告/manifest完整备份在仓库外目录（见backup_manifest）。


## 登录后更新

工程已实际显示；默认基础库不再硬编码，页面使用mini/history-data.js。新自动化端口9435，test_wechat_screen.js为已成功取得页数据39和截图的脚本（需工具auto绑定当前工程）。节点级诊断仍不稳定，不把test_wechat_render.js失败隐藏。最终状态以登录后实际渲染补验.md为准。HTML窄屏通过不能代替微信320/375布局检查。
