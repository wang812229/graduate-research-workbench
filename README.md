# 研析 · 研究生工作平台

面向不同实验类型的开源研究工作台。公开文献索引可由所有人阅读；个人研究数据可选择 **Firebase Spark 免费云账号**（跨设备登录与同步）或 **只保存在当前浏览器的本机资料**。代码采用 MIT 许可证。

> **源码已发布到 GitHub，静态网页位于 [GitHub Pages](https://wang812229.github.io/graduate-research-workbench/)。** 不需要自购云服务器或域名。云账号虽已配置 Firebase，仍须完成实际注册、邮箱验证、跨设备同步及账号隔离测试，才能宣称已通过验收。页面没有付费入口，也不要求用户绑定支付方式。

## 免费云账号：Firebase Spark + GitHub Pages

[Firebase Spark](https://firebase.google.com/pricing) 是无需付款方式的免费方案。此平台只使用 Firebase Authentication 的邮箱密码登录、验证与重置邮件，以及 Realtime Database；不使用电话短信、Cloud Functions、Cloud Storage 或付费 Blaze 方案。**免费不等于无限量或永久服务承诺**：当前官方定额包括 Realtime Database 的 1 GB 存储、10 GB/月下载及 100 个同时连接，认证邮件和每日活跃人数也有限额；额度、政策或服务状态可能变化。达到限额时注册或云同步可能停止，不会在 Spark 方案自动扣费。每位用户应定期导出完整 JSON 备份。

配置由站点维护者在自己的 Firebase 和 GitHub 账号中完成，不需要用户给开发者密码。步骤如下：

1. 在 [Firebase 控制台](https://console.firebase.google.com/)新建项目，确认显示 **Spark / No cost**，不要升级 Blaze 或添加付款方式。Google Analytics 对本工作台不是必需的，可关闭。
2. 在正确的 Firebase 项目中打开 **Authentication → Sign-in method → Email/Password**，启用其中的**电子邮件/密码**开关并点击**保存**；不必启用 Email link 或电话验证。请回到提供方列表，确认状态显示“已启用”。若网页注册提示 `auth/operation-not-allowed`，按 Firebase 官方说明，该项目的密码登录仍未开放；核对项目 ID 与 `cloud-config.json` 一致后重新检查此开关。注册后应用会发送验证邮件，用户点击邮件中的链接后才能登录。
3. 在 **Build → Realtime Database** 创建一个数据库，选择合适地区。打开 **Rules**，用仓库中的 [database.rules.json](database.rules.json) 全部替换默认规则并点击 **Publish**。规则只允许已经验证邮箱的账号访问 `/vaults/自己的 UID`；不要改成 `.read: true` 或 `.write: true`。
4. 在项目设置中添加 **Web app**，取得 Firebase 的网页配置。将 [cloud-config.json](cloud-config.json) 的 `enabled` 改为 `true`，填写 `apiKey`、`authDomain`、`projectId`、`appId`，并从 Realtime Database 页面复制准确的 `databaseURL`。这些属于公开网页配置，**不是管理员私钥**；切勿把 Firebase 服务账号私钥、用户密码或其他服务的密钥放在此文件。数据隔离依靠第 3 步的规则。
5. 在 Firebase **Authentication → Settings → Authorized domains** 确认 GitHub Pages 的站点域名已允许，例如 `wang812229.github.io`。只填域名，不填 `/仓库名/` 路径。验证和重置邮件使用 Firebase 的邮件模板；若未收到，请检查垃圾邮件和免费额度。
6. 为工作台建立**独立的 GitHub 仓库**，不要覆盖已有“每日文献简报”仓库。将本项目源码上传到该仓库 `main`；在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。仓库内的 [.github/workflows/pages.yml](.github/workflows/pages.yml) 会在每次推送后测试、构建并发布 `dist-static`。私人的 JSON/CSV、`.env`、数据库文件和 `node_modules` 不应上传。
7. 首次发布后先用两个不同邮箱注册并验证。分别建立少量测试实验，退出再登录、换设备登录，确认数据能同步；同时确认两账号不能查看彼此的资料。断网测试已登录设备的本机缓存，并检查“数据与设置”的备份导出。**只有这些检查通过后才对外宣布云账号可用。**

云账号的记录存在 Firebase，并在本机保存加密缓存。离线编辑只在已有缓存和原密码可用时有效；重新联网登录后会尝试合并。邮箱重置能恢复已经同步的云端内容，**不能解开旧密码加密且尚未同步的本机缓存**。云端内容由 Firebase 服务托管，并非端到端加密；未公开或受限制的实验信息请先取得课题组许可。

## 推荐：免费静态网站 + 本机资料

运行 `pnpm build:static` 会在 `dist-static/` 生成只含 HTML、CSS、JavaScript 和公开书目的站点。把**该目录里的文件**发布到一个新的 GitHub Pages 仓库即可；不要把服务端文件、数据库、`.env` 或个人导出文件上传。也可直接使用随项目提供的静态站点 ZIP，无需先在自己的电脑上安装 Node。

- 公开页面无需登录，展示并检索打包时的公开书目索引，并链接到现有“每日文献简报”网站。GitHub Actions 每天北京时间 12:30 从简报仓库的公开日报 JSON 同步、去重、构建并发布；计划任务可能延迟，简报未先推送到 GitHub 时会保留上次目录。它不是实时数据库，也不会同步私人实验和笔记。
- “创建资料”只在**当前浏览器、当前网站地址**创建一份本机加密资料；同一用户名在另一设备上不是同一个账号。实验、私人阅读笔记、收藏和课题不会自动上传或同步。
- 静态版没有全站管理员，也不能查看、停用或找回其他设备上的资料。公开内容的维护者通过 GitHub 仓库发布更新；每位使用者只管理自己的本机资料。
- 没有服务器就不能提供邮箱找回。忘记本机资料密码时，只能新建资料并导入之前导出的完整 JSON。浏览器数据被清理、无痕窗口关闭、设备损坏或网站地址更换也可能导致本机资料不可用。请定期导出备份；导出 JSON 是明文，应妥善保存。
- “数据与设置”可申请浏览器的持久存储权限，并显示上次发起完整备份导出的日期；已有记录且超过一周未发起备份时会提醒。浏览器可以拒绝持久存储，获准后用户主动清理网站数据仍可能删除资料。应用无法替你确认下载文件是否真的保存成功。
- 首次打开静态网站需要网络，之后已加载的页面和文献索引可由浏览器缓存供离线查看和编辑。真正的离线体验取决于浏览器缓存没有被清除，且必须从可信 HTTPS 网站访问；直接双击 `index.html` 不作为正式使用方式。

**首次发布（单独的新仓库）**：在 GitHub 创建一个公开仓库，将 `dist-static/` 中的文件放到仓库 `main` 分支根目录；在 **Settings → Pages → Build and deployment → Source** 选择 **Deploy from a branch**，分支选 `main`、目录选 `/(root)`。不要把这个包直接覆盖已有“每日文献简报”仓库的根目录，否则会替换现有网站。GitHub Pages 只发布静态文件，不能提供真正的全站注册或服务器端账号管理。若未来需要集成到现有网站的一个子路径，应先调整现有网站的发布流程。

浏览器对本机资料的隔离与网站地址有关；同一地址下的其他脚本、网站发布者和浏览器环境属于信任边界。密码加密能降低静态存储泄露风险，但未经独立安全审计，不应把它当作对网站运营者或受感染设备的绝对保护。敏感或未公开实验数据使用前，应由所在课题组确认允许存放在浏览器中。

## 已实现

- **实验记录**：实验编号、研究对象、方法、条件、批次、测量、结果、质量指标与下一次实验建议。方法可自由填写，Flux/CVT 只是可用的例子。
- **温度程序**：用表格逐阶段填写时间和温区 A/B，曲线实时更新；提供 CVT、Flux 和低温测量模板，也可从 Excel 四列表格直接粘贴。未录入的程序不会被自动猜测。
- **本地测量数据**：在单条实验中导入 CSV、TSV、TXT、DAT 或 XY，自动识别电阻/输运、磁化、比热、霍尔、I–V、XRD 和光谱列，并识别 PPMS、MPMS、Keithley、XRD 常见导出格式。单文件上限 25 MB、250,000 行，每条实验最多 12 个数据集；原始导入数据不会进入公开文献索引。
- **自动物性分析**：提供 RRR、Tc/ΔTc/dR/dT、Curie–Weiss、C/T–T²、Debye–Einstein、单带与双载流子霍尔、ρ₀+AT²、对数电阻、Bloch–Grüneisen、磁滞回线、超导屏蔽体积分数、ZFC/FC 分叉及 ΔC/γTc。可在图上拖动拟合窗口，预览纳入/排除点、拟合线、残差、R²、标准误差和 95% 置信区间。每次分析都保存列选择、窗口、输入参数、公式、步骤、适用条件、质量标记和独立版本。
- **大窗口与 Origin 导出**：原始曲线和保存后的分析均可在独立大窗口中查看。每个分析版本可导出 Origin 可直接导入的 CSV，包含原始 X/Y、原始误差、拟合空间 X/Y、传播后的误差、拟合值、残差、是否纳入、质量标记和原始行号；同时可导出 TXT 方法说明。
- **批次比较**：从不同实验记录选择 2–5 组数据叠图，并按样品质量、长宽厚几何因子或摩尔数归一化。缺少必要样品参数时不会猜测，而是提示补充。
- **大文件与同步**：本机资料保存完整数据。云账号遇到超过 5,000 行或约 4 MB 的数据集时，完整原始行保留在当前设备的加密缓存，云端同步等距抽样的 5,000 点、样品参数和完整分析版本；换设备后会明确标记为云端抽样副本。
- **文献与课题**：保存 DOI、作者、期刊、个人阅读结论和用途分组；把实验、文献及待办关联到课题。
- **数据迁移**：导入旧网站实验 JSON/CSV、论文分组 JSON 或完整迁移包；导出平台完整 JSON、实验 CSV 和单次实验 JSON。
- **静态版个人资料**：每份资料在当前浏览器使用各自密码加密，不需全站管理员或付费后端；不同设备之间不自动同步。
- **可选服务器版**：若将来需要跨设备账号与同步，项目仍保留 PostgreSQL 多人部署。公网模式可用邮箱验证与邮件找回；局域网模式由管理员线下签发重置链接。这些服务器功能**不包含在静态站点包中**。

## 本地试用

需要 Node.js 24+，安装依赖后启动：

```bash
cd graduate-research-workbench
pnpm install --frozen-lockfile
pnpm start
```

打开 `http://127.0.0.1:4173`。首次启动会在终端打印一次性管理员初始化口令，注册管理员时填写该口令。默认开发模式若未配置 SMTP，邮件会写入 `data/dev-mailbox/`，仅供本机验证，**不能用于公网**。

如果只在这一台电脑上使用且不想配置邮件，可先在 PowerShell 中运行 `$env:DEPLOY_MODE="lan"`，再运行 `pnpm start`。此时使用用户名注册和登录，数据保存在本机 `data/workbench.sqlite`。不要把这一单机试用服务直接开放给其他设备；多人使用请按下一节配置局域网 HTTPS。

## 无域名、无云服务器：局域网多人使用

一台常开电脑或 NAS 作主机，其他成员在**同一局域网**通过主机的固定内网 IP 使用平台。实验、文献、课题等仍按账号隔离，数据留在主机的 PostgreSQL 卷中。无需公网域名、云服务器或 SMTP；不要在路由器上为平台做公网端口转发。主机关机或局域网断开时，已登录且已有本地缓存的设备可继续离线编辑；新设备注册、重置密码和跨设备同步要等主机恢复。

1. 在主机安装 Docker Engine/Compose（Windows 可用 Docker Desktop），首次下载 Docker 镜像和构建应用需要网络。以后这些镜像和依赖已在主机上时，局域网服务本身可以在断开互联网后运行。若要从零在完全隔离的网络安装，须预先从可信环境带入镜像和源码。
2. 给主机保留固定的内网 IP（例如在路由器中做 DHCP 地址保留）。在本项目目录复制 `.env.lan.example` 为 `.env.lan`，填入该 IP 和自行生成的长随机数据库密码。不要把 `.env.lan` 提交到 GitHub。
3. 在主机运行 `docker compose --env-file .env.lan -f compose.lan.yml up -d --build`。只允许可信局域网设备访问主机 TCP 443；数据库和应用端口没有对外发布。
4. 运行 `docker compose --env-file .env.lan -f compose.lan.yml logs app`，找到首次管理员初始化口令，在主机浏览器打开 `https://你的内网IP` 创建管理员。成员随后可用各自的用户名和密码注册。
5. 由于没有公网域名，Caddy 使用内部证书。运行 `docker compose --env-file .env.lan -f compose.lan.yml cp caddy:/data/caddy/pki/authorities/local/root.crt ./yanxi-local-root.crt`，由管理员通过可信渠道分发**根证书文件**并在每台设备上设为信任。可先用 `Get-FileHash ./yanxi-local-root.crt -Algorithm SHA256` 核对指纹。不要分发 Caddy 的私钥；不要在浏览器中忽略证书警告后继续使用。[Caddy 的局域网证书说明](https://caddyserver.com/docs/running)列出各系统的导入方式。

在局域网模式，邮箱找回不可用：普通成员忘记密码时，管理员在“账号管理”中为该成员生成 15 分钟有效、只能用一次的重置链接，并当面或通过可信渠道交给本人。管理员自己忘记密码时，只有能操作主机的人可运行 `docker compose --env-file .env.lan -f compose.lan.yml exec app node scripts/issue-admin-reset.mjs`，在主机终端取得链接。密码重置会使旧登录会话失效；原密码加密且尚未同步的本地缓存不能用新密码解开。

建议管理员每天备份 PostgreSQL，并至少演练一次恢复。导出的个人 JSON 是明文，也要妥善保存。主机 IP 变化后须修改 `.env.lan` 并重新部署，旧地址及其证书不再适用。浏览器离线功能依赖可信 HTTPS；`http://内网IP` 不可代替它。

## 云服务器与域名部署

需要你控制的云服务器、一个已解析到该服务器公网 IP 的域名，以及可发信的 SMTP 账户。仓库内的 [compose.yml](compose.yml) 同时启动 PostgreSQL、应用和 Caddy；Caddy 将 HTTP 请求引导到 HTTPS 并代理应用。

1. 把本项目上传到云服务器，安装 Docker Engine 与 Compose。开放服务器防火墙的 TCP 80、TCP 443，以及使用 HTTP/3 时的 UDP 443；数据库和应用端口不对公网开放。
2. 复制 `.env.example` 为 `.env`，填写真实 `APP_DOMAIN`、高强度 `POSTGRES_PASSWORD`、SMTP 主机、端口、账号、应用密码和发件地址。**不要把 `.env` 上传到 GitHub，也不要把密码发给我。** 发件域名的 SPF/DKIM/DMARC 按邮件服务商要求配置。
3. 执行 `docker compose up -d --build`，再用 `docker compose logs app` 查看首次管理员初始化口令。先完成管理员注册，然后邀请其他人注册并验证邮箱。
4. 用两个普通测试账号检查彼此看不到实验和文献；测试验证邮件、找回密码、离线后同步，再向更多人开放。

`.env` 示例：

```text
APP_DOMAIN=research.example.org
POSTGRES_PASSWORD=请自行生成的长随机密码
SMTP_HOST=你的SMTP主机
SMTP_PORT=465
SMTP_USER=你的SMTP账号
SMTP_PASSWORD=你的SMTP应用密码
SMTP_FROM="Research Workbench <sender@example.org>"
```

服务器会根据 `APP_DOMAIN` 创建 `https://域名/#verify=...` 与 `/#reset=...` 链接。邮箱验证链接有效 30 分钟，重置密码链接有效 15 分钟，使用后立即失效。服务器只保存令牌哈希，不保存明文令牌。生产模式缺少 HTTPS 域名、PostgreSQL 或 SMTP 配置时会拒绝启动。

若注册人数或并发请求明显增长，可调大 `PG_POOL_SIZE`，并增加外层反向代理/边缘限流与监控。当前 Compose 默认**单应用实例**；它能容纳多个独立用户，但不能据此声称已验证某个具体并发规模。大规模公开注册前应进行负载测试和垃圾账号防护。

## 备份与恢复

数据库保存在 Docker 的 `postgres_data` 卷中，不能删除。应按天做 PostgreSQL 一致性备份，并定期演练恢复。Linux 服务器上可用 `pg_dump` 生成备份，例如：

```bash
docker compose exec -T db pg_dump -U yanxi -d yanxi -Fc > yanxi-backup.dump
```

请把备份文件放在有访问控制的异地位置。每位用户也可在“数据与设置”单独导出自己的完整 JSON；导出文件是**明文**，不要提交到公开仓库。旧版本地 SQLite 数据不会自动迁入 PostgreSQL；已有用户应先各自导出 JSON，在云端新账号中导入。

## 从每日文献简报迁移

原网站“我的研究”页面提供 **迁移到研究生工作平台** 按钮，会导出 `research-workbench-transfer.json`。平台“数据与设置”可直接导入此文件，也接受原有的 `experiment-records.json`、`experiment-records.csv` 和 `paper-projects.json`。旧分组文件只有论文 ID；平台附带原网站公开书目索引用于匹配，匹配不到的条目会标记“待补全文献信息”。

公开文献与私人导入是两条独立数据流。维护者可运行 `node scripts/sync-literature.mjs` 从简报 GitHub 仓库读取 `content/reports/*.json`，或用 `--local-source=本地简报目录/content/reports` 在未联网时同步；程序按 DOI、arXiv ID 和标题去重，保留原有书目 ID，以免个人收藏的匹配断开。工作台的 GitHub Actions 在推送、手动触发和每天北京时间 12:30 执行同一同步，并将有变化的 `catalog.json` 提交到工作台仓库。公开详情展示结论与原简报链接；完整证据链仍以“每日文献简报”为准。

## 隐私与离线边界

- 普通用户的 API 请求只能读写自己的研究库。管理员界面能管理账号和查看注册邮箱，不能通过该界面浏览他人的实验；**拥有云服务器或数据库访问权限的人仍可读取数据库文件**。这是自部署服务器的权限边界，不是端到端加密。
- 初次访问、注册、邮箱验证、找回密码都需要联网。已有离线缓存的设备可以断网编辑。
- 邮箱重置密码会清除服务器端现有登录会话。**原密码加密且尚未同步的本地修改无法凭新密码恢复**；如仍知道旧密码，应先离线解锁并导出备份。
- 多设备修改同一账号时按记录 ID 和修改时间合并。重要记录仍建议定期导出备份。
- 公开注册会吸引自动化滥用；目前有基础请求限流，面向大量用户时还应增加边缘限流、监控和反滥用机制。

## 开发与开源

```bash
pnpm test
pnpm build
```

本地测试使用 SQLite，生产 Compose 使用 PostgreSQL；邮件开发模式写入本地文件，生产模式使用 SMTP。GitHub Actions 仅运行检查，不会误把需要数据库的服务发布到 GitHub Pages。上传源码时确认 `data/`、`.env`、私人 JSON/CSV 和数据库备份均未进入仓库。
