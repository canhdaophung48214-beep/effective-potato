// pages/rating/rating.js
//
// 评分栏：当前没有任何真实评价数据，页面只做「空状态 + 规划说明」。
// 这里刻意不写死任何分数、人数、榜单 —— 全部字段为空，界面据此显示空态。
Page({
  data: {
    // 只描述「将来怎么算分」，不含任何示例分数
    dimensions: [
      { key: 'taste', label: '口味', weight: 40 },
      { key: 'value', label: '性价比', weight: 30 },
      { key: 'portion', label: '分量', weight: 15 },
      { key: 'speed', label: '出餐速度', weight: 15 }
    ]
  }
});
