/* 本地集成回归：使用正式启动入口，验证楼层 Boost 的发送入口、长度校验、写入请求与失败处理。 */
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

  let writes = [], failNext = null, holdCreate = false, releaseCreate = null, nextBoostId = 900;
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
    fixtures[300].posts[2].boosts = [{ id:801, cooked:'<p>前排</p>', user:{ username:'other', avatar_template:avatar } }];
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
    if (url.pathname === '/topics/timings') return json({});
    return json({ errors:[`未模拟的接口 ${method} ${url.pathname}`] }, 404);
  };

  const script = document.createElement('script');
  script.textContent = source.slice(0, startup)
    + '\n  window.boostTestApi = { state, closePanel };\n'
    + source.slice(startup);
  document.head.appendChild(script);
  const { state, closePanel } = window.boostTestApi;

  const click = selector => $(selector).dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, button:0 }));
  const article = number => state.list?.querySelector(`article[data-post-number="${number}"]`);
  const boostButton = number => article(number)?.querySelector('.ld-preview-post-footer .ld-preview-boost-button');
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
    resetFixtures(); writes = []; failNext = null; holdCreate = false;
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
    await test('发送期间切换话题，结果记在原楼层且不影响新话题', async () => {
      boostButton(4).click(); await until(() => openMenu());
      holdCreate = true; await type('稍等', { }); await until(() => Boolean(releaseCreate));
      const oldArticle = article(4);
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
