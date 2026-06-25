# Bili Dynamic Groups

> 把 B 站动态按关注分组浏览的浏览器扩展。
> 把"全员混合时间流"换成"我关心的圈子分别浏览"。

## 这个扩展解决什么问题

B 站原版动态页只有一条按时间倒序的混合流——粉一千个 UP 之后，每天打开看到的几乎只剩几位高频 UP 的更新，那些不常发但内容质量高的 UP 完全被淹没。

这个扩展直接读取你在 B 站设置好的关注分组（你的"日常向"、"技术"、"音乐"等），把它们做成可切换的 Tab，每个分组独立显示，并主动补全那些不常出现在主 feed 里的 UP 的内容。

## 核心功能

- **分组 Tab** — 直接读 B 站现有关注分组，点 Tab 立即切换
- **过去 24 小时更新数** — 每个 Tab 右上角小红点显示 24h 内的新动态数量
- **空分组自动收尾** — 组内没有 UP 的分组自动排到末尾
- **直播专属 Tab** — 直接调 B 站正在直播接口，秒看谁在播
- **自渲染卡片流** — 不依赖 B 站原 feed，进分组即从本地缓存秒开
- **进度可视的后台补数** — 后台 Port 增量拉取组内 UP，进度条实时反馈
- **滚动到底自动加载更早** — 无限滚动 + 手动"继续加载"双保险
- **充电内容识别** — 充电专属动态/视频自动打上橙色"充电"徽章
- **后台静默兜底** — 每 10 分钟拉一批 UP 数据，慢慢填满本地数据库
- **隐私本地化** — 所有动态数据存在本地 IndexedDB，不上传任何第三方服务
- **AI 分组建议**（可选） — 自带 API Key 后可让 Claude/自定义模型给新关注的 UP 推荐分组

## 安装方式（开发者模式）

```bash
npm install
npm run build
```

1. Chrome / Edge 地址栏访问 `chrome://extensions`
2. 右上角打开"开发者模式"
3. 点"加载已解压的扩展程序"，选 `.output/chrome-mv3` 目录
4. 装好后访问 `t.bilibili.com`，页面右下角会出现蓝色"分组"浮动按钮
5. 点击浮动按钮 → 在新标签页打开主面板

## 怎么用

- **首次打开** 会自动同步关注、分组、最近动态——可能等一两分钟
- 切换分组 Tab → 显示组内动态卡片
- 顶部进度条显示后台正在补充的进度
- 卡片点击 → 跳到 B 站对应详情页
- "同步"按钮 → 主动刷一次关注/分组/最近动态
- "重置缓存"按钮 → 清空动态缓存重新拉（接口变化导致解析不准时用）

## 技术栈

| 层 | 选择 |
|---|---|
| 扩展框架 | [WXT](https://wxt.dev) 0.20（MV3） |
| 语言 | TypeScript（strict + exactOptionalPropertyTypes） |
| UI | Preact + Tailwind CSS |
| 存储 | Dexie（IndexedDB 封装） |
| 接口校验 | Zod |
| 测试 | Vitest |

## 开发命令

```bash
npm install        # 安装依赖
npm run dev        # 开发模式，文件改动自动重建
npm run build      # 生产构建到 .output/chrome-mv3
npm run typecheck  # TS 类型检查
npm test           # 跑单元测试
```

## 目录结构

```
entrypoints/         # 三个扩展入口
├── background.ts    # Service Worker（调度中心）
├── content.tsx      # 注入 b 站页面的浮动按钮
└── dashboard/       # 独立标签页（主 UI）
src/
├── bilibili/        # B 站 API 客户端 + WBI 签名
├── storage/         # Dexie 数据库定义
├── types/           # 数据模型
├── sync/            # 同步逻辑
├── content/         # UI 组件 (App/GroupFeed/LiveFeed/cards)
├── shared/          # 跨端共用（消息类型、常量）
├── analytics/       # 四象限计算（数据层完成，UI 待做）
└── ai/              # AI 分组建议（默认关闭）
test/                # 单元测试（wbi 签名 + 四象限分类）
```

## 已知限制

- 完全依赖用户在 B 站登录态（Cookie）拉取数据，登出后无法工作
- B 站 polymer API 字段可能调整；若卡片显示 `[动态]`，可点卡片角的"复制原始"按钮把 raw 反馈到 Issues
- 单元测试覆盖率较低，主要依赖 type 检查 + 实际使用反馈
- 四象限分析数据层完成但 UI 未实现

## 许可证

[MIT](./LICENSE)
