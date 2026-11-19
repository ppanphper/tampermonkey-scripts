# 搜索结果页双栏预览

## 目标与入口

在 `/search?q=…` 点击话题搜索结果标题时复用现有 JSON 预览面板，保留搜索条件与列表位置。脚本已有 `https://linux.do/*` 匹配，无需更改安装范围。

- 使用同一个链接识别函数处理点击及悬停预取，支持列表标题、列表内话题链接以及 `.search-container .fps-result a.search-link`。
- 继续使用全局事件代理，支持 Discourse 单页导航和动态追加结果。
- 只接管同源合法话题 URL；保留用户、分类、标签导航以及 Ctrl/Command/Shift/Alt/中键行为。
- 搜索容器、标题和输入框在面板打开时允许收缩和换行；关闭后恢复站点样式。

## 楼层与历史

- 明确指定的楼层优先于续读位置，包括 `/1`。先查本地帖子缓存，必要时通过既有按楼层接口取得帖子，原始视图按帖子 ID 查找 stream 下标，树状视图复用分支定位。
- 同话题初次加载或补载楼层期间点击其他结果，加载完成后以最后一次点击的 URL 定位。
- 首次打开压入一条预览历史，切换结果替换该记录；预览 hash 保留原 URL 的查询参数。
- 前进恢复面板时从 `ldPreviewBase` 恢复原搜索 URL，并保留关闭时后退的能力。
- 前插分页回复时以插入前的滚动位置计算补偿，避免与浏览器滚动锚定叠加。

## 验证依据

- 搜索结构来源：[Discourse 搜索结果组件](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/components/search-result-entry.gjs)、[搜索页模板](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/templates/full-page-search.gjs)、[搜索页样式](https://github.com/discourse/discourse/blob/main/app/assets/stylesheets/common/base/search.scss)。
- `tests/linuxdo-double-column/search-preview.html` 运行正式事件、历史和渲染逻辑；API 全部本地模拟，不修改线上数据。
- `tests/linuxdo-double-column/tree-preview.html` 保留原有深层回复回归。
- 当前内置浏览器访问 Linux.do 搜索页跳转登录页，线上登录态及站点定制主题尚需实际安装验证。

# 通知双栏预览

## 目标与入口

点击头像菜单或通知页 `/u/<用户名>/notifications` 中指向话题的通知、私信和书签时，在右侧预览面板打开并定位到对应楼层，保留当前页面。

- 两处都由 Discourse `MenuItem` 渲染为 `li.notification > a`；头像菜单的私信、书签标签页分别为 `li.message > a`、`li.bookmark > a`，书签链接为完整 URL。选择器并入现有链接识别函数，点击和悬停预取共用。
- 只接管同源话题 URL。徽章、关注、群组收件箱等非话题通知，聊天消息书签及审核项保持原生跳转。
- 编辑通知 `li.edited` 保持原生跳转：站点会在打开话题后弹出修订记录，预览面板不提供修订对比。
- 通知页的回复、提及等子页属于用户动态流，不在本次范围。

## 已读与菜单

- 站点在通知项冒泡阶段标记已读：更新本地状态，写入 `cn` cookie，下一次请求由服务端清除。随后 `wantsNewWindow` 发现默认行为已取消，跳过路由和关闭菜单。
- 因此通知链接只调用 `preventDefault`，不阻止事件传播；其他入口仍使用 `stopImmediatePropagation`。
- 头像菜单内的点击在事件结束后检测 `.user-menu.revamped`，菜单仍在时点击 `#toggle-current-user` 关闭。菜单关闭时线上不渲染 `aria-expanded`，不能作为判断依据。

## 验证依据

- 结构与行为来源：[MenuItem](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/components/user-menu/menu-item.gjs)、[通知项点击](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/lib/user-menu/notification-item.js)、[基础点击](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/lib/user-menu/base-item.js)、[wantsNewWindow](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/lib/intercept-click.js)、[服务端清除](https://github.com/discourse/discourse/blob/main/app/controllers/application_controller.rb)、[通知页模板](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/templates/user/notifications-index.gjs)。
- 2026-11-13 只读核对 linux.do（Discourse 2026.11.0-latest）通知页：60 条通知均为 `li.notification > a` 且指向话题 URL；左栏 680px 时无可见溢出，424px 时个人资料头部按钮会被面板遮挡，属用户页原有布局。
- 头像菜单打开会把通知计为已查看，未在线上打开；菜单 DOM 依据源码及 `tests/linuxdo-double-column/notification-preview.html` 验证。

# 复制话题链接

- 标题栏收藏按钮右侧的 🔗 复制 `https://linux.do/t/<slug>/<id>`，不带楼层。
- 话题与楼层链接都按 Discourse [resolveShareUrl](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/helpers/share-url.js) 附加 `?u=<小写用户名>`：仅在已登录且 `enable_badges`、`allow_username_in_share_links` 均开启时附加。
- 用户名与站点设置在点击时从 `#data-preloaded` 的 `currentUser`、`siteSettings` 读取，不硬编码；Discourse 启动后该元素仍保留，登录状态变化会整页刷新。该数据只有 `username`，需自行转为小写。2026-11-13 核对 linux.do：两个设置均开启，数据约 625KB，解析耗时数毫秒，因此不缓存。
- slug 取自话题 JSON。加载中或加载失败时 `topicMeta` 仍属于上一个话题，此时只用当前话题 ID 和 `topic` 占位，打开后由 Discourse 重定向到规范地址。
- 复制成功和失败沿用现有 toast；剪贴板 API 不可用时退回 `execCommand('copy')`。
- `tests/linuxdo-double-column/search-preview.html` 验证话题与楼层链接的分享参数、设置关闭和未登录时不附加，以及加载中切换话题时复制新话题。

# 书签收藏夹

## 交互

- 点击 ☆ 立即按默认收藏创建书签（不带名称），随后在按钮旁打开收藏夹菜单；不选择即保留在默认收藏，一次点击仍能完成收藏。
- 点击 ★ 打开同一菜单：列出收藏夹并标出当前项，可新建收藏夹或取消收藏。取消收藏需两次点击，避免误删。
- 菜单复用楼层「⋯」菜单的样式与开合逻辑（`state.postMenu`），点击外部或按 Esc 关闭；切换话题时随 `hidePostMenu` 关闭。
- 创建请求期间按钮已离开页面（切换话题）时不弹出菜单；书签仍记在发起请求的话题上。

## 与收藏夹脚本的约定

- 书签名称：`[收藏夹] 备注`，默认收藏不加前缀；名称不符合规则时整体视为备注。收藏夹名最多 30 字，不含 `[ ] < > " &`，书签名称最多 100 字。解析与拼接规则需与「LinuxDo 收藏夹（账号同步版）」保持一致。
- 收藏夹列表：页面 localStorage `linuxdo-bookmark-folders`（JSON 数组）。收藏夹脚本保存列表时写入；本脚本新建收藏夹时追加。菜单显示默认收藏、共享列表和当前话题书签中出现的收藏夹。
- 变动通知：创建、改名、删除书签后在 `document` 上派发 `linuxdo-bookmarks-changed`，收藏夹脚本收到后立即重新拉取书签。

## 接口细节

- 改收藏夹用 `PUT /bookmarks/{id}.json`，带回 `reminder_at` 和 `auto_delete_preference`，否则提醒会被清掉。话题 JSON 不提供 `pinned`，改名后置顶状态会被 Discourse 清除（2026-11-18 在 linux.do 实测）。
- 楼层书签优先取话题 JSON 的 `bookmarks`；缺少时用帖子的 `bookmark_id`、`bookmark_name`、`bookmark_reminder_at` 补进列表。
- `tests/linuxdo-double-column/bookmark-folders.html` 用本地模拟接口验证上述流程。
