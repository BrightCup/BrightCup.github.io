/* 空博客兜底页面
 *
 * hexo-pagination 在文章数为 0 时返回空数组，hexo-generator-index /
 * hexo-generator-archive 都不会产出页面 —— 删掉模板自带的那篇文章后，
 * 首页和归档会直接 404，而侧栏作者卡上的「文章 / 标签 / 分类」正指向它们。
 *
 * 这里只在「一篇文章都没有」时补几个占位页；写过文章之后正常的分页首页
 * 和归档会自动接管，本生成器不再输出任何东西。
 */
hexo.extend.generator.register('empty_site_fallback', function (locals) {
  if (locals.posts.length) return;

  const note =
    '<div style="padding:48px 0;text-align:center;color:var(--b-text3)">' +
    '<p style="font-size:15px;margin:0 0 8px">这里还没有文章</p>' +
    '<p style="font-size:13px;margin:0">先去看看『追番列表』或『放映室』吧</p>' +
    '</div>';

  return [
    { path: 'index.html', layout: ['page'], data: { title: '', content: note } },
    { path: 'archives/index.html', layout: ['page'], data: { title: '归档', content: note } },
    { path: 'tags/index.html', layout: ['page'], data: { title: '标签', content: note } },
    { path: 'categories/index.html', layout: ['page'], data: { title: '分类', content: note } }
  ];
});
