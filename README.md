# 食神寻味（微信小程序）

街头餐饮档口的店铺 / 楼层 / 档口 / 菜品目录小程序：按楼层浏览档口、按菜品筛选口味与主食类型、查看评价与用户提交内容（UGC）。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `app.js` / `app.json` / `app.wxss` | 小程序入口与全局样式 |
| `pages/` | 页面：`index`（首页）、`community`、`profile`、`rating`、`review`、`submit` |
| `utils/` | 公共工具：数据适配（`b1Adapter.js`）、云端读写（`cloudRepo.js`）、数据集守卫、筛选匹配（`matcher.js`） |
| `data/` | 本地演示数据与展示层映射（`index.js` 中的 `FOOD_TYPE_LABEL` / `TASTE_LABEL`） |
| `cloudfunctions/` | 云函数：`seed`、`seed_b1`、`review`、`submit`、`retention`、`healthCheck` |
| `tools/` | 数据管线、校验器与测试脚本（见下） |
| `docs/` | 设计、契约、合规与交接文档 |
| `evidence/` | 运行取证截图 |
| `报告/` | 调研、批次恢复、OCR 证据与校验报告（165 个批次目录） |
| `assets/` `design/` `config/` | 图片素材、设计稿、配置 |

## 本地运行

1. 用微信开发者工具导入本目录（`project.config.json`）。
2. 云开发相关功能需绑定云环境；云函数位于 `cloudfunctions/`，逐个上传部署。
3. 纯本地浏览（`data/` 演示数据）不依赖云环境。

## 数据管线（`tools/pilot/`）

现场拍摄菜单 → 人工转录为 CSV → `tools/pilot/gen_records.js` 生成记录 → id-map / 审批 / 契约校验 → `tools/import_data.js` 导入。
冻结契约见 `docs/RECORD_GENERATOR_CONTRACT_20261023.md`。未知信息保持未知（不下推口味、不补造字段），阻塞记录不计入准入预览。

## 校验与测试

```bash
node tools/verify_data.js          # 数据一致性
node tools/check_eol.js            # 行尾/编码
node tools/check_doc_refs.js       # 文档引用
node tools/check_id_admission.js   # ID 准入
node tools/regression.js           # 回归
node tools/test_<name>.js          # 40 个测试脚本，逐个运行
```

## 素材与隐私说明

`报告/` 与 `evidence/` 保存现场照片、菜单截图与 OCR 原文，其中包含店招与菜单牌上的公开电话号码。
这些文件按取证原样保留、未做删改；如不希望公开，请删除对应文件或整份批次目录后再发布。
仓库不含任何密钥：云函数通过环境变量读取管理员配置，历史文档中的 AppSecret 仅为合规条款表述。

## 未纳入本仓库

`备份/`、`下载/`、`导入产物/` 为本地目录（体积大、可重建），不在版本库内。
