/*!
 * 番剧外链镜像改写
 *
 * 生成的 HTML 里凡是指向 Bangumi 官网（bgm.tv / bangumi.tv）的番剧链接，
 * 统一改写为国内可直连的镜像站，避免读者点进去打不开。
 *
 * - 只匹配「域名就是 bgm.tv / bangumi.tv」的链接；
 *   api.bgm.tv、lain.bgm.tv 这类子域名不在改写范围（正则要求 // 后紧跟域名）。
 * - 想换镜像站，改下面的 MIRROR 即可；想关掉整个改写，把 MIRROR 设为空字符串。
 *
 * 注意：追番更新页（/schedule/）的链接由前端 JS 运行时生成，
 * 不受本过滤器影响，那边直接用的 SITE_BASE（见 source/js/bangumi-schedule.js）。
 */

'use strict';

var MIRROR = 'https://bangumi.vip';

hexo.extend.filter.register('after_render:html', function (str) {
  if (!MIRROR) return str;
  return str.replace(/https?:\/\/(?:www\.)?(?:bgm|bangumi)\.tv\//gi, MIRROR + '/');
});
