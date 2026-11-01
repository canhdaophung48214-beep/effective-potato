#!/usr/bin/env node
/**
 * tools/test_pages.js
 * ------------------------------------------------------------------
 * 四栏导航与三个新页面的静态校验（Node 环境，不依赖微信开发者工具）。
 *
 * 覆盖：
 *   A. app.json 配置：pages / tabBar / 图标文件 / 配色
 *   B. 三个新页面 JS：能正常加载、数据契约正确、没有网络请求
 *   C. 三个新页面 WXML：关键文案存在、没有看似可用的操作、没有虚构数字
 *   D. 首页未被削弱：关键处理函数与关键文案仍在
 *   E. 全局样式与 tabBar 一致（暖纸底 + 灶火红）
 *
 * 用法：node tools/test_pages.js
 * 退出码：0 全部通过；1 有失败
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(name + (extra ? '  → ' + extra : ''));
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function loadJson(rel) {
  return JSON.parse(read(rel));
}

function requirePage(rel) {
  let captured = null;
  const prevPage = global.Page;
  global.Page = function (cfg) {
    captured = cfg;
  };
  try {
    const abs = path.join(ROOT, rel);
    delete require.cache[require.resolve(abs)];
    require(abs);
  } finally {
    global.Page = prevPage;
  }
  return captured;
}

/* ------------------------------------------------------------------
 * WXML 轻量结构检查：标签是否配对（忽略注释与自闭合标签）
 * ------------------------------------------------------------------ */
function wxmlBalance(rel) {
  const src = read(rel).replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const raw = m[0];
    const name = m[1];
    const isClose = raw[1] === '/';
    const selfClose = /\/>$/.test(raw);
    const isVoid = /^(image|input|icon|progress|br|hr|slot|template)$/i.test(name) === false ? false : true;
    if (isClose) {
      const top = stack.pop();
      if (top !== name) {
        return { ok: false, error: '标签不匹配：</' + name + '> 对应 <' + (top || '空') + '>' };
      }
    } else if (!selfClose && !isVoid) {
      // template 标签同时可能作为 <template name="x"> ... </template> 出现，需要入栈
      stack.push(name);
    }
  }
  if (stack.length) {
    return { ok: false, error: '存在未闭合标签：' + stack.join(', ') };
  }
  return { ok: true };
}

/* ==================================================================
 * A. app.json
 * ================================================================== */
const app = loadJson('app.json');

check('A1 app.json 可解析', !!app);
check('A2 pages 是数组', Array.isArray(app.pages));
check('A3 首页仍在第一个', app.pages[0] === 'pages/index/index', app.pages[0]);

const EXPECT_PAGES = ['pages/rating/rating', 'pages/community/community', 'pages/profile/profile'];
EXPECT_PAGES.forEach(function (p) {
  check('A4 pages 含 ' + p, app.pages.indexOf(p) >= 0);
  ['.js', '.json', '.wxml', '.wxss'].forEach(function (ext) {
    check('A5 文件存在 ' + p + ext, exists(p + ext));
  });
});

check('A6 tabBar 存在', !!app.tabBar);
check('A7 tabBar.list 为 4 项', app.tabBar && app.tabBar.list.length === 4, app.tabBar && app.tabBar.list.length);

const EXPECT_TABS = [
  { pagePath: 'pages/index/index', text: '首页', icon: 'assets/tabbar/home.png', iconOn: 'assets/tabbar/home-on.png' },
  { pagePath: 'pages/rating/rating', text: '评分', icon: 'assets/tabbar/rating.png', iconOn: 'assets/tabbar/rating-on.png' },
  { pagePath: 'pages/community/community', text: '社区', icon: 'assets/tabbar/community.png', iconOn: 'assets/tabbar/community-on.png' },
  { pagePath: 'pages/profile/profile', text: '我的', icon: 'assets/tabbar/profile.png', iconOn: 'assets/tabbar/profile-on.png' }
];

EXPECT_TABS.forEach(function (tab, i) {
  const item = (app.tabBar.list || [])[i] || {};
  check('A8 第 ' + (i + 1) + ' 栏是 ' + tab.text, item.text === tab.text, item.text);
  check('A9 第 ' + (i + 1) + ' 栏路径正确', item.pagePath === tab.pagePath, item.pagePath);
  check('A10 第 ' + (i + 1) + ' 栏路径已注册', app.pages.indexOf(item.pagePath) >= 0);
  check('A11 图标存在 ' + tab.icon, exists(item.iconPath || ''));
  check('A12 选中图标存在 ' + tab.iconOn, exists(item.selectedIconPath || ''));
});

check('A13 tabBar 未选中色 #9C9289', app.tabBar.color === '#9C9289', app.tabBar.color);
check('A14 tabBar 选中色 #D9412B', app.tabBar.selectedColor === '#D9412B', app.tabBar.selectedColor);
check('A15 tabBar 底色白色', app.tabBar.backgroundColor === '#FFFFFF', app.tabBar.backgroundColor);
check('A16 导航栏主色 #D9412B', app.window.navigationBarBackgroundColor === '#D9412B', app.window.navigationBarBackgroundColor);
check('A17 页面底色 #FAF6F0', app.window.backgroundColor === '#FAF6F0', app.window.backgroundColor);

/* ==================================================================
 * B. 三个新页面 JS
 * ================================================================== */
const ratingCfg = requirePage('pages/rating/rating.js');
const communityCfg = requirePage('pages/community/community.js');
const profileCfg = requirePage('pages/profile/profile.js');

check('B1 评分页 Page 配置可加载', !!ratingCfg && !!ratingCfg.data);
check('B2 社区页 Page 配置可加载', !!communityCfg && !!communityCfg.data);
check('B3 我的页 Page 配置可加载', !!profileCfg && !!profileCfg.data);

const dims = (ratingCfg && ratingCfg.data && ratingCfg.data.dimensions) || [];
check('B4 评分维度 4 项', dims.length === 4, dims.length);
check('B5 评分维度权重合计 100', dims.reduce(function (s, d) { return s + d.weight; }, 0) === 100);
check('B6 评分页没有任何示例分数', JSON.stringify(ratingCfg.data).indexOf('score') < 0 && JSON.stringify(ratingCfg.data).indexOf('4.6') < 0);

const sections = (communityCfg && communityCfg.data && communityCfg.data.sections) || [];
check('B7 社区信息类型 4 项', sections.length === 4, sections.length);
check('B8 社区类型 key 唯一', new Set(sections.map(function (s) { return s.key; })).size === 4);
check('B9 社区不含任何示例动态字段', JSON.stringify(communityCfg.data).indexOf('author') < 0 && JSON.stringify(communityCfg.data).indexOf('likes') < 0);

check('B10 我的页未登录状态为 false', profileCfg.data.loggedIn === false);
check('B11 我的页统计值全为 —', profileCfg.data.stats.every(function (s) { return s.value === '—'; }));
check('B12 我的页统计不写 0', profileCfg.data.stats.every(function (s) { return s.value !== 0 && s.value !== '0'; }));
check('B13 我的页入口全部标记开发中', profileCfg.data.entries.every(function (e) { return e.state === '开发中'; }));

['pages/rating/rating.js', 'pages/community/community.js', 'pages/profile/profile.js'].forEach(function (f) {
  const src = read(f);
  check('B14 ' + f + ' 无网络/云调用', !/wx\.request|wx\.cloud|callFunction|login\(/.test(src));
  check('B15 ' + f + ' 无定时器', !/setTimeout|setInterval/.test(src));
});

/* ==================================================================
 * C. 三个新页面 WXML
 * ================================================================== */
const ratingWxml = read('pages/rating/rating.wxml');
const communityWxml = read('pages/community/community.wxml');
const profileWxml = read('pages/profile/profile.wxml');

check('C1 评分页有「暂无真实评分数据」', ratingWxml.indexOf('暂无真实评分数据') >= 0);
check('C2 评分页声明未上线', ratingWxml.indexOf('规划中 · 未上线') >= 0);
check('C3 社区页标题是信息板', communityWxml.indexOf('校园餐饮信息板') >= 0);
check('C4 社区页声明发布未开放', communityWxml.indexOf('发布与审核尚未开放') >= 0);
check('C5 社区页每个类型都标空', (communityWxml.match(/暂无已审核内容/g) || []).length === 1, '模板里写一次，由 wx:for 渲染 4 张卡');
check('C6 社区页明确不做社交元素', communityWxml.indexOf('不展示头像、点赞数、评论数') >= 0);
check('C7 我的页声明未接入登录', profileWxml.indexOf('未接入微信登录') >= 0);
check('C8 我的页说明入口不可点', profileWxml.indexOf('没有绑定任何点击事件') >= 0);

check('C9 评分页无虚构分数', !/\d+\.\d+\s*分/.test(ratingWxml) && ratingWxml.indexOf('128 人') < 0);
check('C10 社区页无虚构人数/点赞', !/\d+\s*人/.test(communityWxml));

[['pages/rating/rating.wxml', ratingWxml], ['pages/community/community.wxml', communityWxml], ['pages/profile/profile.wxml', profileWxml]].forEach(function (pair) {
  check('C11 ' + pair[0] + ' 没有绑定点击事件', !/bindtap|catchtap/.test(pair[1]));
  const bal = wxmlBalance(pair[0]);
  check('C12 ' + pair[0] + ' 标签配对', bal.ok, bal.error || '');
});

/* ==================================================================
 * D. 首页没有被削弱
 * ================================================================== */
const indexJs = read('pages/index/index.js');
const indexWxml = read('pages/index/index.wxml');

['onRandomShop', 'onRandomDish', 'onViewAll', 'onReset', 'onSelectSort', 'onRetry', 'onDrawAgain', 'onChangeShop', 'onToggleShop', 'onToggleFloor', 'onToggleStall', 'onToggleSide', 'onToggleFoodType', 'onToggleTaste'].forEach(function (fn) {
  check('D1 首页仍有 ' + fn, indexJs.indexOf(fn + '(') >= 0 || indexJs.indexOf(fn + ':') >= 0);
});

['随机选一家', '随机选一道菜', '查看全部符合条件的美食', '重置筛选条件', '再抽一次', '换一家'].forEach(function (txt) {
  check('D2 首页仍有「' + txt + '」', indexWxml.indexOf(txt) >= 0);
});

check('D3 首页文件未被削短（> 1000 行）', indexJs.split('\n').length > 1000, indexJs.split('\n').length);
check('D4 首页仍有加载/失败/重试三态', indexWxml.indexOf("dataState === 'loading'") >= 0 && indexWxml.indexOf("dataState === 'error'") >= 0 && indexWxml.indexOf('onRetry') >= 0);
check('D5 首页仍有演示数据标识', indexWxml.indexOf('演示数据') >= 0);
check('D6 首页未引用 tabBar 相关 API', !/switchTab/.test(indexJs));

/* ==================================================================
 * E. 全局样式
 * ================================================================== */
const appWxss = read('app.wxss');
check('E1 全局底色是暖纸色', appWxss.indexOf('#FAF6F0') >= 0);
check('E2 全局文字色是墨色', appWxss.indexOf('#241E1A') >= 0);

/* ==================================================================
 * 输出
 * ================================================================== */
console.log('');
console.log('四栏导航与页面静态校验（tools/test_pages.js）');
console.log('--------------------------------------------------');
if (fail) {
  failures.forEach(function (f) {
    console.log('  FAIL  ' + f);
  });
  console.log('--------------------------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项 ❌');
  process.exit(1);
}
console.log('  全部通过：' + pass + ' 项 ✅');
console.log('--------------------------------------------------');
console.log('通过 ' + pass + ' 项，失败 0 项');
