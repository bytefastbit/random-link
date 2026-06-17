# Random Link

![GitHub stars](https://img.shields.io/github/stars/bytefastbit/random-link?style=for-the-badge&logo=github)
![GitHub forks](https://img.shields.io/github/forks/bytefastbit/random-link?style=for-the-badge&logo=github)
![GitHub issues](https://img.shields.io/github/issues/bytefastbit/random-link?style=for-the-badge&logo=github)
![Last commit](https://img.shields.io/github/last-commit/bytefastbit/random-link?style=for-the-badge&logo=github)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=white)
![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red?style=for-the-badge)

A Node.js application that creates secure, single-use download links. It works as a proxy so the original file URL is never exposed to the user, and each link can be used only once.

## What it does

- Password-protected admin panel for creating links
- Single-use download links that self-destruct after the first download
- Proxy download flow so the source URL stays hidden
- URL scrambling on the download page to discourage casual inspection
- Redis-backed storage using Upstash until the link is used

## How it works

1. Open `/admin` and enter the admin password plus the original file URL.
2. The server generates a random ID and stores the `ID -> source URL` mapping in Upstash Redis.
3. A shareable link is returned in the form `/p/:id`.
4. When the link is opened, the user sees a simple download page.
5. Clicking **Start Secure Download** sends the request to `/download/:id`.
6. The server looks up the original URL, deletes the record immediately, and streams the file back to the user.
7. Any later attempt to use the same link returns a 404.

## Keep-alive setup

This deployment uses a keep-alive ping to prevent the Render service from idling out.

- Keep-alive URL: `https://random-link.onrender.com/ping`
- Ping schedule: every 10 minutes
- Suggested scheduler: `https://console.cron-job.org/`

The `/ping` route returns a simple `200` response so external schedulers can keep the app awake.

## Tech stack

- Node.js
- Express
- Upstash Redis
- `node-fetch`

## Setup

### Prerequisites

- Node.js and npm
- An Upstash Redis database
- An admin password for `/admin`

### Install

```bash
git clone https://github.com/bytefastbit/random-link.git
cd random-link
npm install
```

### Environment variables

Set these in your environment or a `.env` file:

```bash
UPSTASH_URL="https://your-region-your-db.upstash.io"
UPSTASH_TOKEN="your-upstash-token"
ADMIN_PASSWORD="your-secret-password"
PORT=3000
```

### Run locally

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

## API endpoints

### `GET /admin`
Shows the admin form used to create a secure link.

### `POST /admin/generate`
Validates the admin password, stores the original source URL, and returns a shareable link.

### `GET /p/:id`
Public download page for a secure link.

### `POST /download/:id`
Fetches the original file, deletes the stored link, and streams the file to the user.

### `GET /ping`
Health check / keep-alive route for hosting providers that suspend idle services.

## Notes

- The original file URL is never shown to the end user.
- The link can only be used once.
- The stored mapping is removed before the file is streamed, so the same link cannot be reused.

## License

This repository is source-available, not open source. See [`LICENSE`](./LICENSE) for the full terms.

The code may not be copied, modified, redistributed, or used to create derivative works without prior written permission from the copyright holder.

If permission is granted in writing for any reuse, clear credit to the original author must be preserved.
