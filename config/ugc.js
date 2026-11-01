/**
 * UGC 前端配置（仅文案与调用名，不含任何身份判定）
 *
 * 重要：本文件不判断“是不是管理员”。管理员身份只由 review 云函数在服务端判定，
 * 前端拿到 403 就只显示“无权限”，不做任何本地推断、不写 storage。
 */

/** 云函数名（与 cloudfunctions/ 目录名一致） */
const FUNCTIONS = {
  SUBMIT: 'submit',
  REVIEW: 'review'
};

/** 投稿类型 */
const KINDS = [
  { value: 'price_fix', label: '价格纠错', hint: '价格涨了 / 降了 / 写错了' },
  { value: 'info_fix', label: '信息纠错', hint: '菜名、档口等信息不对' }
];

/** 与云函数错误码一一对应；前端只按 code 显示文案。 */
const ERROR_TEXT = {
  OK: '提交成功，等待人工审核',
  NO_OPENID: '未获取到微信身份，请稍后重试',
  FORBIDDEN: '无权限',
  INVALID_ACTION: '不支持的操作',
  PAYLOAD_TOO_LARGE: '内容过长，请精简后重试',
  INVALID_FIELD: '填写有误，请检查后重试',
  INVALID_PRICE: '价格需为大于 0、最多一位小数的数字',
  INVALID_NOTE: '说明需为 1–100 字，不能只含空白或隐藏字符',
  INVALID_NAME: '菜名建议需为 1–20 字',
  RESERVED_FIELD: '请求包含不允许的字段',
  PHOTO_NOT_SUPPORTED: '本版本暂不支持上传图片',
  TARGET_NOT_FOUND: '目标菜品/档口不存在',
  TARGET_IS_DEMO: '演示数据不支持纠错',
  TARGET_MISMATCH: '目标信息不一致，请刷新后重试',
  TARGET_NOT_VERIFIABLE: '该目标暂不支持纠错',
  DUPLICATE: '已有一条相同内容在审核中',
  RATE_LIMITED: '提交过于频繁，请稍后再试',
  SECURITY_UNAVAILABLE: '内容安全检查未完成，暂不能通过',
  STATE_CONFLICT: '记录状态已变化，请刷新',
  DATABASE_ERROR: '服务暂时不可用，请稍后重试',
  LOG_FAILED: '记录已保存，但审计日志失败，请联系管理员',
  INTERNAL: '服务异常，请稍后重试',
  NOT_FOUND: '记录不存在'
};

/**
 * 数据保留策略（设计项，不是已批准数值）
 *
 * 保留期限必须由负责人确认后再填；确认前本功能不得对真实用户开放。
 * 禁止在这里写死「90 天」之类的默认值，也不要把未确认值当成已批准口径。
 */
const RETENTION = {
  status: 'pending_confirmation',
  days: null,
  confirmedBy: '',
  note: '删除请求由 review.delete 处理：清除 payload 并匿名化主体，审计日志按法规保留'
};

function textOf(code) {
  return ERROR_TEXT[code] || '操作失败，请稍后重试';
}

module.exports = {
  FUNCTIONS,
  KINDS,
  ERROR_TEXT,
  RETENTION,
  textOf
};
