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

在 Tampermonkey 中打开安装地址即可安装；脚本元数据已配置 `@updateURL` 和 `@downloadURL`，后续推送新版本后可以自动更新。
