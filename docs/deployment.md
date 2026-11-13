# 静态部署说明

## 本地离线版

运行 `npm run release` 后，直接双击 `release/offline/index.html`。运行时不需要 Node.js、Web 服务器或网络连接；Node.js 只用于重新构建源码。

## 通用静态托管

`release/static-site/` 的 `index.html` 位于发布根目录，资源使用相对路径。把该目录中的全部文件上传到任意静态托管服务即可。首次访问 HTTPS 网站需要网络；网页加载完成后所有傅里叶计算均在浏览器本地执行。

## GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。发布步骤：

1. 把项目提交到 GitHub 仓库的 `main` 分支。
2. 在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**。
3. 推送 `main` 或手动运行 “Deploy static CTFT lab to GitHub Pages”。
4. 工作流执行 `npm ci`、`npm run check`，随后上传 `dist/` 并部署。

工作流遵循 GitHub Pages 官方的 `configure-pages`、`upload-pages-artifact` 和 `deploy-pages` 流程。当前本地环境没有目标仓库与发布权限，因此项目没有虚构的线上 URL。

## PWA 状态

当前未注册 Service Worker。这样可以保证 `file://` 直接打开不受 Service Worker 作用域限制。若未来增加 PWA，必须作为 HTTPS 部署的增强功能，不能取代离线文件版。
