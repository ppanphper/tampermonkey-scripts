/* 本地集成回归：用正式脚本和模拟的 Discourse 书签接口验证收藏与账号书签的双向同步。
 * 用法：在项目根目录启动静态服务器，打开 linuxdo-favorites-sync/tests/index.html?case=main|legacy|switch|original */
(async () => {
  'use strict';
  const testCase = new URLSearchParams(location.search).get('case') || 'main';
  const results = document.getElementById('test-results');
  const statusEl = document.getElementById('test-status');
  const log = message => { results.textContent += `${message}\n`; };
  const $ = selector => document.querySelector(selector);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function assert(condition, message) {
    if (!condition) throw new Error(message);
    log(`✓ ${message}`);
  }
  async function until(predicate, message, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (predicate()) return;
      await wait(25);
    }
    throw new Error(`等待超时：${message}`);
  }

  // ---- GM 存储 ----
  const store = new Map();
  const gm = {
    get: key => (store.has(key) ? JSON.parse(store.get(key)) : null),
    set: (key, value) => store.set(key, JSON.stringify(value)),
  };
  window.GM_getValue = (key, fallback) => (store.has(key) ? JSON.parse(store.get(key)) : fallback);
  window.GM_setValue = (key, value) => store.set(key, JSON.stringify(value));
  window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
  window.GM_registerMenuCommand = () => {};
  const readFavorites = () => JSON.parse(gm.get('linux_do_bookmark_favorites') || '{}');
  const readPending = () => JSON.parse(gm.get('linux_do_bookmark_pending_ops') || '{}');
  const readMeta = () => JSON.parse(gm.get('linux_do_bookmark_sync_meta') || '{}');
  const writeMeta = patch => gm.set('linux_do_bookmark_sync_meta', JSON.stringify({ ...readMeta(), ...patch }));

  // ---- 模拟 Discourse ----
  const topics = {
    101: { title: '话题 101', category_id: 4 },
    102: { title: '话题 102', category_id: 14 },
    103: { title: '话题 103', category_id: 4 },
    104: { title: '<img src=x onerror="window.__xss=1">标题转义', category_id: 14 },
    105: { title: '本地测试话题 105', category_id: 4 },
    106: { title: '话题 106', category_id: 4 },
    107: { title: '话题 107', category_id: 4 },
    108: { title: '话题 108', category_id: 4 },
  };
  const posts = {
    5101: [101, 1], 5103: [102, 3], 5201: [103, 1], 5501: [105, 1], 5502: [105, 2], 5602: [106, 2],
  };
  const server = {
    username: 'local_test',
    bookmarks: [],
    nextId: 9000,
    createsLeft: Infinity,
    requests: [],
  };
  function addServerBookmark(type, targetId, name = '', extra = {}) {
    const topicId = type === 'Topic' ? targetId : posts[targetId][0];
    const bookmark = {
      id: server.nextId++, bookmarkable_type: type, bookmarkable_id: targetId, topic_id: topicId,
      linked_post_number: type === 'Post' ? posts[targetId][1] : 1, name, reminder_at: null, pinned: false,
      created_at: new Date(Date.now() - server.bookmarks.length * 60000).toISOString(), ...extra,
    };
    bookmark.updated_at = bookmark.created_at;
    server.bookmarks.push(bookmark);
    return bookmark;
  }
  const findBookmark = id => server.bookmarks.find(bookmark => bookmark.id === Number(id));
  const serialize = bookmark => ({
    ...bookmark,
    title: topics[bookmark.topic_id].title,
    excerpt: `<p>话题 ${bookmark.topic_id} 摘要 &amp; 内容</p>`,
    bookmarkable_url: `${location.origin}/t/topic/${bookmark.topic_id}${bookmark.bookmarkable_type === 'Post' ? `/${bookmark.linked_post_number}` : ''}`,
    tags: [{ id: 1, name: '测试', slug: '1-tag' }],
    category_id: topics[bookmark.topic_id].category_id,
    slug: 'topic',
    deleted: false,
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.pathname.endsWith('.user.js')) return realFetch(input, options);
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const body = options.body ? JSON.parse(options.body) : null;
    server.requests.push({ method, path: url.pathname + url.search, body });
    await wait(5);

    if (method !== 'GET' && headers['X-CSRF-Token'] !== 'test-csrf') return json(['BAD CSRF'], 403);
    if (url.pathname === '/session/csrf.json') return json({ csrf: 'test-csrf' });
    if (url.pathname === '/session/current.json') return json({ current_user: { username: server.username } });
    if (url.pathname === '/site.json') return json({ categories: [{ id: 4, name: '开发调优' }, { id: 14, name: '资源荟萃' }] });

    const list = url.pathname.match(/^\/u\/([^/]+)\/bookmarks\.json$/);
    if (list) {
      if (list[1] !== server.username) return json({ errors: ['无权查看'] }, 403);
      const page = Number(url.searchParams.get('page') || 0);
      const sorted = [...server.bookmarks].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
      const items = sorted.slice(page * 20, page * 20 + 20).map(serialize);
      if (!items.length) return json({ bookmarks: [] });
      return json({ user_bookmark_list: { more_bookmarks_url: `/u/${list[1]}/bookmarks.json?page=${page + 1}`, bookmarks: items } });
    }

    if (url.pathname === '/bookmarks.json' && method === 'POST') {
      if (server.createsLeft <= 0) {
        return json({ errors: ['你执行此操作的次数过多。请等待 23 小时后再试。'], error_type: 'rate_limit', extras: { wait_seconds: 82800, time_left: '23 小时' } }, 429);
      }
      const exists = server.bookmarks.some(bookmark => bookmark.bookmarkable_type === body.bookmarkable_type && bookmark.bookmarkable_id === body.bookmarkable_id);
      if (exists) return json({ errors: ['你已经为此帖子添加了书签'] }, 400);
      if (body.bookmarkable_type === 'Post' && !posts[body.bookmarkable_id]) return json({ errors: ['帖子不存在'] }, 400);
      server.createsLeft--;
      const bookmark = addServerBookmark(body.bookmarkable_type, body.bookmarkable_id, body.name || '');
      bookmark.created_at = bookmark.updated_at = new Date().toISOString();
      return json({ success: 'OK', id: bookmark.id });
    }

    const pin = url.pathname.match(/^\/bookmarks\/(\d+)\/toggle_pin\.json$/);
    if (pin && method === 'PUT') {
      const bookmark = findBookmark(pin[1]);
      if (!bookmark) return json({ errors: ['not found'] }, 404);
      bookmark.pinned = !bookmark.pinned;
      return json({ success: 'OK' });
    }

    const single = url.pathname.match(/^\/bookmarks\/(\d+)\.json$/);
    if (single) {
      const bookmark = findBookmark(single[1]);
      if (!bookmark) return json({ errors: ['not found'] }, 404);
      if (method === 'PUT') {
        // 与 BookmarkManager#update 一致：未传 pinned 时置顶状态会被清掉
        bookmark.name = body.name;
        if (bookmark.reminder_at !== body.reminder_at) bookmark.reminder_at = body.reminder_at;
        bookmark.pinned = false;
        bookmark.updated_at = new Date().toISOString();
        return json({ success: 'OK' });
      }
      if (method === 'DELETE') {
        server.bookmarks.splice(server.bookmarks.indexOf(bookmark), 1);
        return json({ success: 'OK' });
      }
    }

    const topic = url.pathname.match(/^\/t\/(\d+)\.json$/);
    if (topic) {
      const topicId = Number(topic[1]);
      const bookmarks = server.bookmarks.filter(bookmark => bookmark.topic_id === topicId)
        .map(({ id, bookmarkable_id, bookmarkable_type, name, reminder_at, pinned }) => ({ id, bookmarkable_id, bookmarkable_type, name, reminder_at, pinned }));
      return json({ id: topicId, title: topics[topicId]?.title, bookmarks, post_stream: { posts: [{ cooked: '<p>楼主</p>' }] } });
    }
    const post = url.pathname.match(/^\/posts\/(\d+)\.json$/);
    if (post) return json({ cooked: `<p>帖子 ${post[1]} 内容</p>` });

    return json({ errors: [`未模拟的接口 ${method} ${url.pathname}`] }, 500);
  };

  const writes = () => server.requests.filter(request => request.method !== 'GET');
  const toasts = [];
  new MutationObserver(() => {
    const text = $('#ld-fav-toast')?.textContent;
    if (text && toasts[toasts.length - 1] !== text) toasts.push(text);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });

  async function startScript() {
    const source = await (await realFetch('../linuxdo-favorites-sync.user.js')).text();
    new Function(source)();
  }
  const pendingCount = () => Object.keys(readPending()).length;
  const serverNames = () => Object.fromEntries(server.bookmarks.map(bookmark => [`${bookmark.bookmarkable_type}:${bookmark.bookmarkable_id}`, bookmark.name]));
  const clickFavButton = postId => $(`article[data-post-id="${postId}"] .ld-fav-post-btn`).click();
  async function chooseFolder(folder) {
    await until(() => $('#ld-fav-add-dialog.show'), '收藏夹选择框出现');
    $(`#ld-fav-folder-list .ld-fav-folder-item[data-folder="${folder}"]`).click();
  }
  async function openPanel() {
    if (!$('#ld-fav-panel.show')) $('#ld-fav-sidebar-btn').click();
    await until(() => $('#ld-fav-panel.show #ld-fav-panel-list'), '收藏面板打开');
  }
  async function selectPanelItems(ids) {
    for (const id of ids) {
      const checkbox = $(`.ld-fav-panel-item[data-id="${id}"] .ld-fav-panel-item-checkbox`);
      if (!checkbox.checked) checkbox.click();
    }
  }
  async function moveSelectedTo(folder) {
    $('[data-bulk-action="toggle-move"]').click();
    const index = JSON.parse(gm.get('linux_do_folders')).indexOf(folder);
    $(`.ld-fav-panel-bulk-folder[data-bulk-folder-index="${index}"]`).click();
  }
  const settled = () => pendingCount() === 0;

  async function runMain() {
    const b1 = addServerBookmark('Topic', 101);
    const b2 = addServerBookmark('Post', 5103, '[开发调优] 稍后读', { reminder_at: '2026-12-01T00:00:00.000Z', pinned: true });
    const b3 = addServerBookmark('Post', 5201, '稍后看');
    addServerBookmark('Topic', 104);
    gm.set('linux_do_folders', JSON.stringify(['默认收藏', '搞七捻三']));
    await startScript();

    await until(() => Object.keys(readFavorites()).length === 4, '启动时拉取书签');
    let favorites = readFavorites();
    assert(favorites['101_101'].folder === '默认收藏' && !favorites['101_101'].isPost, '无名称的话题书签进入默认收藏');
    assert(favorites['102_5103'].folder === '开发调优' && favorites['102_5103'].bookmarkNote === '稍后读', '「[收藏夹] 备注」解析出收藏夹和备注');
    assert(favorites['102_5103'].title === '话题 102 - #3' && favorites['102_5103'].url === '/t/topic/102/3', '回复书签的标题和链接带楼层');
    assert(favorites['103_5201'].folder === '默认收藏' && favorites['103_5201'].bookmarkNote === '稍后看', '普通书签名称保留为备注');
    assert(favorites['101_101'].category === '开发调优' && favorites['101_101'].tags[0] === '测试', '分类名和标签来自站点数据');
    assert(JSON.parse(gm.get('linux_do_folders')).join() === '默认收藏,搞七捻三,开发调优', '书签里的收藏夹追加到列表末尾');
    assert(writes().length === 0, '启动拉取不产生写请求');

    // 新收藏 → 新建书签（首个写请求会遇到过期的 CSRF，自动刷新后重试）
    await until(() => $('article[data-post-id="5502"] .ld-fav-post-btn'), '帖子收藏按钮插入');
    clickFavButton(5502);
    await chooseFolder('搞七捻三');
    await until(() => readFavorites()['105_5502']?.bookmarkId && settled(), '新收藏写入书签');
    assert(serverNames()['Post:5502'] === '[搞七捻三]', '新收藏创建为带收藏夹名的帖子书签');
    assert(server.requests.some(request => request.path === '/session/csrf.json'), 'CSRF 失效时自动刷新');
    assert($('article[data-post-id="5502"] .ld-fav-post-btn').classList.contains('favorited'), '收藏按钮显示已收藏');

    // 面板里批量移动 → 修改书签名称，保留备注、提醒和置顶
    await openPanel();
    const xssLink = $('.ld-fav-panel-item[data-id="104_104"] .ld-fav-panel-item-title');
    assert(xssLink.textContent.startsWith('<img') && !window.__xss && !xssLink.querySelector('img'), '书签标题按文本渲染');
    await selectPanelItems(['102_5103']);
    await moveSelectedTo('搞七捻三');
    await until(() => serverNames()['Post:5103'] === '[搞七捻三] 稍后读' && settled(), '移动收藏夹后改书签名称');
    assert(b2.reminder_at === '2026-12-01T00:00:00.000Z', '修改名称时保留提醒时间');
    assert(b2.pinned === true, '修改名称后补回置顶状态');

    // 取消收藏 → 删除书签
    const created5502 = readFavorites()['105_5502'].bookmarkId;
    clickFavButton(5502);
    await until(() => !findBookmark(created5502) && settled(), '取消收藏删除书签');
    assert(!readFavorites()['105_5502'], '本地缓存同步移除');

    // 达到每日新建上限：新建排队，修改照常
    server.createsLeft = 0;
    clickFavButton(5501);
    await chooseFolder('搞七捻三');
    await until(() => readMeta().createBlockedUntil > Date.now(), '记录新建限额');
    assert(toasts.some(text => text.includes('上限') && text.includes('23 小时')), '提示新建书签已达上限');
    assert(readPending()['105_5501']?.type === 'upsert', '超出上限的收藏留在待同步队列');
    $('.ld-fav-panel-folder[data-folder="全部"]').click();
    await until(() => $('.ld-fav-panel-item[data-id="105_5501"] .ld-fav-panel-item-sync'), '面板标记等待同步');
    await selectPanelItems(['103_5201']);
    await moveSelectedTo('搞七捻三');
    await until(() => serverNames()['Post:5201'] === '[搞七捻三] 稍后看', '限额期间修改名称照常同步');
    assert(readPending()['105_5501'], '限额期间新建仍在排队');

    // 限额恢复后，原生界面已收藏过的帖子：创建失败 → 找到现有书签并改名
    const native = addServerBookmark('Post', 5501, '');
    server.createsLeft = Infinity;
    writeMeta({ createBlockedUntil: 0 });
    await selectPanelItems(['101_101']);
    await moveSelectedTo('开发调优');
    await until(() => settled() && serverNames()['Topic:101'] === '[开发调优]', '恢复后处理队列');
    assert(native.name === '[搞七捻三]' && readFavorites()['105_5501'].bookmarkId === native.id, '已存在的书签被认领并写入收藏夹名');
    assert(server.bookmarks.filter(bookmark => bookmark.bookmarkable_id === 5501).length === 1, '没有产生重复书签');

    // 重命名收藏夹 → 批量改名
    $('.ld-fav-panel-folder[data-folder="搞七捻三"] .ld-fav-panel-folder-btn.rename').click();
    const renameInput = $('.ld-fav-panel-rename-input');
    renameInput.value = '杂谈';
    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => settled() && serverNames()['Post:5103'] === '[杂谈] 稍后读', '重命名收藏夹');
    assert(serverNames()['Post:5201'] === '[杂谈] 稍后看' && serverNames()['Post:5501'] === '[杂谈]', '收藏夹内所有书签同步改名');

    // 非法收藏夹名被拒绝
    $('.ld-fav-panel-folder[data-folder="杂谈"] .ld-fav-panel-folder-btn.rename').click();
    const badInput = $('.ld-fav-panel-rename-input');
    badInput.value = '[坏]';
    badInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(400);
    assert(serverNames()['Post:5103'] === '[杂谈] 稍后读' && toasts.some(text => text.includes('不能包含')), '含方括号的收藏夹名被拒绝');

    // 删除收藏夹 → 删除其中的书签
    $('.ld-fav-panel-folder[data-folder="杂谈"] .ld-fav-panel-folder-btn.delete').click();
    assert($('#ld-fav-confirm-title').textContent.includes('3 条收藏对应的 linux.do 书签'), '删除收藏夹前说明会删除的书签数');
    $('#ld-fav-confirm-ok').click();
    await until(() => settled() && server.bookmarks.length === 2, '删除收藏夹');
    assert(server.bookmarks.every(bookmark => [101, 104].includes(bookmark.bookmarkable_id)), '只删除该收藏夹内的书签');

    // 导入原版 JSON 备份：匹配已有书签只改名，缺少的新建，从不删除
    const deletesBefore = writes().filter(request => request.method === 'DELETE').length;
    $('#ld-fav-panel-settings').click();
    await until(() => $('#ld-fav-sync-summary')?.textContent.includes('local_test'), '设置页显示同步状态');
    let fileInput = null;
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') { fileInput = this; return; }
      return originalClick.call(this);
    };
    $('#ld-fav-import-data').click();
    HTMLInputElement.prototype.click = originalClick;
    const backup = {
      schemaVersion: 1,
      folders: ['默认收藏', '资源荟萃', '福利羊毛'],
      favorites: {
        104: { id: '104', topicId: '104', title: '旧标题', url: '/t/topic/104', folder: '资源荟萃', addedAt: 1700000000000 },
        '101_5101': { id: '101_5101', topicId: '101', postId: '5101', postNumber: '1', isPost: true, title: '话题 101', url: '/t/topic/101', folder: '福利羊毛', addedAt: 1700000001000 },
        '106_5602': { id: '106_5602', topicId: '106', postId: '5602', postNumber: '2', isPost: true, title: '话题 106 - #2', url: '/t/topic/106/2', folder: '资源荟萃', addedAt: 1700000002000 },
        '107_107': { id: '107_107', topicId: '107', title: '话题 107', url: '/t/topic/107', folder: '[坏]名<字>', addedAt: 1700000003000 },
      },
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change'));
    await until(() => settled() && server.bookmarks.length === 4, '导入备份');
    const names = serverNames();
    assert(names['Topic:104'] === '[资源荟萃]' && names['Topic:101'] === '[福利羊毛]', '备份中的收藏匹配到已有书签（含楼主帖与话题书签）');
    assert(names['Post:5602'] === '[资源荟萃]' && names['Topic:107'] === '[坏名字]', '缺少的收藏新建书签，非法字符被清理');
    assert(writes().filter(request => request.method === 'DELETE').length === deletesBefore, '导入不删除任何书签');
    assert(toasts.some(text => text.includes('已有书签 2 条已归类，新建书签 2 条')), '提示导入结果');
    assert(readFavorites()['104_104'].addedAt === 1700000000000, '保留备份中的收藏时间');

    // 书签页批量归类：先拉取原生新增的书签，只移动默认收藏里的
    addServerBookmark('Topic', 108);
    writeMeta({ lastPullAt: 0 });
    history.pushState({}, '', '/u/local_test/activity/bookmarks');
    $('#bookmark-list-host').innerHTML = `<table><thead><tr><th>话题</th><th></th></tr></thead><tbody>
      ${[101, 104, 108].map(id => `<tr class="bookmark-list-item"><td><a class="title" data-topic-id="${id}" href="/t/topic/${id}">话题 ${id}</a></td><td><details></details></td></tr>`).join('')}
    </tbody></table>`;
    await until(() => $('.ld-fav-bookmark-import-btn'), '书签页插入批量归类按钮');
    $('.ld-fav-bookmark-import-btn').click();
    await until(() => $('#ld-fav-bulk-import-desc').textContent.includes('其中 1 个在「默认收藏」'), '拉取后统计未归类书签');
    $('#ld-fav-bulk-import-new-folder').value = '稍后读';
    $('#ld-fav-bulk-import-confirm').click();
    await until(() => settled() && serverNames()['Topic:108'] === '[稍后读]', '批量归类');
    assert(serverNames()['Topic:101'] === '[福利羊毛]' && serverNames()['Topic:104'] === '[资源荟萃]', '已归类的书签保持不变');
    assert($('tr.bookmark-list-item .ld-fav-bookmark-btn').title.includes('删除书签'), '书签页取消按钮说明会删除书签');
    history.pushState({}, '', '/linuxdo-favorites-sync/tests/index.html?case=main');

    // 与双栏脚本的约定：收藏夹列表写入页面 localStorage，收到书签变动事件后立即拉取
    const sharedFolders = () => JSON.parse(localStorage.getItem('linuxdo-bookmark-folders') || '[]');
    assert(sharedFolders().join() === JSON.parse(gm.get('linux_do_folders')).join(), '收藏夹列表同步写入共享存储');
    addServerBookmark('Post', 5101, '[双栏新建]');
    document.dispatchEvent(new CustomEvent('linuxdo-bookmarks-changed'));
    await until(() => readFavorites()['101_5101']?.folder === '双栏新建', '收到双栏通知后拉取');
    assert(sharedFolders().includes('双栏新建'), '拉取到的新收藏夹同步到共享存储');
  }

  async function runLegacy() {
    addServerBookmark('Topic', 101);
    gm.set('linux_do_favorites', JSON.stringify({
      101: { id: '101', topicId: '101', title: '话题 101', url: '/t/topic/101', folder: '开发调优', addedAt: 1690000000000 },
      '105_5502': { id: '105_5502', topicId: '105', postId: '5502', postNumber: '2', isPost: true, title: '话题 105 - #2', url: '/t/topic/105/2', folder: '默认收藏', addedAt: 1690000001000 },
    }));
    gm.set('linux_do_folders', JSON.stringify(['默认收藏', '开发调优']));
    await startScript();
    await until(() => settled() && server.bookmarks.length === 2 && serverNames()['Topic:101'] === '[开发调优]', '同存储升级时迁移原版收藏');
    assert(serverNames()['Post:5502'] === '', '默认收藏的收藏新建为无名称书签');
    assert(readMeta().legacyImportedAt > 0 && toasts.some(text => text.includes('已迁移原版本地收藏')), '迁移只执行一次并提示结果');
    assert(gm.get('linux_do_favorites'), '原版数据保留不删');
  }

  async function runSwitch() {
    addServerBookmark('Topic', 101, '[开发调优]');
    gm.set('linux_do_bookmark_sync_meta', JSON.stringify({ username: 'other_user', lastPullAt: 0 }));
    gm.set('linux_do_bookmark_favorites', JSON.stringify({ '102_102': { id: '102_102', topicId: '102', title: '别人的收藏', folder: '默认收藏', bookmarkId: 1 } }));
    gm.set('linux_do_bookmark_pending_ops', JSON.stringify({ '103_103': { type: 'upsert', bookmarkId: null, seq: 1 } }));
    await startScript();
    await until(() => readFavorites()['101_101'], '切换账号后拉取当前账号书签');
    await wait(800);
    assert(!readFavorites()['102_102'] && pendingCount() === 0, '上一个账号的缓存和待同步队列被清空');
    assert(writes().length === 0 && readMeta().username === 'local_test', '不会把上一个账号的修改推送到当前账号');
  }

  async function runOriginal() {
    const legacyModal = document.createElement('div');
    legacyModal.id = 'ld-fav-modal';
    document.body.append(legacyModal);
    await startScript();
    await until(() => toasts.length, '检测到原版脚本');
    assert(toasts[0].includes('请先在脚本管理器中停用') && !$('#ld-fav-panel'), '原版仍在运行时不初始化，避免元素冲突');
    assert(server.requests.length === 0, '不发起同步请求');
  }

  try {
    await ({ main: runMain, legacy: runLegacy, switch: runSwitch, original: runOriginal })[testCase]();
    statusEl.textContent = `PASS（${testCase}）`;
    statusEl.style.color = '#126637';
  } catch (error) {
    statusEl.textContent = `FAIL（${testCase}）：${error.message}`;
    statusEl.style.color = '#b42318';
    log(error.stack);
  }
  window.__testResult = { case: testCase, status: statusEl.textContent, log: results.textContent, requests: server.requests };
})();
