# Daydayup CloudBase experience scaffold

This is an offline-testable family learning scaffold with a connected CloudBase experience environment. It is not a production-ready application.

## Current scope

- Native WeChat Mini Program with a library-first navigation: `pages/home` (知识库 / 挑战赛 / 拍照上传 three entries, learner switcher, silent sign-in), `pages/library` (per-subject cards with mastery progress), `pages/subject` (错题集 / 挑战赛 tabs for one subject), `pages/contest` (数学赛 / 语文赛 / 英语赛 / 大综合赛 with personal best and a 设置 entry), `pages/settings` (跳题开关 / 难度 / 题量), `pages/challenge` (auto-graded contest runner), `pages/import` (整页拍照 → 切题 → 裁题号带 → 逐题判标记 → 预览确认 → 批量归档, plus manual entry), and `pages/question` (detail, edit, mastered toggle, delete).
- `miniprogram/data/question-bank.js` ships a built-in 3–4 grade bank of 90 questions (30 each for Chinese, Maths, English) with `choice` / `fill` / `judge` types, accepted-answer aliases, and optional explanations. `miniprogram/services/contest.js` handles contest definitions, random sampling, answer normalisation/grading, and best-score history in `daydayup.contest-results.v1`.
- Contest settings live in `pages/settings` and persist to `daydayup.contest-settings.v1`: an `allowSkip` switch (skip without answering and return to previous questions) and a question-count slider (5 / 10 / 15 / 20). The difficulty slider (难 / 中 / 易) is kept in the UI but disabled behind `DIFFICULTY_ENABLED = false` in `services/contest.js`, so contests currently draw from the whole difficulty range; `selectByDifficulty` and `difficultyOf` stay ready for when the switch is turned on. `pages/challenge` shows 上一题 / 跳过 / 下一题, keeps per-question `correct` / `wrong` / `skipped` state, and reports unanswered questions in the result screen.
- Choice and judge questions are answered by tapping an option; fill-in questions use a real `<input>` so text answers (including fractions such as `1/2`) can be typed and are graded through the same normalisation.
- `cloudfunctions/question-ocr` recognizes one user-confirmed single-question crop through the Tencent `QuestionOCR` adapter and returns text plus usage. It requires an authenticated, non-anonymous CloudBase caller.
- Wrong-answer sets (错题集) and learners are stored on-device through `miniprogram/services/questions.js` and `miniprogram/services/profile.js`; the modules are a repository boundary so PostgreSQL storage can replace them without touching pages. 挑战赛 questions come from the built-in bank, so grading is automatic and does not need answers on 错题集 records.
- The temporary `ocr-smoke-test` Cloud Function and its source were removed on 2026-10-25 once `question-ocr` was confirmed to cover the product path; the deleted files remain recoverable from Git history.
- Testable import orchestration with injected mark detector, cropper, OCR, and repository interfaces still exists for the future automatic-mark pipeline.
- CloudBase JS SDK is wired for WeChat identity login. A private test Bucket upload/download/delete roundtrip has been verified with a non-personal image.
- Empty `families` and `learners` PostgreSQL tables have owner-scoped read policies. Authenticated clients have read-only table grants. A `initialize-family` Cloud Function implementation and least-privilege role migration are present, but have not been applied or deployed.

The automatic mark detector, Hunyuan generation, and exports are not implemented yet. Challenge contests are implemented on top of the built-in bank with on-device best scores. Questions currently live on-device only, so multi-device sync waits for the PostgreSQL repository. The mini program AppID and CloudBase environment ID are in local project configuration; no API keys or service secrets belong in the client.

Every cloud function needs its own environment variables: `question-ocr` requires `OCR_TENCENT_SECRET_ID`, `OCR_TENCENT_SECRET_KEY`, and `OCR_TENCENT_REGION` before it can call OCR. `question-split` (page splitting via `QuestionSplitOCR`) needs the same three OCR variables. `paper-marks` (handwritten √ / ☆ / △ detection) selects its provider with `MARK_PROVIDER`:
- `tokenhub` (default when `TOKENHUB_API_KEY` exists): `TOKENHUB_API_KEY`, optional `TOKENHUB_MODEL` for whole-page mode (default `hy-vision-2.0-instruct`), optional `TOKENHUB_MODEL_SINGLE` for one cropped question-number band (default `hunyuan-t1-vision-20250916`), optional `TOKENHUB_BASE_URL` (default `https://tokenhub.tencentmaas.com/v1/chat/completions`) and `TOKENHUB_TIMEOUT_MS`.
- `hunyuan` (legacy platform, retired upstream on 2026-09-30): `HUNYUAN_SECRET_ID`, `HUNYUAN_SECRET_KEY`, optional `HUNYUAN_REGION` / `HUNYUAN_MODEL`.
- `mock` for offline UI work.
Requests may override the model per call (`{"model":"deepseek/deepseek-flash"}`) so the same function can compare HY-Vision, DeepSeek, and Hunyuan T1 on identical prompts. Function environment variables are per function, so each function must be configured separately.

## Family initialization function

`cloudfunctions/initialize-family` creates one family per authenticated WeChat OpenID and its initial learner records in a single PostgreSQL transaction. The caller identity is taken from the CloudBase function context, never from request data. The function uses a dedicated `daydayup_family_api` database role; apply `database/migrations/003_family_api_role.sql` only once. The role is initially `NOLOGIN`; configure a strong password through a secure database-user workflow and enable `LOGIN` only when the credential is ready. Then configure its connection string as the function's `DATABASE_URL` secret/environment variable before deployment. The role can only read and insert owner-scoped family/learner records. Do not put the connection string in project files or the mini program.

The function is source- and unit-tested but is not deployed. Before deployment, verify that the CloudBase PostgreSQL endpoint is reachable from Cloud Functions and that its authenticated `auth.uid()` value matches the function context's `OPENID`; that mapping and an end-to-end call still require live environment validation.

## Tencent QuestionOCR adapter

`cloudfunctions/process-import/tencent-question-ocr.js` calls Tencent Cloud OCR API `QuestionOCR` through the official Node.js SDK. Set `OCR_TENCENT_SECRET_ID`, `OCR_TENCENT_SECRET_KEY`, and `OCR_TENCENT_REGION` as protected Cloud Function settings; never put them in the Mini Program or commit them. CloudBase rejects environment keys starting with `TENCENTCLOUD_`, so the OCR-specific names are required (the adapter still accepts the SDK defaults outside CloudBase). CloudBase currently shows Shanghai 1; `ap-shanghai` is the initial OCR region candidate and must be confirmed by an API response. The adapter accepts only selected-question crops and rejects full-page or mixed-question images. API calls are rate-limited to at most two per second. Tencent OCR has no subject confidence in this adapter, so output stays in review as `needs_subject`; it is not auto-archived.

The temporary `ocr-smoke-test` function (which pinned two confirmed crops by SHA-256, gated billable calls behind `confirmBillableOcr`, and restricted callers by identity) has been deleted from both the environment and the repository. Only `question-ocr` remains for single-question OCR.

### CloudBase integration notes discovered during live validation

- CloudBase rejects function environment keys prefixed with `TENCENTCLOUD_`, `SCF_`, or `QCLOUD_`; use `OCR_TENCENT_*` instead.
- Calls made through the CloudBase JS SDK (`@cloudbase/js-sdk`) reach the function with `TCB_CONTEXT_KEYS` and `TCB_UUID`, not `WX_OPENID`. `wx-server-sdk`'s `getWXContext()` only reads `WX_CONTEXT_KEYS`, so it returns an empty object on that path. Read the documented context keys from `process.env` instead; `initialize-family`, `question-ocr`, `question-split`, and `paper-marks` all do this.
- `cloud.downloadFile({ fileID })` from `wx-server-sdk` fails against the current storage backend (`downloadFile:fail Cannot read properties of undefined (reading '0')`), so the Mini Program fetches the approved crops through a signed URL and sends bytes to the function.
- Storage reads are governed by PostgreSQL RLS on `storage.objects`. The existing policies require `owner_id = auth.uid()` and that the first path segment equals the caller UID, so objects uploaded through the console are invisible to the client. A temporary read policy `daydayup_validation_object_select_temp_ocr` for the `ocr-smoke-test/` prefix was added for this validation; its function is already deleted, and the policy plus the two `ocr-smoke-test/` objects still need to be dropped in the database.
- `tcb fn deploy --dir <dir>` packages only that directory and skips `node_modules`; pass `--install-dependency true` so the cloud build installs `package.json` dependencies. `tcb fn invoke -d @file.json` accepts a JSON payload from disk.

## Local validation

Install Node.js 18 or newer, then run:

```powershell
npm test
npm run demo
```

`npm test` uses Node's built-in test runner and requires no root-level npm dependencies.

## WeChat Developer Tools

Open the project root in WeChat Developer Tools and confirm the configured AppID and CloudBase environment before running. Do not commit or send secrets in chat. The import page currently exposes test-only login and single-image storage verification; it does not create business photo records or invoke OCR/AI.

## Import contract

See `cloudfunctions/shared/import-pipeline.js`. Production confidence thresholds must be calibrated using separate, anonymized real-photo datasets; there is no guessed default. The mock suite verifies control flow only and makes no claim about OCR accuracy.

## 本地开发与部署

### 首次克隆（重要）
`node_modules/` 与 `miniprogram_npm/` 不纳入版本管理。克隆后：

1. 在仓库根目录执行 `npm install`（仅测试需要）。
2. 用微信开发者工具打开项目根目录，菜单 **工具 → 构建 npm**，生成 `miniprogram_npm/`，否则小程序无法启动。

### 常用命令
```bash
npm test                                   # 全部单元测试（Node 内置 test runner）
node --test tests/paper-marks.test.js      # 单个测试文件
```

### 云函数部署（CloudBase CLI）
```bash
tcb fn deploy <function> --dir <stage> -e <envId> --force --deployMode zip --install-dependency true
tcb config update fn <function> --timeout 60 -e <envId>   # 视觉/OCR 函数必须放宽超时
tcb logs search --query 'function_name:"<function>"' -e <envId>
```

### 云函数环境变量（每个函数单独配置）
| 函数 | 变量 |
| --- | --- |
| `question-ocr` | `OCR_TENCENT_SECRET_ID` `OCR_TENCENT_SECRET_KEY` `OCR_TENCENT_REGION` |
| `question-split` | `OCR_TENCENT_SECRET_ID` `OCR_TENCENT_SECRET_KEY` `OCR_TENCENT_REGION`（需 `ocr:QuestionSplitOCR` 权限） |
| `paper-marks` | `TOKENHUB_API_KEY`，可选 `TOKENHUB_MODEL`（整页模式，默认 `hy-vision-2.0-instruct`）、`TOKENHUB_MODEL_SINGLE`（单题模式，默认 `hunyuan-t1-vision-20250916`）、`MARK_PROVIDER` |
| `paper-scan` | 需要 sharp 原生库，当前运行时无法加载，**云端已删除，代码仅留库备查** |

超时：`question-ocr` / `question-split` / `paper-marks` 均为 60 秒；默认 3 秒会导致真实照片调用失败。

### 已知限制
- `sharp` 在本环境云函数中加载即崩溃（`0 code exit unexpected`），因此服务端裁剪方案改为小程序端 canvas 裁剪。
- TokenHub 的 `hunyuan-t1-vision` 单页耗时 4~16 秒，超过小程序 15 秒调用窗口；它只在**单题模式**（一块放大后的题号带，约 5 秒）里使用，整页模式仍用较快的 `hy-vision`。

## 整页拍照识别链路（小程序端）

`pages/import` 的流程：

1. `wx.chooseMedia({ sizeType: ['original'] })` 拍整页；宽度超过 1600px 时先用 `wx.compressImage` 压到 1600，保证 < 6MB 且降低图片 token。
2. 调 `question-split`（腾讯 `QuestionSplitOCR`）拿题目坐标，`process-import/tencent-question-split.js` 把坐标归一化成相对 rect。
3. `services/page-scan.js` 用 `services/marks.js` 的 `computeQuestionBand` 生成「题号带」裁剪参数：题号上方一条 90~170px 的横带，放大 2.5 倍，输出上限 900×400。
4. `services/canvas-crop.js` 用页面内 `<canvas type="2d">` 逐题裁剪并导出 jpg，串行发给 `paper-marks`（`mode: 'single'`，默认模型 `hunyuan-t1-vision-20250916`）。
5. 预览页列出每题「题号 + 标记」，点标记可循环切换 `√ → ☆ → △ → 无`；**只有带标记且被勾选的行会保存**，未标记题不识别也不入库。
6. 保存写入 `services/questions.js`（`origin: 'capture'` → 「整理」菜单，`labels` 取标记类型，`pageRect` 留坐标）。

`page-scan.js` 是纯逻辑（无 `wx` 依赖），由 `tests/page-scan.test.js` 覆盖。切题服务按版面分组，若整页被并成 1 道高矩形（`h ≥ 0.25`），预览页会提示「可能漏掉其他题号」。
