# Daydayup CloudBase experience scaffold

This is an offline-testable family learning scaffold with a connected CloudBase experience environment. It is not a production-ready application.

## Current scope

- Native WeChat Mini Program with a library-first navigation: `pages/home` (知识库 / 挑战赛 / 拍照上传 three entries, learner switcher, silent sign-in), `pages/library` (per-subject cards with mastery progress), `pages/subject` (错题集 / 挑战赛 tabs for one subject), `pages/contest` (数学赛 / 语文赛 / 英语赛 / 大综合赛 with personal best and a 设置 entry), `pages/settings` (跳题开关 / 难度 / 题量), `pages/challenge` (auto-graded contest runner), `pages/import` (capture → OCR → confirm → save), and `pages/question` (detail, edit, mastered toggle, delete).
- `miniprogram/data/question-bank.js` ships a built-in 3–4 grade bank of 90 questions (30 each for Chinese, Maths, English) with `choice` / `fill` / `judge` types, accepted-answer aliases, and optional explanations. `miniprogram/services/contest.js` handles contest definitions, random sampling, answer normalisation/grading, and best-score history in `daydayup.contest-results.v1`.
- Contest settings live in `pages/settings` and persist to `daydayup.contest-settings.v1`: an `allowSkip` switch (skip without answering and return to previous questions) and a question-count slider (5 / 10 / 15 / 20). The difficulty slider (难 / 中 / 易) is kept in the UI but disabled behind `DIFFICULTY_ENABLED = false` in `services/contest.js`, so contests currently draw from the whole difficulty range; `selectByDifficulty` and `difficultyOf` stay ready for when the switch is turned on. `pages/challenge` shows 上一题 / 跳过 / 下一题, keeps per-question `correct` / `wrong` / `skipped` state, and reports unanswered questions in the result screen.
- Choice and judge questions are answered by tapping an option; fill-in questions use a real `<input>` so text answers (including fractions such as `1/2`) can be typed and are graded through the same normalisation.
- `cloudfunctions/question-ocr` recognizes one user-confirmed single-question crop through the Tencent `QuestionOCR` adapter and returns text plus usage. It requires an authenticated, non-anonymous CloudBase caller.
- Wrong-answer sets (错题集) and learners are stored on-device through `miniprogram/services/questions.js` and `miniprogram/services/profile.js`; the modules are a repository boundary so PostgreSQL storage can replace them without touching pages. 挑战赛 questions come from the built-in bank, so grading is automatic and does not need answers on 错题集 records.
- The temporary `cloudfunctions/ocr-smoke-test` remains deployed for controlled verification of the two approved crops and should be deleted once the product path is signed off.
- Testable import orchestration with injected mark detector, cropper, OCR, and repository interfaces still exists for the future automatic-mark pipeline.
- CloudBase JS SDK is wired for WeChat identity login. A private test Bucket upload/download/delete roundtrip has been verified with a non-personal image.
- Empty `families` and `learners` PostgreSQL tables have owner-scoped read policies. Authenticated clients have read-only table grants. A `initialize-family` Cloud Function implementation and least-privilege role migration are present, but have not been applied or deployed.

The automatic mark detector, Hunyuan generation, and exports are not implemented yet. Challenge contests are implemented on top of the built-in bank with on-device best scores. Questions currently live on-device only, so multi-device sync waits for the PostgreSQL repository. The mini program AppID and CloudBase environment ID are in local project configuration; no API keys or service secrets belong in the client.

Every cloud function needs its own environment variables: `question-ocr` requires `OCR_TENCENT_SECRET_ID`, `OCR_TENCENT_SECRET_KEY`, and `OCR_TENCENT_REGION` before it can call OCR. `question-split` (page splitting via `QuestionSplitOCR`) needs the same three OCR variables. `paper-marks` (handwritten √ / ☆ / △ detection) selects its provider with `MARK_PROVIDER`:

- `tokenhub` (default when `TOKENHUB_API_KEY` exists): `TOKENHUB_API_KEY`, optional `TOKENHUB_MODEL` (default `hy-vision-2.0-instruct`), optional `TOKENHUB_BASE_URL` (default `https://tokenhub.tencentmaas.com/v1/chat/completions`) and `TOKENHUB_TIMEOUT_MS`.
- `hunyuan` (legacy platform, retired upstream on 2026-09-30): `HUNYUAN_SECRET_ID`, `HUNYUAN_SECRET_KEY`, optional `HUNYUAN_REGION` / `HUNYUAN_MODEL`.
- `mock` for offline UI work.

Requests may override the model per call (`{"model":"deepseek/deepseek-flash"}`) so the same function can compare HY-Vision, DeepSeek, and Hunyuan T1 on identical prompts. Function environment variables are per function, so each function must be configured separately.

## Family initialization function

`cloudfunctions/initialize-family` creates one family per authenticated WeChat OpenID and its initial learner records in a single PostgreSQL transaction. The caller identity is taken from the CloudBase function context, never from request data. The function uses a dedicated `daydayup_family_api` database role; apply `database/migrations/003_family_api_role.sql` only once. The role is initially `NOLOGIN`; configure a strong password through a secure database-user workflow and enable `LOGIN` only when the credential is ready. Then configure its connection string as the function's `DATABASE_URL` secret/environment variable before deployment. The role can only read and insert owner-scoped family/learner records. Do not put the connection string in project files or the mini program.

The function is source- and unit-tested but is not deployed. Before deployment, verify that the CloudBase PostgreSQL endpoint is reachable from Cloud Functions and that its authenticated `auth.uid()` value matches the function context's `OPENID`; that mapping and an end-to-end call still require live environment validation.

## Tencent QuestionOCR adapter

`cloudfunctions/process-import/tencent-question-ocr.js` calls Tencent Cloud OCR API `QuestionOCR` through the official Node.js SDK. Set `OCR_TENCENT_SECRET_ID`, `OCR_TENCENT_SECRET_KEY`, and `OCR_TENCENT_REGION` as protected Cloud Function settings; never put them in the Mini Program or commit them. CloudBase rejects environment keys starting with `TENCENTCLOUD_`, so the OCR-specific names are required (the adapter still accepts the SDK defaults outside CloudBase). CloudBase currently shows Shanghai 1; `ap-shanghai` is the initial OCR region candidate and must be confirmed by an API response. The adapter accepts only selected-question crops and rejects full-page or mixed-question images. API calls are rate-limited to at most two per second. Tencent OCR has no subject confidence in this adapter, so output stays in review as `needs_subject`; it is not auto-archived.

The temporary `ocr-smoke-test` function accepts only the two currently confirmed labels (`p29-q2`, `p30-extra-q2`), requires `confirmBillableOcr: true`, and takes each crop as base64 that must match the SHA-256 digest configured in `OCR_TEST_ALLOWED_CROP_SHA256`. Callers are restricted by `OCR_TEST_ALLOWED_IDENTITIES` (comma-separated WeChat OPENID or CloudBase user IDs; `OCR_TEST_ALLOWED_OPENID` still works). With no identity configured the function only answers `{"action":"whoami"}` so the owner can learn their own ID, and it never runs OCR. `OCR_TEST_CONSOLE_TOKEN` allows a token-guarded `{"action":"diagnostics"}` probe and console invocation. Each image is limited to 3 MB, results are not persisted, and the function returns only recognized question text and usage. Delete the function after validation. The third claimed mark on question 4 is not visible as a distinct third sub-question in the latest uploaded photo and is intentionally excluded until its crop is confirmed.

### CloudBase integration notes discovered during live validation

- CloudBase rejects function environment keys prefixed with `TENCENTCLOUD_`, `SCF_`, or `QCLOUD_`; use `OCR_TENCENT_*` instead.
- Calls made through the CloudBase JS SDK (`@cloudbase/js-sdk`) reach the function with `TCB_CONTEXT_KEYS` and `TCB_UUID`, not `WX_OPENID`. `wx-server-sdk`'s `getWXContext()` only reads `WX_CONTEXT_KEYS`, so it returns an empty object on that path. Read the documented context keys from `process.env` instead; `initialize-family` and `ocr-smoke-test` both do this now.
- `cloud.downloadFile({ fileID })` from `wx-server-sdk` fails against the current storage backend (`downloadFile:fail Cannot read properties of undefined (reading '0')`), so the Mini Program fetches the approved crops through a signed URL and sends bytes to the function.
- Storage reads are governed by PostgreSQL RLS on `storage.objects`. The existing policies require `owner_id = auth.uid()` and that the first path segment equals the caller UID, so objects uploaded through the console are invisible to the client. A temporary read policy `daydayup_validation_object_select_temp_ocr` for the `ocr-smoke-test/` prefix was added for this validation and must be dropped together with the temporary function.
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
