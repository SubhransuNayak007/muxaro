# MUXARO — Verified Bug Tracker & Changelog

| ID | Area | Issue | Resolution | Status |
| --- | --- | --- | --- | --- |
| BUG-001 | Android APK | Black screen on launch (`WebViewLocalServer` `html5mode` infinite redirect loop on `/m/`) | Replaced redirect stub with pre-rendered `/m/index.html` + `history.replaceState` boot in `sync-www.mjs`, added splash theme attrs & EdgeToEdge auto insets | Verified Closed |
| BUG-002 | Desktop EXE | `Uncaught Exception: ENOENT` reading `_next/static/chunks/*.js` inside `app.asar` | Moved `web-dist` to `extraResources`, removed static portable unpack dir lock, added `pipeFileStream` error guards & startup HTTP cache clearing | Verified Closed |
| BUG-003 | PDF Creation | `"The source image could not be decoded."` on 20 mixed photos / unsupported HEIC | Built `lib/pdf/image-pipeline.ts` with magic-byte sniffing, bounded concurrency, `Image` fallback, per-item failure isolation + Retry/Replace/Remove | Verified Closed |
| BUG-004 | Media URLs | `"Media inspection returned an empty manifest."` on YouTube/webpage links | Built `lib/media/source-resolver.ts` classifying source kinds + SSRF guard & offering local upload / Drive alternatives | Verified Closed |
| BUG-005 | Voice | Misleading mic error state without permission lifecycle | Added `VoiceLifecycleState`, capability probe, immediate track cleanup, retry action, `RECORD_AUDIO` APK permission, and typed fallback | Verified Closed |
| BUG-006 | AI & RAG | Raw `**` markdown tokens, repeated passages, abrupt citation slices | Created `AssistantMarkdown.tsx` and added Jaccard passage deduplication + insufficient-evidence handling in `local-rag.ts` | Verified Closed |
| BUG-007 | Navigation | Inconsistent `"Mobile Hub"` labels across Android sub-tools | Unified `LayoutChrome.tsx` with MUXARO header and 4-tab bottom workspace nav synced to `/m?tab=...` | Verified Closed |
| BUG-008 | Media Convert | Static `"12x faster"` & unconditional lossless claim | Replaced with `planMediaConversion()` separating Remux, Transcode, and Incompatible inputs cleanly | Verified Closed |
| BUG-009 | Session State | Session files lost on refresh | Added IndexedDB persistence (`muxaro_session_store`) with quota-error fallback in `opened-artifact.tsx` | Verified Closed |
