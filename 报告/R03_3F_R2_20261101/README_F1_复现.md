# R03-F1复现与审查入口

源转录稿：source_assets/TRANSCRIPTION_3F_R2.md；16张裁剪图：source_assets/crops/；原裁剪脚本：source_assets/tools/，这些19文件与迁移前字节完全相同。脚本只作为原始JOBS/裁剪框来源由构建器AST读取，不直接运行其历史OUT设置。原照片仍在原归档位置，没有移动或删除。

根目录执行：python -X utf8 报告/R03_3F_R2_20261101/test_r03.py；python -X utf8 报告/R03_3F_R2_20261101/test_r03_f1.py。后者在系统临时目录复制source_assets并调用build_r03.py --out-dir <隔离输出>，与133条当前候选逐对象一致，临时结果不覆盖正式交付。

活动记录sourceFile与cropPath使用本目录相对路径。OCR原始path保留实际执行时的历史路径，currentEvidencePath给出当前文件；OCR文字未修改。project_before.json/git_before.json及stage1快照也是历史证据，不是迁移后的可执行路径。历史R03报告中的原保护表述以F1当前结论为准。

当前NEW232，旧143动作不变，台账375行，292源组，133候选。manifest.sha256不自引用；file_manifest.json在SHA清单中被覆盖，所有正式输出及source_assets均列入。F1_evidence含外部备份清单、逐文件迁移、前后Git和测试原始输出；无Git写操作。
