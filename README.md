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
| `title` | string | 这一期的标题 |
| `theme` | string | 封面大标题 |
| `cover.url` | string | 封面图，`http` 或 `https` |
| `cover.credit` | string | 封面署名，可省略 |
| `cover.source` | string | 封面来源链接，可省略 |
| `highlights` | array | 今日要点，每项 `{label, text}` |
| `research` | array | 论文，见下 |
| `industry` | array | 行业分组，见下 |
| `notion_url` | string | 可省略。有则页头显示 Notion 链接 |

`research[]`：`title`、`date`、`summary` 必填；`title_en`、`authors`、`links` 可省略。

`industry[]`：`section`、`items` 必填；`emoji` 可省略。

`items[]` 与论文相同，但没有 `title_en` / `authors`：`title`、`date`、`summary` 必填，`links` 可省略。

`links[]`：`{label, url}`，`url` 为 `http` 或 `https`。

`highlights[].date` 不存在。论文和新闻条目的 `date` 是自由文字标签，例如 `"10/5"` 或 `"至 10/10"`，原样显示。

### `issues/index.json`

```json
{
  "issues": [
    {
      "date": "2026-10-08",
      "weekday": "周四",
      "title": "通信行业日报 · 2026-10-08（周四）",
      "theme": "卫星直连手机加速落地",
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

工作流使用 `actions/configure-pages`、`actions/upload-pages-artifact`、`actions/deploy-pages`，在推送到 `main` 时发布仓库根目录。

仓库需要一次性打开 Pages：**Settings → Pages → Build and deployment → Source: GitHub Actions**。未改成 GitHub Actions 之前，工作流无法完成部署。
