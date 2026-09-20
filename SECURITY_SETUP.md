# Production access configuration

Before deploying this change, verify these settings privately in the hosting dashboard:

- `LINE_CHANNEL_SECRET`: the existing LINE channel secret. Incoming webhook bodies must have a valid signature. Missing configuration returns HTTP 503.
- `LINE_ADMIN_USERS`: comma-separated LINE user IDs allowed to submit text or audio. An empty list permits no users. Spaces around IDs are trimmed.
- `ADMIN_API_TOKEN`: an independently generated random token of at least 32 characters, only if the generation HTTP API is needed. Clients send it in `Authorization: Bearer <token>`. With no token, this API is disabled. Keep it in a password manager or secret store; never put it in URLs or client-side code.

Diagnostic HTTP routes are disabled. Public media routes serve only final MP4 files and thumbnails; possession of a final-media link still grants access, so do not publish confidential media through this mechanism.

The Docker image uses Node 24 LTS and runs the application as the `node` user. Build context excludes local credentials, installed dependencies, generated jobs, and test files. Preserve write permissions for the job/output directories when attaching volumes.

Run `npm run test:security` after installing dependencies. Tests use synthetic credentials, real loopback HTTP, and block outgoing provider requests in server subprocesses. Installation during this review used `npm ci --ignore-scripts`; the FFmpeg installer, Docker build, paid AI generation, LINE delivery, and hosted behavior were not exercised.

The Python `edge-tts` install in the Dockerfile and downloaded FFmpeg executable are outside the npm advisory scan. `fluent-ffmpeg` is deprecated upstream and needs a separate migration plan.

Do not rotate existing LINE or AI secrets merely to apply this patch. If actual credential exposure is confirmed, rotate affected credentials and review provider audit logs with the owner.
