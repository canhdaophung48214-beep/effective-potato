// pages/profile/profile.js
//
// 我的栏：未接入微信登录与用户数据，页面保持空状态。
// 统计值统一用 '—'（未知），不写 0，避免让人误以为「已有记录但为空」。
Page({
  data: {
    loggedIn: false,
    stats: [
      { key: 'submit', label: '我的投稿', value: '—' },
      { key: 'pending', label: '待审核', value: '—' },
      { key: 'passed', label: '已通过', value: '—' }
    ],
    entries: [
      { key: 'rating', label: '我的评分与评价', state: '开发中' },
      { key: 'favorite', label: '我的收藏', state: '开发中' },
      { key: 'help', label: '帮助与反馈', state: '开发中' }
    ]
  }
});
