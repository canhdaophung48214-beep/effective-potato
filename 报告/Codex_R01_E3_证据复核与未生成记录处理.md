# R01-E3 证据复核与未生成记录处理

本地OCR提取与阻塞清单 PASS；逐菜视觉判读及字段升级 PENDING。日期2026-11-01。

35条照片记录、34唯一对象均存在、可解码且完成Windows.Media.Ocr离线中文识别。逐张保留原始OCR文本和归档映射；机器识别存在小字、反光、顺序及作用域错误，未将OCR文字当作事实。没有调用外部识别服务。首次PowerShell脚本编码导致路径读取失败，改成UTF-8 BOM后重跑34个对象全部完成；初次不算成功。

新增A候选0、B升级0、C补证完成0。照片语义复核仍35项PENDING：本轮完成真实离线识别，但尚未完成足够可靠的逐菜对应与视觉确认，不能宣称任务A全量通过。image_review中的knownMapping来自既有归档清单；ocrShopHint只是机器摘要，不是新确认的店铺身份。new_candidates保留空表，未填无依据字段。与E2相比，实际进展是从仅哈希核对推进至34对象真实OCR，未改变E2分类与候选。

35条NOT_GENERATED逐源行复核通过，均为C档：手抓饼6、双拼茶泡饭19、辣椒炒肉双拼饭10。直接ID缺失来自gen_records.js:2661的C档candidate=null；C19是candidate_only恒0守卫，不是本轮35条的单独直接原因。现有材料不足以代替录入形态、计价或组合规则裁决。主分类业务裁决35、直接恢复0、材料补充0、契约准入0；35条均另有次级契约/准入要求，尚未解决35。逐项问题在triage表，不自动分配ID。

203项B决策材料完整保留原记录、证据、未恢复原因、可能解释及具体问题：tastes40、foodType163，全部待负责人裁决。菜单分组不等同foodType，风味不等同辣度。

验证：build_e3.py退出0；本轮独立检查源行35、照片35/34、B分类203守恒、376项目文件哈希不变。复用E2 test_inventory.js，15组PASS、0FAIL，退出0；完整日志在R01_E3_evidence/e2_reused_test.log与validation.log。未运行无关完整套件。

项目源码、data、正式CSV、映射、审批、契约、生成器、准入状态均未改。未重新生成已有数据，未正式分配ID、导入、触云或Git写。Git当前完整状态见git_state.json；HEAD/branch/staged/status与E2基线逐项对照。输出仅报告目录。所有交付物字节数、SHA-256见R01_E3_evidence/artifacts_manifest.json。报告自身不自引用哈希。

本轮交付：R01_E3_image_review.csv、R01_E3_image_ocr_results.csv、R01_E3_new_candidates.csv、R01_E3_not_generated_triage.csv、R01_E3_blocker_summary.md、R01_E3_business_decisions.csv及本报告。附OCR脚本、逐图原始JSON、独立验证脚本和日志。任务A尚未完整关闭，不以OCR执行成功冒充证据恢复完成。停止等待DSH独立验收。
