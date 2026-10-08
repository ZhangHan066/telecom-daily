# 通信行业日报

静态站点，用浏览器直接读取 `issues/` 里的 JSON。部署地址：[https://zhanghan066.github.io/telecom-daily/](https://zhanghan066.github.io/telecom-daily/)。

没有构建步骤。新增一天只加一份 JSON，并更新目录。

## 本地预览

在仓库根目录：

```bash
python3 -m http.server 8000
```

打开 [http://localhost:8000/](http://localhost:8000/)。不要用 `file://` 直接打开 `index.html`，否则浏览器会拦截 JSON 请求。

- `/` 显示 `issues/index.json` 里最新的一期（按日期，新的在前）
- `/?d=2026-10-08` 打开指定一期，可分享
- `/#2026-10-08` 与 `/#d=2026-10-08` 同样打开该期

## 每日更新

一次 PR 只加一期，不必改 `index.html`、`styles.css`、`app.js`。

1. 准备符合下方结构的一期 JSON（文件名建议 `YYYY-MM-DD.json`，放在哪里都可以）。
2. 在仓库根目录执行：

   ```bash
   python3 scripts/add_issue.py path/to/YYYY-MM-DD.json
   ```

3. 脚本会：
   - 校验字段；条目上的 `date`（如 `10/5`、`至 10/10`）只当作展示文字，不会被解析
   - 写入 `issues/YYYY-MM-DD.json`（同一天再次执行则覆盖）
   - 更新 `issues/index.json`：该日期一条，整体按日期从新到旧
4. 提交这两个文件，PR 合并到 `main`。
5. GitHub Actions（`.github/workflows/pages.yml`）在推送到 `main` 后部署到 GitHub Pages。

校验失败时脚本以非零状态退出，并在 stderr 列出全部问题。

## 数据结构

### `issues/YYYY-MM-DD.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | string | `YYYY-MM-DD`，须是真实日历日期，并作为文件名 |
| `weekday` | string | 星期，如 `周四` |
| `weekday_en` | string | 可省略。英文星期，如 `Thu`。英文界面没有该字段时仍显示中文 |
| `title` | string | 这一期的标题 |
| `theme` | string | 主题，用于往期列表 |
| `theme_en` | string | 可省略。英文主题。英文界面没有该字段时仍显示中文 |
| `cover.url` | string | 封面图，`http` 或 `https` |
| `cover.credit` | string | 封面署名，可省略。页面不展示 |
| `cover.source` | string | 封面来源链接，可省略 |
| `highlights` | array | 今日要点，每项 `{label, text}` |
| `research` | array | 论文，见下 |
| `industry` | array | 行业分组，见下 |
| `notion_url` | string | 可省略。有则页头显示 Notion 链接 |

`research[]`：`title`、`date`、`summary` 必填；`title_en`、`authors`、`summary_en`、`detail_en`、`links`、`detail` 可省略。`title_en` 是英文论文标题。英文界面用它做条目标题；中文界面的对话框里，它仍以斜体出现在中文标题下面。页面不使用 `title_en_display`。

`industry[]`：`section`、`items` 必填；`section_en`、`emoji` 可省略。

`items[]`：`title`、`date`、`summary` 必填；`title_en`、`summary_en`、`detail_en`、`links`、`detail` 可省略。行业条目没有 `authors`。

英文界面按字段回退：某个英文字段为空或不存在时，这一项仍显示对应的中文，其它字段不受影响。页头的「中 / EN」会记住在本地（`localStorage` 键 `telecom-daily-lang`），默认中文。

`detail` 是可选字符串，给对话框用。条目上显示标题、最多两行 `summary`、日期和分类。点开后若有 `detail` 就显示它，否则显示 `summary`。多段之间用空行分开，也就是 JSON 里的 `\n\n`，页面会渲染成多个段落。英文界面优先用 `detail_en` / `summary_en`。

`highlights` 仍写在 JSON 里，页面不再展示「今日要点」。

`links[]`：`{label, url}`，`url` 为 `http` 或 `https`。

`highlights[].date` 不存在。论文和新闻条目的 `date` 是自由文字标签，例如 `"10/5"` 或 `"至 10/10"`，原样显示。

卡片地址形如 `#item-r-0`（第 1 篇论文）或 `#item-i-0-1`（第 1 个行业分组里的第 2 条）。浏览器的返回会关掉对话框。

### `issues/index.json`

```json
{
  "issues": [
    {
      "date": "2026-10-08",
      "weekday": "周四",
      "title": "通信行业日报 · 2026-10-08（周四）",
      "theme": "卫星直连手机加速落地",
      "theme_en": "Direct-to-device satellite service gathers pace",
      "cover": "https://example.com/cover.jpg",
      "highlights": [
        { "label": "科研", "text": "……" }
      ]
    }
  ]
}
```

`issues` 从新到旧排列。首页在没有 `?d=` 时读取日期最新的一条，再去拉 `issues/<date>.json`。目录里的 `cover` 是 URL 字符串，不是对象。

## 部署

线上地址：[https://zhanghan066.github.io/telecom-daily/](https://zhanghan066.github.io/telecom-daily/)。

推送到 `main` 时，`.github/workflows/pages.yml` 会部署。同一工作流也可以在 Actions 页面手动运行（`workflow_dispatch`）。Pages 的 Source 需为 GitHub Actions。

部署时工作流把 `index.html` 里的 `__ASSET_VERSION__` 换成该次提交 SHA 的前 7 位，并写入同版本的 `version.json`。`styles.css` 和 `app.js` 因此每次发布都是新地址。Pages 会把 `index.html` 缓存最多 10 分钟，所以页面还会用 `cache: "no-store"` 读取 `version.json`；版本不一致时，带一个新的查询参数刷新一次。期刊 JSON 由页面以 `cache: "no-cache"` 请求。
