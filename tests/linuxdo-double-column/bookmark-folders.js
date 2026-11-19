/* 本地集成回归：使用正式启动入口，验证话题与楼层收藏的收藏夹菜单及书签名称写入。 */
(async () => {
  'use strict';
  const source = await (await fetch('../../linuxdo-double-column.user.js')).text();
  const startup = source.lastIndexOf("\n  if (document.readyState === 'loading')");
  if (startup < 0) throw new Error('未找到 userscript 启动入口');
  const $ = selector => document.querySelector(selector);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate) {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await wait(20); }
    throw new Error('等待异步状态超时');
  }
  const settle = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };

  const SHARED_FOLDERS_KEY = 'linuxdo-bookmark-folders';
  let writes = [], nextBookmarkId = 8000, holdCreate = false, releaseCreate = null, bookmarkEvents = 0;
  document.addEventListener('linuxdo-bookmarks-changed', () => { bookmarkEvents++; });
  const avatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" rx="24" fill="%23dce8e1"/%3E%3C/svg%3E';
  const fixtures = {};
  function resetFixtures() {
    for (const id of [300, 400]) {
      const posts = Array.from({ length:5 }, (_, i) => ({
        id:id * 100 + i + 1, post_number:i + 1, topic_id:id, username:'local_test', name:'本地测试用户',
        avatar_template:avatar, created_at:'2026-11-01T10:00:00Z', reply_count:0, reply_to_post_number:null,
        actions_summary:[], cooked:`<p>话题 ${id} 第 ${i + 1} 楼。</p>`, bookmarked:false,
      }));
      fixtures[id] = { posts, bookmarks:[] };
    }
    // 第 2 楼的书签在话题书签列表中；第 3 楼只在帖子字段里，验证补全逻辑。
    Object.assign(fixtures[300].posts[1], { bookmarked:true, bookmark_id:7002, bookmark_name:'[开发调优] 备注', bookmark_reminder_at:'2026-12-01T00:00:00.000Z', bookmark_auto_delete_preference:3 });
    fixtures[300].bookmarks.push({ id:7002, bookmarkable_id:30002, bookmarkable_type:'Post', post_number:2, name:'[开发调优] 备注', reminder_at:'2026-12-01T00:00:00.000Z', auto_delete_preference:3 });
    Object.assign(fixtures[300].posts[2], { bookmarked:true, bookmark_id:7003, bookmark_name:'[搞七捻三]', bookmark_reminder_at:null, bookmark_auto_delete_preference:3 });
  }
  resetFixtures();

  const json = (body, status = 200) => Response.json(body, { status });
  window.fetch = async (input, options = {}) => {
    const url = new URL(input, location.href);
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    if (method !== 'GET' && url.pathname !== '/topics/timings') {
      if (options.headers?.['X-CSRF-Token'] !== 'test-csrf') return json(['BAD CSRF'], 403);
      writes.push({ method, path:url.pathname, body });
    }
    const topic = url.pathname.match(/^\/t\/(\d+)\.json$/);
    if (topic) {
      const fixture = fixtures[topic[1]];
      return json({ id:Number(topic[1]), slug:'folder-demo', title:`收藏夹演示 · 话题 ${topic[1]}`, highest_post_number:5,
        last_read_post_number:5, bookmarks:structuredClone(fixture.bookmarks), post_stream:{ posts:structuredClone(fixture.posts), stream:fixture.posts.map(post => post.id) } });
    }
    if (url.pathname === '/bookmarks.json' && method === 'POST') {
      if (holdCreate) await new Promise(resolve => { releaseCreate = resolve; });
      return json({ success:'OK', id:nextBookmarkId++ });
    }
    if (/^\/bookmarks\/\d+\.json$/.test(url.pathname)) return json({ success:'OK' });
    if (url.pathname === '/topics/timings') return json({});
    return json({ errors:[`未模拟的接口 ${method} ${url.pathname}`] }, 404);
  };

  const script = document.createElement('script');
  script.textContent = source.slice(0, startup)
    + '\n  window.bookmarkTestApi = { state, closePanel };\n'
    + source.slice(startup);
  document.head.appendChild(script);
  const { state, closePanel } = window.bookmarkTestApi;

  const click = selector => $(selector).dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, button:0 }));
  const article = number => state.list?.querySelector(`article[data-post-number="${number}"]`);
  const postButton = number => article(number)?.querySelector('.ld-preview-post-footer .ld-preview-bookmark');
  const topicButton = () => state.topicBookmarkButton;
  const openMenu = () => (state.postMenu && !state.postMenu.hidden ? state.postMenu : null);
  const menuLabels = () => [...openMenu().querySelectorAll('.ld-preview-post-menu-option')].map(option => option.textContent);
  const chooseOption = label => [...openMenu().querySelectorAll('.ld-preview-post-menu-option')].find(option => option.textContent === label).click();
  const lastWrite = () => writes.at(-1);
  async function typeFolder(name, init = {}) {
    const input = openMenu().querySelector('.ld-preview-folder-input');
    input.value = name;
    input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true, ...init }));
    await settle();
  }
  async function loaded(id) {
    await until(() => state.currentTopicId === String(id) && !state.panel.classList.contains('is-loading') && !state.topicLoadFailed);
    await settle();
  }
  async function openTopic(id) {
    click(`#topic-${id}`);
    await loaded(id);
  }

  let running = false;
  async function runTests() {
    if (running) return;
    running = true; $('#run-tests').disabled = true; $('#test-results').replaceChildren();
    if (state.open) { closePanel(); await until(() => !state.open); }
    resetFixtures(); writes = []; bookmarkEvents = 0; holdCreate = false;
    localStorage.setItem(SHARED_FOLDERS_KEY, JSON.stringify(['默认收藏', '搞七捻三', '资源荟萃']));
    state.viewMode = 'original';
    await openTopic(300);
    const results = [];
    async function test(name, fn) {
      try { await fn(); results.push({ name, pass:true }); }
      catch (error) { results.push({ name, pass:false, error:error.message }); }
      const result = results.at(-1), li = document.createElement('li');
      li.textContent = `${result.pass ? '✓' : '✗'} ${name}${result.error ? ` — ${result.error}` : ''}`;
      $('#test-results').appendChild(li);
    }

    await test('收藏话题后按默认收藏创建，并弹出收藏夹菜单', async () => {
      topicButton().click(); await until(() => openMenu());
      assert(lastWrite().method === 'POST' && lastWrite().body.bookmarkable_type === 'Topic' && !('name' in lastWrite().body), '应创建无名称的话题书签');
      assert(state.toast.textContent === '已收藏话题到「默认收藏」', `提示不正确：${state.toast.textContent}`);
      assert(menuLabels().join() === '✓ 默认收藏,搞七捻三,资源荟萃,开发调优,取消收藏', `菜单不正确：${menuLabels().join()}`);
      assert(openMenu().classList.contains('opens-down'), '标题栏菜单应向下展开');
    });
    await test('在菜单中选择收藏夹，写入书签名称', async () => {
      chooseOption('资源荟萃'); await until(() => lastWrite().method === 'PUT');
      assert(lastWrite().body.name === '[资源荟萃]' && lastWrite().body.reminder_at === null, `名称不正确：${JSON.stringify(lastWrite().body)}`);
      await until(() => topicButton().title.includes('资源荟萃'));
      assert(!openMenu() && bookmarkEvents === 2, `菜单未关闭或未通知变动（${bookmarkEvents}）`);
    });
    await test('已收藏楼层打开菜单，新建收藏夹时保留备注、提醒和自动删除设置', async () => {
      postButton(2).click(); await until(() => openMenu());
      assert(menuLabels()[0] === '默认收藏' && menuLabels().includes('✓ 开发调优'), `当前收藏夹未标出：${menuLabels().join()}`);
      assert(writes.length === 2, '打开菜单不应发请求');
      await typeFolder('稍后读'); await until(() => lastWrite().body?.name === '[稍后读] 备注');
      assert(lastWrite().path === '/bookmarks/7002.json' && lastWrite().body.reminder_at === '2026-12-01T00:00:00.000Z' && lastWrite().body.auto_delete_preference === 3, `更新参数不正确：${JSON.stringify(lastWrite())}`);
      assert(JSON.parse(localStorage.getItem(SHARED_FOLDERS_KEY)).includes('稍后读'), '新收藏夹没有写入共享列表');
      await until(() => postButton(2).title === '已收藏到「稍后读」，点击更换收藏夹或取消');
    });
    await test('非法名称和输入法确认的回车不提交', async () => {
      const count = writes.length;
      postButton(2).click(); await until(() => openMenu());
      await typeFolder('[坏]');
      assert(state.toast.textContent.includes('不能包含') && openMenu(), '非法名称应提示且保留菜单');
      await typeFolder('稍后看', { isComposing:true });
      await typeFolder('稍后看', { keyCode:229 });
      assert(writes.length === count && openMenu(), '输入法回车不应提交');
      postButton(2).click(); await settle();
      assert(!openMenu(), '再次点击收藏按钮应关闭菜单');
    });
    await test('帖子字段中的书签可改收藏夹，并补进话题书签列表', async () => {
      postButton(3).click(); await until(() => openMenu());
      assert(menuLabels().includes('✓ 搞七捻三'), `当前收藏夹不正确：${menuLabels().join()}`);
      chooseOption('默认收藏'); await until(() => lastWrite().path === '/bookmarks/7003.json');
      assert(lastWrite().body.name === '', '移回默认收藏应清空名称');
      assert(state.topicMeta.bookmarks.some(bookmark => bookmark.id === 7003 && bookmark.name === ''), '书签没有补进话题列表');
      await until(() => postButton(3).title.includes('「默认收藏」'));
    });
    await test('收藏楼层后按 Esc 关闭菜单，不改名称', async () => {
      postButton(1).click(); await until(() => openMenu());
      const count = writes.length;
      assert(lastWrite().body.bookmarkable_type === 'Post' && lastWrite().body.bookmarkable_id === 30001, '应创建楼层书签');
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await settle();
      assert(!openMenu() && state.open && writes.length === count, 'Esc 应只关闭菜单');
      assert(postButton(1).textContent === '★', '楼层应显示已收藏');
    });
    await test('菜单中取消楼层和话题收藏', async () => {
      postButton(1).click(); await until(() => openMenu());
      chooseOption('取消收藏'); await until(() => lastWrite().method === 'DELETE');
      await until(() => postButton(1).textContent === '☆');
      topicButton().click(); await until(() => openMenu());
      chooseOption('取消收藏'); await until(() => topicButton().textContent === '☆');
      assert(lastWrite().method === 'DELETE' && !state.topicMeta.bookmarks.some(bookmark => bookmark.bookmarkable_type === 'Topic'), '话题书签未删除');
    });
    await test('创建请求期间切换话题，不在新话题弹出菜单', async () => {
      holdCreate = true; postButton(4).click(); await until(() => Boolean(releaseCreate));
      const oldBookmarks = state.topicMeta.bookmarks;
      await openTopic(400);
      releaseCreate(); releaseCreate = null; holdCreate = false; await wait(60); await settle();
      assert(!openMenu(), '不应在新话题弹出菜单');
      assert(state.topicMeta.bookmarks.length === 0 && oldBookmarks.some(bookmark => bookmark.bookmarkable_id === 30004), '书签应记在原话题');
      holdCreate = true; topicButton().click(); await until(() => Boolean(releaseCreate));
      await openTopic(300);
      releaseCreate(); releaseCreate = null; holdCreate = false; await wait(60); await settle();
      assert(!openMenu() && topicButton().textContent === '☆', '切回原话题后不应弹出另一话题的菜单');
    });
    await test('收藏夹菜单在楼层底部可见，未超出面板', async () => {
      postButton(2).click(); await until(() => openMenu());
      const menu = openMenu().getBoundingClientRect(), panel = state.panel.getBoundingClientRect();
      assert(menu.left >= panel.left && menu.right <= panel.right + 1 && menu.height > 0, '菜单超出面板');
      postButton(2).click(); await settle();
    });

    const failures = results.filter(result => !result.pass);
    $('#test-status').textContent = `${results.length - failures.length} / ${results.length} 项通过`;
    $('#test-status').dataset.failures = String(failures.length);
    window.bookmarkTestResults = results; running = false; $('#run-tests').disabled = false;
  }
  $('#run-tests').addEventListener('click', runTests);
  await runTests();
})().catch(error => { document.querySelector('#test-status').textContent = `测试启动失败：${error.stack}`; });
