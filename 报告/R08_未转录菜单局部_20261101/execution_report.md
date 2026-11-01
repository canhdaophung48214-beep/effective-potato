# R08 未转录菜单局部：实施与验收

本地证据抽取与组件候选生成 PASS；新增独立菜品数量0，独立菜品恢复仍PENDING。不得把2项主食组件说成2道新增独立菜品。正式准入PENDING，正式导入0。

## 实际来源

选择c03_offsite_batch2已有10张真实菜单，处理R06/R07明确未逐条转录的主食/加料/称重局部，不重建其132条既有菜品。没有独立R08计划。R07已通过验收，状态在本批technical_debt.md登记，不修改R07文件；其三个P3据DSH原文保留。

未调用云端视觉API。现有Windows.Media.Ocr脚本离线执行。首次在PowerShell7下Runtime类型不可用；改用系统powershell.exe后遇中文脚本编码问题；使用UTF-8 BOM解决。最终10/10 OCR_COMPLETED，原始识别结果在ocr_raw.json。OCR有明显误字，不以常识纠正成假原文，也不把OCR当独立人工视觉复核。

## 真正生成的成果

| 指标 | 数量 |
|---|---:|
| 本轮源照片 |10|
| 明确抽取的价格组件/选项 |7|
| candidates.json主食组件候选 |2|
| 新增独立菜品候选 |0|
| optional_surcharges加料关系 |5|
| 待核验聚合材料责任 |8|
| source_groups/source_ledger责任组 |15|
| 改写/替换/作废旧记录 |0 / 0 / 0|
| NEW责任组 / PENDING责任组 |7 / 8|
| 正式ID分配 / 正式导入 |0 / 0|

15=2组件+5加料+8待核验材料组。分母是局部“材料责任组”，不是完整菜单原始行数或15道菜；10张照片包括已有R06菜区，不把它们算新增记录。待核验聚合组不能和逐菜计数混用。

两项组件：味爱特米饭1元、航语佳米饭一元。仅recordKind=meal_component、independentDish=false；是否可独立购买不做推断，不能进入随机独立菜/交易。未追加“免费续”字段，因为一张OCR出现兔/免等混淆，事实保留整行而非自动修字。

五项加料：单县加面2元/份、火腿片2元/份、酥油饼2元/份；忆米嘉火腿片2元、肥牛卷5元。源照片、OCR照片键、OCR行号、整行引文及明确匹配片段matchedText均保存。特定基础菜、选项多选、组合规则继续UNKNOWN，不硬绑。忆米嘉计价单位未明则为null。

全部formalDishId=null、currentPriceValidity=UNKNOWN、transactionQuoteAllowed=false、verifyStatus=unverified。采集人、实际拍摄日期、楼层继续null；不处理区域划分。新组件/关系不继承c03/c10正式身份，仅本地R08名称关联原照片档口。

## 待核验与已处理旧内容

8个责任组见unresolved.csv：单县蛋价混淆、葱花饼价位对应、忆米嘉不完整剩余清单、赣五爷剩余炸货、土耳其烤鸡推荐遮挡、两家称重计价、其他无法定位新实体的碎片。L77不能直接当1.77的逐图识别确认；人均价不能当单菜固定价。赣五爷炸金针菇1元已由R07保存，未重复出关系。

R06已有132条菜不复制；旧记录处理为既有成果引用保留、0写入变更。source_ledger只列本轮7个新价格组件责任和8个待核验责任，不伪造逐个具名的残缺项。已处理照片全覆盖情况见photo_coverage.json。没有新独立主菜，不能为满足菜品数量目标把加料改为独立菜。

## 实际命令与测试

powershell.exe -NoProfile -ExecutionPolicy Bypass -File 报告/R08_未转录菜单局部_20261101/ocr.ps1：最终exit0，10 OCR_COMPLETED。

python -X utf8 build_r08.py：exit0，build_output.txt保留生成结果。

python -X utf8 test_r08.py：19 PASS / 0 FAIL / 0 SKIP，exit0，test_output.txt完整输出。包括逐条OCR引文/图片SHA、15责任守恒、独立菜边界、R07金针菇防重复。8种错误输入：伪造价格、组件改独立菜、填楼层、填拍摄日期、开放报价、改OCR引文、强绑基础菜、未知单位填份，均被拒绝。

git diff --check：exit0；存在既有project.config.json CRLF提示，未修改。正式项目与R03-R07逐文件哈希无变化，Git前后HEAD/分支/暂存/状态一致。没有修改生产工具，未重跑无关历史套件，未宣称正式导入校验通过。

## 备份、差异与交付

backup_manifest.json记录before外部独立备份、原路径、快照、字节数、SHA，10张原图、原采集说明、DSH报告逐字节一致；不改原图。project_before/closed_before用于只读边界验证。

diff.patch只覆盖明确的新工作文本，不含图片二进制，不当作git apply交付。file_manifest.json/manifest.sha256覆盖所有实物，清单自身按非循环方式排除。没有修改或覆盖已关闭批次。

## 连续执行和最终状态

完成本批后再次检查下一批材料，见continuation_status.md。既有已填独立转录/CSV都有冻结批次去向；可安全识别的这7项新增组件已生成。仍有图片局部语义无法确认，不能承诺“所有照片已识别完毕”，也不空建新批次或伪造新菜。持续整理的证据穷尽状态PENDING。

PASS：真实文件落盘、10图本地OCR、7新增组件/关系、19测试、before与哈希、正式项目/冻结成果不变。

PENDING：新增独立菜品恢复、8材料组的精确价义/完整清单、真实视觉复核、正式准入。已生成候选2（主食组件）、待核验8（材料组）、待正式准入7（组件/关系，非7道菜）、已正式导入0。

R07记录为本地关闭，P3只记技术债不返工。R08交DSH独立验收；本轮无云端、部署、索引、Git写操作或审批/正式ID改动。
