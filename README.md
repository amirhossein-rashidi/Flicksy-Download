# Flicksy Download

A modular movie and TV series archive discovery and download module.

## Architecture

- `apps/download/worker`: Cloudflare Worker API
- `apps/download/web`: Frontend
- `server.py`: local server (Flask) for use with a local `data/archive.json`
- `urlguard.py`: the only place that makes outside requests (offline switch, URL and redirect checks)
- `boundedcache.py`: size- and time-limited caches
- Provider-based archive integration
- Direct downloads from external sources
- No media proxying through the Worker

## Run locally (offline, default)

1. `pip install -r requirements.txt`
2. Put `archive.json` (and optional `scan-*.tsv`) into `data/` (these files are not stored in Git).
3. `python server.py`, then open http://127.0.0.1:8080

The default mode is **offline**: the server makes no outside requests. To allow live features, copy
`.env.example` to `.env` and set `FLICKSY_MODE=online` and `FLICKSY_API_KEY=...` (never commit `.env`).

## Tests

- `python -m pytest`
- Comparison with the original server: `python tests/compat/run_compat.py ORIGINAL_SERVER.py server.py data`

More: `docs/PHASE1-COMPATIBILITY.md`.

## API

- `GET /api/v1/health`

## Local MVP (Phase B) — اجرای نسخه محلی

۱. (فقط بار اول یا بعد از تغییر آرشیو) ساخت دیتابیس محلی از آرشیو (آرشیو دست نمی‌خورد):

    python -m flicksy_dl.importer

۲. اجرای برنامه:

    python -m flicksy_dl

۳. باز کردن در مرورگر: http://127.0.0.1:8090/  

- لینک‌ها فقط روی همین دستگاه نمایش داده می‌شوند. برای مخفی کردن آدرس لینک‌ها: `FLICKSY_EXPOSE_LINKS=0`.
- اسناد: `docs/API-CONTRACT.md`، `docs/PHASE-B-REPORT.md`. تست‌ها: `python -m pytest`.


## بررسی لینک‌ها (فقط سرنخ، بدون دانلود فایل)
```
python -m flicksy_dl.linkchecker --limit 100
python -m flicksy_dl.importer
python -m flicksy_dl
```
نتیجه در `data/overlay/link-status.json` ذخیره می‌شود؛ importer آن را اعمال می‌کند. جواب نامشخص یعنی «بررسی‌نشده»، نه «خراب». برای ادامه‌دادن دوباره همان دستور را بزن (لینک‌های قطعی رد می‌شوند). جزئیات: `docs/HANDOFF.md`.

## ساخت سایت استاتیک برای Cloudflare Pages
```
python -m flicksy_dl.staticgen
```
پوشهٔ `public` ساخته می‌شود (حدود ۸۰ فایل، ۷۰ مگابایت). همان را در گیتهاب آپلود کن و در Cloudflare Pages «Build output directory» را `public` بگذار و «Build command» را خالی.
- **بدون لینک (پیش‌فرض):** هیچ آدرس دانلودی در خروجی نیست.
- **با لینک:** فایل `fixtures/publish-hosts.example.json` را به `data/overlay/publish-hosts.json` کپی کن، نام میزبان‌هایی که حق انتشار لینکشان را داری در `allowedHosts` بنویس و این را اجرا کن: `python -m flicksy_dl.staticgen --publish-links`. لینک میزبان‌های دیگر هرگز در خروجی نمی‌آید.
- جستجو، فیلتر و صفحه‌بندی در مرورگر انجام می‌شود (بدون سرور). جستجوی استاتیک روی عنوان انگلیسی، عنوان فارسی و عنوان‌های دیگر کار می‌کند (کارگردان/بازیگر را جستجو نمی‌کند).
