# Random Link: Secure, Single-Use Download Proxy

![GitHub stars](https://img.shields.io/github/stars/bytefastbit/random-link?style=for-the-badge&logo=github) ![GitHub forks](https://img.shields.io/github/forks/bytefastbit/random-link?style=for-the-badge&logo=github) ![GitHub issues](https://img.shields.io/github/issues/bytefastbit/random-link?style=for-the-badge&logo=github) ![Last commit](https://img.shields.io/github/last-commit/bytefastbit/random-link?style=for-the-badge&logo=github) ![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=white) ![License](https://img.shields.io/badge/license-ISC-green?style=for-the-badge)
[![Ask DeepWiki](https://devin.ai/assets/askdeepwiki.png)](https://deepwiki.com/bytefastbit/random-link)

This is a Node.js application that generates secure, single-use, "burn-after-reading" download links. It acts as a proxy to hide the original source of a file and ensures that a generated link can only be used once for a download.

## Features

*   **Password-Protected Admin Panel**: Generate new links from a secure `/admin` route.
*   **One-Time Use Links**: Each link self-destructs from the database immediately upon use.
*   **Download Proxy**: The original file's URL is never exposed to the end-user. The server streams the file to the user.
*   **URL Obfuscation**: The download page URL is continuously scrambled by client-side JavaScript to deter casual inspection and copying.
*   **Persistent Storage**: Uses [Upstash](https://upstash.com/) Redis for fast and persistent link storage until the first use.

## How It Works

1.  **Generation**: The administrator navigates to `/admin`, enters a password and the original file URL.
2.  **Storage**: The application generates a unique random ID and stores the `ID -> Original URL` mapping in an Upstash Redis database.
3.  **Sharing**: A shareable link in the format `https://your-domain.com/p/:id` is provided to the administrator.
4.  **Access**: A user clicks the shareable link and is presented with a simple download page. The URL in the browser's address bar is actively scrambled.
5.  **Download & Burn**: The user clicks "Start Secure Download". The server:
    *   Looks up the original URL from the database using the unique ID.
    *   **Immediately deletes the record** from the database to prevent reuse.
    *   Fetches the file from the original source and streams it directly to the user.
6.  **Expiration**: Any future attempt to access the same link will result in a "404 Not Found" error, as the record no longer exists.

## Tech Stack

*   **Backend**: Node.js, Express.js
*   **Database**: Upstash (Redis)
*   **Dependencies**: `node-fetch`

## Setup and Usage

### 1. Prerequisites

*   Node.js and npm installed.
*   An [Upstash](https://upstash.com/) account for the Redis database.

### 2. Installation

Clone the repository and install the dependencies.

```bash
git clone https://github.com/bytefastbit/random-link.git
cd random-link
npm install
```

### 3. Configuration

This application requires the following environment variables. You can set them directly in your shell or use a `.env` file with a library like `dotenv`.

*   `UPSTASH_URL`: The REST API URL for your Upstash Redis database.
*   `UPSTASH_TOKEN`: The read-write token for your Upstash Redis database.
*   `ADMIN_PASSWORD`: A secret password of your choice to protect the `/admin` panel.
*   `PORT`: The port for the server to run on (defaults to `3000`).

**Example:**

```bash
# Set these in your deployment environment (e.g., Render, Heroku)
UPSTASH_URL="https://your-region-your-db.upstash.io"
UPSTASH_TOKEN="YourUpstashReadWriteToken"
ADMIN_PASSWORD="a-very-secret-password"
PORT=3000
```

### 4. Running the Server

Start the application with the following command:

```bash
node server.js
```

The server will be running on `http://localhost:3000` (or your configured port).

## API Endpoints

*   `GET /admin`
    *   Displays the HTML form for generating a new secure link.

*   `POST /admin/generate`
    *   Accepts a password and `sourceUrl` from the form.
    *   Validates the password, generates a unique ID, and stores the link in the database.
    *   Returns the new shareable link.

*   `GET /p/:id`
    *   The public-facing download page for a given link ID.
    *   Presents a "Start Secure Download" button.

*   `POST /download/:id`
    *   The endpoint triggered by the download button.
    *   Retrieves the original URL from the database, then immediately deletes the record.
    *   Proxies and streams the file from the original source to the user.

*   `GET /ping`
    *   A simple keep-alive route that returns a `200` status, useful for hosting platforms that put idle services to sleep.
