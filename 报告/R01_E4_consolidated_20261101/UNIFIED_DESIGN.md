# NG01/NG03统一结构设计与隔离原型

授权范围：报告内隔离原型，不修改正式任何模块。比较方案：统一所有价格为base+addon会错误解释NG03；为每类业务硬建独立模型会重复扩展；采用小型通用关系信封、区分关系与价格策略。

共同字段：previewRef（非dishId）、源证据、业务组、显示名、原始价格、明确known/unknown状态。实体：sellable（基础/整份售卖项）、surcharge（非独立菜品）、choice/component（只有确认才建立）、businessRule（组范围续添规则）。关系通过typed relation连接；NG01 optional_surcharge关联；NG03 composition未知，绝不生成两个组件。

NG01 fixed base=4、eggIncluded=true、五源行加价关联，unknown选择限制。NG03保留十条固定整份标价及组规则，自选双拼；D3价档独立、D4排除滑蛋共享体系；具体构成/选择数量未知。固定标价查询可以返回，但求组合最终价必须拒绝，不能把固定价当组合算法。

未知用{status:unknown,value:null}，不能用空列表代表已知没有组件。证据记录owner_decision与transcript/OCR分离。旧数据无关系时保持原dish与price逻辑，缺relation不是“允许任意选择”。不推导foodType/tastes。

最小后续调整：契约明确组经营规则和关系信封，扩展现有限定c01_t11的只读addons范围及有证据的parent关联；生成器单独解析诊断预览，不扩大ID准入；导入器新增经过审查的选项/规则通道并验证父引用、独立身份及禁止未知报价。旧dishes.csv不混入加价行；旧菜品模块无需改变price语义。迁移和前端能力另行批准。本轮均未实施。

原型prototype.py仅验证信封、标签价和失败关闭报价；不声称支持真实销售或全项目组合模型。测试包含缺组件、变价、错误独立加料、未知规则。生产兼容性仍待正式实现与审查。
