/**
 * ============================================================
 * 云函数 healthCheck —— 最小连通性测试
 * ============================================================
 * 职责：只返回状态、环境信息与时间戳。
 * 明确不做的事：
 *   - 不读写数据库（不碰任何集合，更不碰业务数据）
 *   - 不读写云存储
 *   - 不记录用户身份，不做登录校验
 *   - 不产生外部网络请求
 *
 * 入参（可选）：{ echo: 任意可序列化值 }，原样回显，用来验证入参通道。
 * ============================================================
 */

const cloud = require('wx-server-sdk');

// DYNAMIC_CURRENT_ENV：自动跟随「部署时所在的环境」，避免把环境 ID 写死在云函数里
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  return {
    ok: true,                                  // 固定 true：能返回就说明整条链路通了
    fn: 'healthCheck',                         // 函数名，确认调用的是这个函数
    env: process.env.TCB_ENV || 'unknown',     // 云函数实际运行在哪个环境
    ts: Date.now(),                            // 服务端毫秒时间戳
    time: new Date().toISOString(),            // 服务端 ISO 时间，便于人工核对
    node: process.version,                     // Node 运行时版本
    echo: event && event.echo !== undefined ? event.echo : null  // 入参数回显
  };
};
