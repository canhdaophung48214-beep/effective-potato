const { ENV_ID } = require('./config/cloud');

App({
  onLaunch() {
    // 第一版：纯本地演示，无登录、无网络请求
    console.log('[山理吃什么] 小程序启动');

    // ------------------------------------------------------------
    // 云开发初始化（最小改动）
    // 只做 init，不发起任何网络请求 —— 避免影响小程序正常启动。
    // 真正的连通性测试由开发者在调试器 Console 或临时测试页手动触发。
    // ------------------------------------------------------------
    if (!wx.cloud) {
      console.warn('[云开发] 当前基础库不支持 wx.cloud（需要 2.2.3 及以上），已跳过初始化');
      return;
    }

    try {
      wx.cloud.init({
        env: ENV_ID,
        traceUser: true
      });
      console.log('[云开发] 初始化完成，环境 ID：' + ENV_ID);
    } catch (e) {
      // 初始化失败不影响小程序其余功能
      console.error('[云开发] 初始化失败：', e);
    }
  },

  globalData: {
    version: '0.1.0'
  }
});
