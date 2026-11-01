// pages/submit/submit.js
//
// 私有纠错投稿页（阶段 B）。设计约束：
//   - 只提交纠错，不具备发布能力；页面不显示任何“已公开”状态；
//   - 不做任何身份判断，也不传 openid / status（服务端会直接拒绝保留字段）；
//   - 不写 storage，不缓存身份；clientToken 只用于同一次表单的幂等重试。
const ugc = require('../../config/ugc');
const b1Adapter = require('../../utils/b1Adapter');

// 与服务端 LIMITS 对齐（cloudfunctions/submit/index.js:58-67），仅供前端提前提示。
const LIMITS = {
  NOTE_MAX: 100,
  NAME_MAX: 20
};

// 编号形状只认一处来源：B1 适配层已定义 c02 / c02_t02 / c02_d060 三种正则，
// 这里引用而不是复制，避免两处规则漂移导致"前端放行、服务端拒绝"。
const SHOP_RE = b1Adapter.SHOP_ID_RE;
const STALL_RE = b1Adapter.STALL_ID_RE;
const DISH_RE = b1Adapter.DISH_ID_RE;
const PRICE_RE = /^\d+(\.\d)?$/;

/* 本地演示数据形状（s01 / s01_t2 / d01）：不是错误输入，而是“暂不支持纠错”。 */
const DEMO_SHOP_RE = /^s\d{2}$/;
const DEMO_STALL_RE = /^s\d{2}_t\d{1,2}$/;
const DEMO_DISH_RE = /^d\d{2}$/;

function isDemoTarget(shopId, stallId, dishId) {
  return DEMO_SHOP_RE.test(shopId) || DEMO_STALL_RE.test(stallId) || DEMO_DISH_RE.test(dishId);
}

function genToken() {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

Page({
  data: {
    kinds: ugc.KINDS,
    kindIndex: 0,
    shopId: '',
    stallId: '',
    dishId: '',
    price: '',
    nameSuggestion: '',
    note: '',
    submitting: false,
    message: '',
    messageType: '',
    done: false
  },

  onLoad(query) {
    const q = query || {};
    const shopId = String(q.shopId || '').trim();
    const stallId = String(q.stallId || '').trim();
    const dishId = String(q.dishId || '').trim();

    /* 链接参数只接受“真实编号形状”或“演示编号形状”；其它值直接丢弃并提示，
       避免坏参数进入提交流程（服务端仍会再校验一次）。 */
    const okShop = !shopId || SHOP_RE.test(shopId) || DEMO_SHOP_RE.test(shopId);
    const okStall = !stallId || STALL_RE.test(stallId) || DEMO_STALL_RE.test(stallId);
    const okDish = !dishId || DISH_RE.test(dishId) || DEMO_DISH_RE.test(dishId);

    this.setData({
      shopId: okShop ? shopId : '',
      stallId: okStall ? stallId : '',
      dishId: okDish ? dishId : ''
    });
    this.clientToken = genToken();
    if (!okShop || !okStall || !okDish) {
      this.showMessage('链接里的菜品编号不正确，请重新从菜品进入或手动填写');
    }
  },

  onKindChange(e) {
    this.setData({ kindIndex: Number(e.detail.value) || 0 });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch[field] = e.detail.value;
    this.setData(patch);
  },

  showMessage(text, type) {
    this.setData({ message: text, messageType: type || 'error' });
  },

  /* 从“已提交”卡片返回可再次填写的表单。保留目标编号，更新幂等令牌。 */
  onSubmitAgain() {
    this.clientToken = genToken();
    this.setData({
      done: false,
      message: '',
      messageType: '',
      price: '',
      nameSuggestion: '',
      note: ''
    });
  },

  /* 前端只做“明显不合规”的提前提示，最终仍以服务端判定为准。 */
  validate(kind, shopId, stallId, dishId, price, name, note) {
    if (!shopId || !stallId) {
      return '请先填写店铺与档口编号（从菜品进入时会自动带出）';
    }
    if (isDemoTarget(shopId, stallId, dishId)) {
      return '该菜品来自演示数据，暂不支持纠错；真实菜品数据接入后才会开放';
    }
    if (!SHOP_RE.test(shopId)) return '店铺编号格式应为 c02 这样的形式';
    if (!STALL_RE.test(stallId)) return '档口编号格式应为 c02_t02 这样的形式';
    if (dishId && !DISH_RE.test(dishId)) return '菜品编号格式应为 c02_d060 这样的形式';

    if (price !== '') {
      if (!PRICE_RE.test(price)) return ugc.textOf('INVALID_PRICE');
      if (Number(price) <= 0) return ugc.textOf('INVALID_PRICE');
    }
    if (name.length > LIMITS.NAME_MAX) return ugc.textOf('INVALID_NAME');
    if (note.length > LIMITS.NOTE_MAX) return ugc.textOf('INVALID_NOTE');

    if (kind === 'price_fix' && price === '') {
      return '价格纠错需要填写正确价格';
    }
    if (kind === 'info_fix' && !note && !name) {
      return '信息纠错需要填写说明或菜名建议';
    }
    return '';
  },

  onSubmit() {
    if (this.data.submitting) return;
    const kind = (this.data.kinds[this.data.kindIndex] || {}).value;
    const shopId = this.data.shopId.trim();
    const stallId = this.data.stallId.trim();
    const dishId = this.data.dishId.trim();
    const price = this.data.price.trim();
    const name = this.data.nameSuggestion.trim();
    const note = this.data.note.trim();

    const problem = this.validate(kind, shopId, stallId, dishId, price, name, note);
    if (problem) {
      this.showMessage(problem);
      return;
    }
    if (!this.clientToken) this.clientToken = genToken();

    const payload = {};
    if (price !== '') payload.price = Number(price);
    if (name) payload.nameSuggestion = name;
    if (note) payload.note = note;

    const event = {
      action: 'submit',
      kind: kind,
      clientToken: this.clientToken,
      target: { shopId: shopId, stallId: stallId, dishId: dishId || null },
      payload: payload
    };

    this.setData({ submitting: true, message: '' });

    const self = this;
    wx.cloud.callFunction({
      name: ugc.FUNCTIONS.SUBMIT,
      data: event,
      success(res) {
        const r = (res && res.result) || {};
        if (r.ok) {
          self.setData({
            submitting: false,
            done: true,
            message: self.successText(r.securityState),
            messageType: 'ok'
          });
          self.clientToken = genToken();
          return;
        }
        self.setData({ submitting: false });
        self.showMessage(self.errorText(r));
      },
      fail() {
        self.setData({ submitting: false });
        self.showMessage('网络异常，未提交成功，请稍后重试', 'error');
      }
    });
  },

  /* 服务端 securityState：pass 正常；review/risk 表示要人工复核，不能宣称“已通过检查”。 */
  successText(state) {
    if (state === 'risk') {
      return '已提交，但内容需要人工重点复核；不会公开，也不代表已核实';
    }
    if (state === 'review') {
      return '已提交，内容需要人工复核；不会公开，也不代表已核实';
    }
    return ugc.textOf('OK');
  },

  /* 只按 code 显示文案，不根据 code 推断身份或数据状态。 */
  errorText(r) {
    const code = r && r.code;
    if (code === 'RATE_LIMITED') {
      const sec = Number(r.retryAfter);
      if (isFinite(sec) && sec > 0) {
        return '提交过于频繁，请在约 ' + Math.ceil(sec) + ' 秒后重试';
      }
      return ugc.textOf('RATE_LIMITED');
    }
    if (code === 'DUPLICATE') {
      return '已有一条相同内容在审核中，请等待处理后再提交';
    }
    if (code === 'LOG_FAILED' && r.submissionId) {
      return '记录已保存，但审计日志失败；请勿重复提交，联系管理员处理';
    }
    return ugc.textOf(code);
  }
});
