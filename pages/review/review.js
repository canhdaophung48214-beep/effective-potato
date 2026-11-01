// pages/review/review.js
//
// 隐藏审核页（阶段 B）。约束：
//   - 入口为零：不进 tabBar、不进导航、无分享（不实现 onShareAppMessage）；
//   - 进入即调用 review 云函数的 session 动作；403 时只显示“无权限”，
//     不渲染任何数据、不写缓存、不写 storage；
//   - 是否管理员只由服务端判定，前端不缓存任何“已登录”标记。
const ugc = require('../../config/ugc');

function call(action, extra) {
  return new Promise(function (resolve) {
    wx.cloud.callFunction({
      name: ugc.FUNCTIONS.REVIEW,
      data: Object.assign({ action: action }, extra || {}),
      success: function (res) { resolve((res && res.result) || {}); },
      fail: function () { resolve({ ok: false, code: 'INTERNAL' }); }
    });
  });
}

Page({
  data: {
    loading: true,
    denied: false,
    authorized: false,
    items: [],
    message: '',
    acting: ''
  },

  onLoad() {
    this.refresh();
  },

  refresh() {
    const self = this;
    this.setData({ loading: true, message: '' });
    return call('session').then(function (res) {
      if (!res.ok) {
        self.setData({
          loading: false,
          denied: true,
          authorized: false,
          items: []
        });
        return;
      }
      self.setData({ authorized: true, denied: false });
      return call('list').then(function (list) {
        if (!list.ok) {
          self.setData({ loading: false, items: [] });
          self.showMessage(ugc.textOf(list.code));
          return;
        }
        self.setData({
          loading: false,
          items: (list.items || []).map(function (it) {
            return {
              id: it.submissionId,
              kindLabel: it.kind === 'price_fix' ? '价格纠错' : '信息纠错',
              targetText: [it.target.shopId, it.target.stallId, it.target.dishId].filter(Boolean).join(' / '),
              note: (it.payload && it.payload.note) || '',
              nameSuggestion: (it.payload && it.payload.nameSuggestion) || '',
              price: (it.payload && it.payload.price !== null && it.payload.price !== undefined) ? it.payload.price : '',
              securityState: (it.security && it.security.state) || 'error',
              rev: it.rev
            };
          })
        });
      });
    });
  },

  showMessage(text) {
    this.setData({ message: text });
  },

  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    const rev = Number(e.currentTarget.dataset.rev);
    if (!id || !rev || this.data.acting) return;
    const self = this;
    wx.showModal({
      title: '确认通过',
      content: '通过仅表示采纳这条纠错建议，不会公开、也不会把菜品标记为已核实。',
      confirmText: '通过',
      success: function (r) {
        if (!r.confirm) return;
        self.setData({ acting: id });
        call('approve', { submissionId: id, expectedRev: rev }).then(function (res) {
          self.setData({ acting: '' });
          if (res.ok) {
            self.showMessage('已通过，等待后续人工核实');
            self.refresh();
            return;
          }
          if (res.code === 'SECURITY_UNAVAILABLE') {
            /* 服务端明确返回不可通过：review/risk 需先人工处理，不复用“通过”语义。 */
            self.showMessage('内容安全状态为「' + (res.securityState || 'unknown') + '」，不能通过；请先人工核实');
            return;
          }
          if (res.code === 'STATE_CONFLICT') {
            self.showMessage(ugc.textOf('STATE_CONFLICT'));
            self.refresh();
            return;
          }
          self.showMessage(ugc.textOf(res.code));
        });
      }
    });
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id;
    const rev = Number(e.currentTarget.dataset.rev);
    if (!id || !rev || this.data.acting) return;
    const self = this;
    wx.showModal({
      title: '驳回',
      editable: true,
      placeholderText: '可填写理由（≤100 字）',
      confirmText: '驳回',
      success: function (r) {
        if (!r.confirm) return;
        self.setData({ acting: id });
        call('reject', {
          submissionId: id,
          expectedRev: rev,
          reasonCode: 'inaccurate',
          reasonText: (r.content || '').trim()
        }).then(function (res) {
          self.setData({ acting: '' });
          if (res.ok) {
            self.showMessage('已驳回');
            self.refresh();
            return;
          }
          if (res.code === 'STATE_CONFLICT') {
            /* 别人已处理或 rev 变了：提示并刷新，避免反复撞 409。 */
            self.showMessage(ugc.textOf('STATE_CONFLICT'));
            self.refresh();
            return;
          }
          self.showMessage(ugc.textOf(res.code));
        });
      }
    });
  }
});
