/* 本地集成回归：使用正式启动入口，验证楼层 Boost 的发送、删除、举报、实时推送、长度校验与失败处理。 */
(async () => {
  'use strict';
  const source = await (await fetch('../linuxdo-double-column.user.js')).text();
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

  let writes = [], reads = [], failNext = null, failDelete = false, failFlag = false, holdCreate = false, releaseCreate = null, nextBoostId = 900;
  const avatar = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" rx="24" fill="%23dce8e1"/%3E%3C/svg%3E';
  const me = { id:1, username:'local_test', name:'本地测试用户', avatar_template:avatar };
  const fixtures = {};
  function resetFixtures() {
    for (const id of [300, 400]) {
      const posts = Array.from({ length:5 }, (_, i) => ({
        id:id * 100 + i + 1, post_number:i + 1, topic_id:id, username:`author_${i + 1}`, name:`作者 ${i + 1}`,
        avatar_template:avatar, created_at:'2026-11-01T10:00:00Z', reply_count:0, reply_to_post_number:null,
        actions_summary:[], cooked:`<p>话题 ${id} 第 ${i + 1} 楼。</p>`, boosts:[], can_boost:true,
      }));
      fixtures[id] = { posts };
    }
    // 第 2 楼已有本人 Boost，服务端返回 can_boost=false；第 3 楼已有他人 Boost；第 5 楼未带该字段（如未登录）。
    Object.assign(fixtures[300].posts[1], { can_boost:false, boosts:[{ id:800, cooked:'<p>已发过</p>', can_delete:true, user:me }] });
    delete fixtures[300].posts[4].can_boost;
    // 他人的 Boost 带 can_delete，模拟版主可删除。
    fixtures[300].posts[2].boosts = [{ id:801, cooked:'<p>前排</p>', can_delete:true, user:{ id:2, username:'other', avatar_template:avatar } }];
    // 第 5 楼用于举报：两条可举报，一条已在审核中。
    const flaggable = { can_delete:false, can_flag:true, available_flags:['off_topic', 'inappropriate', 'spam', 'illegal', 'notify_moderators'], user_flag_status:null };
    fixtures[300].posts[4].boosts = [
      { id:802, cooked:'<p>路人</p>', ...flaggable, user:{ id:4, username:'passer', avatar_template:avatar } },
      { id:803, cooked:'<p>已举报过</p>', ...flaggable, user_flag_status:'pending', user:{ id:5, username:'flagged', avatar_template:avatar } },
      { id:804, cooked:'<p>再来</p>', ...flaggable, user:{ id:6, username:'again', avatar_template:avatar } },
    ];
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
      return json({ id:Number(topic[1]), slug:'boost-demo', title:`Boost 演示 · 话题 ${topic[1]}`, highest_post_number:5,
        last_read_post_number:5, post_stream:{ posts:structuredClone(fixture.posts), stream:fixture.posts.map(post => post.id) } });
    }
    const boost = url.pathname.match(/^\/discourse-boosts\/posts\/(\d+)\/boosts$/);
    if (boost && method === 'POST') {
      if (holdCreate) await new Promise(resolve => { releaseCreate = resolve; });
      if (failNext) { const failure = failNext; failNext = null; return json(failure.body, failure.status); }
      return json({ id:nextBoostId++, cooked:`<p>${body.raw}</p>`, can_delete:true, can_flag:false, user:me });
    }
    if (/^\/discourse-boosts\/boosts\/\d+\/flags$/.test(url.pathname) && method === 'POST') {
      if (failFlag) { failFlag = false; return json({ errors:['你已经举报过了'] }, 422); }
      return json({ success:'OK' });
    }
    if (url.pathname === '/discourse-boosts/boosts/950' && method === 'GET') {
      reads.push(url.pathname);
      return json({ id:950, can_delete:false, can_flag:true, available_flags:['spam'], user_flag_status:null });
    }
    if (/^\/discourse-boosts\/boosts\/\d+$/.test(url.pathname) && method === 'DELETE') {
      if (failDelete) { failDelete = false; return json({ errors:['删除太频繁'] }, 429); }
      return new Response(null, { status:204 });
    }
    if (url.pathname === '/topics/timings') return json({});
    return json({ errors:[`未模拟的接口 ${method} ${url.pathname}`] }, 404);
  };

  // 模拟 #data-preloaded：当前用户、站点设置和举报类型（含不适用于 Boost 的、已停用的类型，验证过滤）。
  const preloaded = document.createElement('script');
  preloaded.type = 'application/json';
  preloaded.id = 'data-preloaded';
  const boostTarget = ['Post', 'DiscourseBoosts::Boost'];
  preloaded.textContent = JSON.stringify({
    currentUser:JSON.stringify({ id:1, username:'local_test' }),
    siteSettings:JSON.stringify({ min_personal_message_post_length:3 }),
    site:JSON.stringify({ post_action_types:[
      { id:2, name_key:'like', name:'赞', is_flag:false, enabled:true, applies_to:[], position:0 },
      { id:6, name_key:'notify_user', name:'私信', is_flag:true, enabled:true, require_message:true, applies_to:['Post'], position:1 },
      { id:7, name_key:'notify_moderators', name:'其他内容', description:'需要管理人员注意', is_flag:true, enabled:true, require_message:true, applies_to:boostTarget, position:9 },
      { id:3, name_key:'off_topic', name:'偏离话题', description:'与讨论<b>无关</b>', is_flag:true, enabled:true, require_message:false, applies_to:boostTarget, position:2 },
      { id:4, name_key:'inappropriate', name:'不当言论', is_flag:true, enabled:false, require_message:false, applies_to:boostTarget, position:3 },
      { id:8, name_key:'spam', name:'垃圾信息', is_flag:true, enabled:true, require_message:false, applies_to:boostTarget, position:4 },
      { id:10, name_key:'illegal', name:'非法', is_flag:true, enabled:true, require_message:true, applies_to:boostTarget, position:8 },
    ] }),
  });
  document.head.appendChild(preloaded);

  // 模拟 Discourse MessageBus：脚本订阅 /topic/{id}，测试直接推送消息。
  const bus = new Map();
  window.MessageBus = {
    subscribe:(channel, handler) => { bus.set(channel, handler); },
    unsubscribe:channel => { bus.delete(channel); },
  };
  const publish = async (topicId, message) => { bus.get(`/topic/${topicId}`)?.(message); await settle(); };

  const script = document.createElement('script');
  script.textContent = source.slice(0, startup)
    + '\n  window.boostTestApi = { state, closePanel };\n'
    + source.slice(startup);
  document.head.appendChild(script);
  const { state, closePanel } = window.boostTestApi;

  const click = selector => $(selector).dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, button:0 }));
  const article = number => state.list?.querySelector(`article[data-post-number="${number}"]`);
  const boostButton = number => {
    const button = article(number)?.querySelector('.ld-preview-post-footer .ld-preview-boost-button');
    return button && !button.closest('[hidden]') ? button : null;
  };
  const bubble = (number, text) => [...(article(number)?.querySelectorAll('.ld-preview-boost') || [])]
    .find(item => item.querySelector('.ld-preview-boost-text').textContent === text);
  const deleteControl = (number, text) => bubble(number, text)?.querySelector('.ld-preview-boost-delete');
  const actionLabels = (number, text) => [...(bubble(number, text)?.querySelectorAll('.ld-preview-boost-action') || [])].map(item => item.textContent);
  const expand = async (number, text) => { bubble(number, text).querySelector('.ld-preview-boost-text').click(); await settle(); };
  const flagButton = (number, text) => [...bubble(number, text).querySelectorAll('.ld-preview-boost-action')].find(item => item.textContent === '举报');
  const flagOptions = () => [...openMenu().querySelectorAll('.ld-preview-post-menu-option:not(.ld-preview-boost-flag-submit)')];
  const chooseFlag = async name => { flagOptions().find(option => option.textContent.endsWith(name)).click(); await settle(); };
  const flagSubmit = () => openMenu().querySelector('.ld-preview-boost-flag-submit');
  async function typeMessage(value) {
    const message = openMenu().querySelector('.ld-preview-boost-flag-message');
    message.value = value;
    message.dispatchEvent(new Event('input', { bubbles:true }));
    await settle();
  }
  const bubbles = number => [...(article(number)?.querySelectorAll(':scope > .ld-preview-boosts .ld-preview-boost-text') || [])].map(text => text.textContent);
  const openMenu = () => (state.postMenu && !state.postMenu.hidden ? state.postMenu : null);
  const input = () => openMenu().querySelector('.ld-preview-boost-input');
  const submitButton = () => openMenu().querySelector('.ld-preview-post-menu-option');
  const lastWrite = () => writes.at(-1);
  async function type(value, init = null) {
    input().value = value;
    input().dispatchEvent(new Event('input', { bubbles:true }));
    if (init) input().dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true, ...init }));
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
    resetFixtures(); writes = []; reads = []; failNext = null; failDelete = false; failFlag = false; holdCreate = false;
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

    await test('只在 can_boost 为真的楼层显示 🚀，位于复制链接与更多之间', async () => {
      assert(boostButton(1) && !boostButton(2) && !boostButton(5), '🚀 显示条件不正确');
      assert(!article(5).querySelector('.ld-preview-boost-wrap'), '未带 can_boost 的楼层不应创建按钮');
      const labels = [...article(1).querySelector('.ld-preview-post-footer').children].map(node => node.textContent.trim().slice(0, 2));
      assert(labels.indexOf('🔗') + 1 === labels.indexOf('🚀') && labels.indexOf('🚀') + 1 === labels.findIndex(label => label.startsWith('⋯')), `按钮顺序不正确：${labels.join(' ')}`);
    });
    await test('打开输入框：聚焦、占位提示被 Boost 的用户、空内容不可发送', async () => {
      boostButton(1).click(); await until(() => openMenu());
      assert(document.activeElement === input(), '输入框未聚焦');
      assert(input().placeholder === 'Boost author_1…', `占位提示不正确：${input().placeholder}`);
      assert(submitButton().disabled && openMenu().textContent.includes('0/16'), '空内容应禁用发送');
    });
    await test('超过 16 个字或 5 个表情时提示，不发请求', async () => {
      await type('一二三四五六七八九十一二三四五六七', { });
      assert(openMenu().querySelector('.ld-preview-boost-count').classList.contains('is-over'), '超长计数未标红');
      assert(writes.length === 0 && state.toast.textContent === 'Boost 最多 16 个字', `超长提示不正确：${state.toast.textContent}`);
      await type('👍🏻👨‍👩‍👧‍👦:tada:🎉😀😂', { });
      assert(openMenu().textContent.includes('6/16'), '表情未按字形簇计数');
      assert(writes.length === 0 && state.toast.textContent === 'Boost 最多 5 个表情', `表情提示不正确：${state.toast.textContent}`);
    });
    await test('输入法确认候选词的回车不提交', async () => {
      await type('支持', { isComposing:true });
      await type('支持', { keyCode:229 });
      assert(writes.length === 0 && openMenu(), '输入法回车不应提交');
    });
    await test('服务端拒绝时提示原因，保留输入框和内容', async () => {
      failNext = { status:422, body:{ errors:['你已经 Boost 过这个帖子了'] } };
      await type(' 支持一下 ', { }); await until(() => writes.length === 1);
      await until(() => state.toast.textContent === '你已经 Boost 过这个帖子了');
      assert(openMenu() && input().value === ' 支持一下 ' && !input().disabled && boostButton(1), '失败后应保留输入框');
    });
    await test('回车发送：去掉首尾空白，就地追加气泡并移除 🚀', async () => {
      await type(' 支持一下 ', { }); await until(() => writes.length === 2);
      assert(lastWrite().method === 'POST' && lastWrite().path === '/discourse-boosts/posts/30001/boosts' && lastWrite().body.raw === '支持一下', `请求不正确：${JSON.stringify(lastWrite())}`);
      await until(() => bubbles(1).length === 1);
      assert(bubbles(1)[0] === '支持一下' && !boostButton(1) && !openMenu(), '发送后气泡或按钮状态不正确');
      assert(article(1).querySelector(':scope > .ld-preview-post-footer + .ld-preview-boosts'), '气泡应位于操作栏下方');
      assert(state.toast.textContent === 'Boost 已发送', `提示不正确：${state.toast.textContent}`);
    });
    await test('已有气泡的楼层追加到末尾；点击发送按钮同样提交', async () => {
      boostButton(3).click(); await until(() => openMenu());
      await type('后排'); submitButton().click(); await until(() => bubbles(3).length === 2);
      assert(bubbles(3).join() === '前排,后排' && article(3).querySelectorAll(':scope > .ld-preview-boosts').length === 1, `气泡不正确：${bubbles(3).join()}`);
    });
    await test('Esc 只关闭输入框，再次点击 🚀 也可关闭', async () => {
      boostButton(4).click(); await until(() => openMenu());
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await settle();
      assert(!openMenu() && state.open, 'Esc 应只关闭输入框');
      boostButton(4).click(); await until(() => openMenu());
      boostButton(4).click(); await settle();
      assert(!openMenu(), '再次点击 🚀 应关闭输入框');
    });
    await test('点击自己的 Boost 显示删除，删除后恢复 🚀', async () => {
      assert(!deleteControl(2, '已发过'), '删除按钮应先隐藏');
      await expand(2, '已发过');
      assert(actionLabels(2, '已发过').join() === '删除', `本人的 Boost 只应可删除：${actionLabels(2, '已发过').join()}`);
      deleteControl(2, '已发过').click(); await until(() => !article(2).querySelector('.ld-preview-boosts'));
      assert(lastWrite().method === 'DELETE' && lastWrite().path === '/discourse-boosts/boosts/800', `请求不正确：${JSON.stringify(lastWrite())}`);
      assert(boostButton(2) && state.toast.textContent === 'Boost 已删除', '删除后应恢复 🚀 并提示');
    });
    await test('删除他人的 Boost 需再次确认；失败时保留气泡', async () => {
      const count = writes.length;
      await expand(3, '前排');
      deleteControl(3, '前排').click(); await settle();
      assert(writes.length === count && deleteControl(3, '前排').textContent === '确认删除', '第一次点击只应进入确认');
      failDelete = true; deleteControl(3, '前排').click(); await until(() => state.toast.textContent === '删除太频繁');
      assert(bubble(3, '前排') && !deleteControl(3, '前排').disabled, '失败后应保留气泡并可重试');
      deleteControl(3, '前排').click(); await until(() => !bubble(3, '前排'));
      assert(bubbles(3).join() === '后排' && !boostButton(3), `删除他人 Boost 后状态不正确：${bubbles(3).join()}`);
    });
    await test('实时推送：他人新增与删除，重复推送和未加载楼层不出错', async () => {
      const message = { type:'boost_added', id:30004, boost:{ id:950, cooked:'<p>路过</p>', user:{ id:3, username:'third', avatar_template:avatar } } };
      await publish(300, message); await publish(300, message);
      await publish(300, { ...message, id:999999 });
      assert(bubbles(4).join() === '路过' && boostButton(4), `新增推送不正确：${bubbles(4).join()}`);
      await expand(4, '路过'); await until(() => actionLabels(4, '路过').length);
      assert(reads.join() === '/discourse-boosts/boosts/950' && actionLabels(4, '路过').join() === '举报', `推送的 Boost 应点击后查询权限：${actionLabels(4, '路过').join()}`);
      await publish(300, { type:'boost_removed', id:30004, boost_id:950 });
      assert(!article(4).querySelector('.ld-preview-boosts'), '删除推送后气泡应移除');
    });
    await test('实时推送本人的 Boost：关闭输入框并隐藏 🚀，可删除；删除推送后恢复', async () => {
      boostButton(4).click(); await until(() => openMenu());
      await publish(300, { type:'boost_added', id:30004, boost:{ id:951, cooked:'<p>别处发的</p>', user:{ id:1, username:'local_test', avatar_template:avatar } } });
      assert(!openMenu() && !boostButton(4), '本人推送后应关闭输入框并隐藏 🚀');
      await expand(4, '别处发的');
      assert(actionLabels(4, '别处发的').join() === '删除' && reads.length === 1, '本人推送的 Boost 应直接可删除');
      await publish(300, { type:'boost_removed', id:30004, boost_id:951 });
      assert(boostButton(4) && bubbles(4).length === 0, '删除推送后应恢复 🚀');
    });
    await test('发送结果与实时推送先后到达，只显示一条', async () => {
      boostButton(4).click(); await until(() => openMenu());
      holdCreate = true; await type('先到', { }); await until(() => Boolean(releaseCreate));
      await publish(300, { type:'boost_added', id:30004, boost:{ id:nextBoostId, cooked:'<p>先到</p>', user:{ id:1, username:'local_test', avatar_template:avatar } } });
      releaseCreate(); releaseCreate = null; holdCreate = false;
      await until(() => state.toast.textContent === 'Boost 已发送');
      await expand(4, '先到');
      assert(bubbles(4).join() === '先到' && deleteControl(4, '先到'), `气泡重复或不可删除：${bubbles(4).join()}`);
    });
    await test('举报菜单在面板内，Esc 关闭；收起气泡操作时一并关闭', async () => {
      await expand(5, '路人');
      flagButton(5, '路人').click(); await until(() => openMenu());
      const menu = openMenu().getBoundingClientRect(), panel = state.scroll.getBoundingClientRect();
      assert(menu.left >= panel.left - 1 && menu.right <= panel.right + 1, '举报菜单超出面板');
      window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape' })); await settle();
      assert(!openMenu() && state.open, 'Esc 应只关闭举报菜单');
      flagButton(5, '路人').click(); await until(() => openMenu());
      bubble(5, '路人').querySelector('.ld-preview-boost-text').click(); await settle();
      assert(!openMenu() && bubble(5, '路人').querySelector('.ld-preview-boost-actions').hidden, '收起操作时应关闭举报菜单');
    });
    await test('举报他人的 Boost：只列出适用且启用的类型，选择后提交', async () => {
      await expand(5, '路人');
      assert(actionLabels(5, '路人').join() === '举报', `他人的 Boost 只应可举报：${actionLabels(5, '路人').join()}`);
      flagButton(5, '路人').click(); await until(() => openMenu());
      assert(flagOptions().map(option => option.textContent).join() === '偏离话题,垃圾信息,非法,其他内容', `举报类型不正确：${flagOptions().map(option => option.textContent).join()}`);
      assert(flagOptions()[0].title === '与讨论无关', '说明应为纯文本提示');
      assert(flagSubmit().disabled, '未选择类型时不可提交');
      const count = writes.length;
      await chooseFlag('垃圾信息');
      assert(!flagSubmit().disabled && openMenu().querySelector('.ld-preview-boost-flag-message').hidden, '无需说明的类型应可直接提交');
      flagSubmit().click(); await until(() => writes.length === count + 1);
      assert(lastWrite().path === '/discourse-boosts/boosts/802/flags' && JSON.stringify(lastWrite().body) === '{"flag_type_id":8}', `举报请求不正确：${JSON.stringify(lastWrite())}`);
      await until(() => !openMenu());
      assert(state.toast.textContent === '已举报，管理人员会尽快处理', `提示不正确：${state.toast.textContent}`);
      await expand(5, '路人');
      assert(actionLabels(5, '路人').join() === '已举报' && bubble(5, '路人').querySelector('.ld-preview-boost-action').disabled, '举报后应显示已举报');
    });
    await test('审核中的举报显示已举报，不能重复举报', async () => {
      await expand(5, '已举报过');
      assert(actionLabels(5, '已举报过').join() === '已举报' && !openMenu(), '审核中的举报状态不正确');
    });
    await test('需要说明的类型：字数不足不可提交，非法内容需确认；失败时保留输入', async () => {
      await expand(5, '再来'); flagButton(5, '再来').click(); await until(() => openMenu());
      await chooseFlag('其他内容');
      const hint = () => openMenu().querySelector('.ld-preview-boost-flag-hint').textContent;
      assert(!openMenu().querySelector('.ld-preview-boost-flag-message').hidden && flagSubmit().disabled && hint() === '至少输入 3 个字', `说明要求不正确：${hint()}`);
      await typeMessage('ab'); assert(flagSubmit().disabled, '少于 3 个字不应可提交');
      await typeMessage('违规内容'); assert(!flagSubmit().disabled && hint() === '还可输入 496 个字', `说明计数不正确：${hint()}`);
      await chooseFlag('非法');
      const confirm = openMenu().querySelector('.ld-preview-boost-flag-confirm input');
      assert(!confirm.closest('label').hidden && flagSubmit().disabled, '非法内容应先确认');
      confirm.click(); await settle();
      assert(!flagSubmit().disabled, '确认后应可提交');
      failFlag = true; flagSubmit().click(); await until(() => state.toast.textContent === '你已经举报过了');
      assert(openMenu() && !flagSubmit().disabled && openMenu().querySelector('.ld-preview-boost-flag-message').value === '违规内容', '失败后应保留输入');
      flagSubmit().click(); await until(() => !openMenu());
      assert(lastWrite().path === '/discourse-boosts/boosts/804/flags' && lastWrite().body.flag_type_id === 10 && lastWrite().body.message === '违规内容', `举报请求不正确：${JSON.stringify(lastWrite())}`);
    });
    await test('发送期间切换话题，结果记在原楼层且不影响新话题', async () => {
      boostButton(2).click(); await until(() => openMenu());
      holdCreate = true; await type('稍等', { }); await until(() => Boolean(releaseCreate));
      const oldArticle = article(2);
      await openTopic(400);
      releaseCreate(); releaseCreate = null; holdCreate = false; await wait(60); await settle();
      assert(!openMenu() && !state.list.querySelector('.ld-preview-boosts'), '新话题不应出现气泡或输入框');
      assert(oldArticle.querySelector('.ld-preview-boost-text')?.textContent === '稍等', '原楼层未记录结果');
    });
    await test('输入框在楼层底部可见，未超出面板，发送按钮完整', async () => {
      boostButton(1).click(); await until(() => openMenu());
      const menu = openMenu().getBoundingClientRect(), panel = state.panel.getBoundingClientRect();
      assert(menu.left >= panel.left && menu.right <= panel.right + 1 && menu.height > 0, '输入框超出面板');
      assert(submitButton().scrollWidth <= submitButton().clientWidth, '发送按钮文字被截断');
      boostButton(1).click(); await settle();
    });

    const failures = results.filter(result => !result.pass);
    $('#test-status').textContent = `${results.length - failures.length} / ${results.length} 项通过`;
    $('#test-status').dataset.failures = String(failures.length);
    window.boostTestResults = results; running = false; $('#run-tests').disabled = false;
  }
  $('#run-tests').addEventListener('click', runTests);
  await runTests();
})().catch(error => { document.querySelector('#test-status').textContent = `测试启动失败：${error.stack}`; });
