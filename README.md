# Tampermonkey Scripts

用于存放可直接安装和自动更新的 Tampermonkey 用户脚本。

## 网盘直链下载助手

- 安装地址：<https://raw.githubusercontent.com/ppanphper/tampermonkey-scripts/main/netdisk-direct-download-helper.user.js>
- 说明：支持百度、阿里、天翼、迅雷、夸克、移动云盘，并提供 NDM、Aria2、RPC、cURL 等下载方式。

## Bulk Chat Deleter

- 安装地址：<https://raw.githubusercontent.com/ppanphper/tampermonkey-scripts/main/bulk-chat-deleter.user.js>
- 说明：在侧栏加入批量删除工具栏，支持 ChatGPT、Claude、Gemini（含 Notebook）、DeepSeek 和 Grok 的会话。基于 KiraKiraAyu 的 Greasy Fork 脚本 1.3.0 修改，MIT 协议。
- Grok 网页只提供归档，脚本执行的就是归档：会话进入已删除列表，30 天内可在 Grok 设置的资料管控 → 已删除的对话中还原，之后永久删除。
- 已装过 Greasy Fork 原版的电脑需要打开安装地址重新安装一次，之后改由本仓库更新。`@name` 和 `@namespace` 与原版相同，正常会覆盖原版；如果扩展列表里出现两个同名脚本，删掉更新地址指向 greasyfork.org 的那个。

## LinuxDo 收藏夹（账号同步版）

- 安装地址：<https://raw.githubusercontent.com/ppanphper/tampermonkey-scripts/main/linuxdo-favorites-sync.user.js>
- 说明：linux.do 自定义收藏夹，收藏保存为账号书签，收藏夹名写在书签名称开头（`[收藏夹] 备注`），登录同一账号的设备都能看到。基于 eamooooon 的 [LinuxDo 收藏夹](https://scriptcat.org/scripts/code/6125/LinuxDo%20%E6%94%B6%E8%97%8F%E5%A4%B9.user.js) 1.0.9 修改，原脚本未声明许可证。
- `@name` 和 `@namespace` 与原版相同，安装后覆盖原版并保留数据；首次同步时把原版的本地收藏合并进书签，不删除任何已有书签。如果扩展列表里出现两个同名脚本，删掉更新地址指向 scriptcat.org 的那个。
- Discourse 默认每人每天最多新建 20 个书签，超出的收藏在面板中显示「等待同步」，限额恢复后自动补上。取消收藏和删除收藏夹会删除对应书签。
- 与 [Linux.do 双栏阅读预览](https://github.com/ppanphper/linuxdo-double-column) 共用收藏夹，在双栏里收藏时可以直接选择收藏夹。

在 Tampermonkey 中打开安装地址即可安装；脚本元数据已配置 `@updateURL` 和 `@downloadURL`，后续推送新版本后可以自动更新。
