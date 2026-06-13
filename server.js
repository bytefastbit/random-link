const express = require('express');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// In-memory database to store our one-time links
// Note: On free tiers, if the server restarts, these links are lost.
const activeLinks = new Map();

// YOUR SECRET PASSWORD - Change this before deploying!
const ADMIN_PASSWORD = "my_super_secret_password_123";

// 1. ADMIN PAGE: Where you generate the links
app.get('/admin', (req, res) => {
    res.send(`
        <html>
            <body style="font-family: Arial; padding: 50px;">
                <h2>Generate Secure Download Link</h2>
                <form method="POST" action="/admin/generate">
                    <input type="password" name="password" placeholder="Admin Password" required /><br><br>
                    <input type="url" name="originUrl" placeholder="Original Download Link (e.g. upload.ee/..)" style="width: 400px;" required /><br><br>
                    <button type="submit">Generate One-Time Link</button>
                </form>
            </body>
        </html>
    `);
});

app.post('/admin/generate', (req, res) => {
    const { password, originUrl } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).send("Unauthorized.");
    }

    // Generate a secure, random string (UUID)
    const token = crypto.randomUUID(); 
    
    // Store the origin URL linked to this token
    activeLinks.set(token, originUrl);

    // FIXED: Removed the invalid backslashes here
    const fullUrl = `${req.protocol}://${req.get('host')}/secure/${token}`;

    res.send(`
        <html>
            <body style="font-family: Arial; padding: 50px;">
                <h2>Success!</h2>
                <p>Share this link. It will work EXACTLY once.</p>
                <input type="text" value="${fullUrl}" style="width: 500px;" readonly />
            </body>
        </html>
    `);
});

// 2. THE REDIRECT PAGE: What the user sees
app.get('/secure/:token', (req, res) => {
    const token = req.params.token;

    if (!activeLinks.has(token)) {
        return res.status(404).send("<h1>Link Expired or Invalid</h1><p>This link has already been used or does not exist.</p>");
    }

    // Serve a page with a download button
    res.send(`
        <html>
            <body style="font-family: Arial; padding: 50px; text-align: center;">
                <h2>Your file is ready.</h2>
                <p>Clicking the button below will start the download and permanently destroy this link.</p>
                <form method="POST" action="/download/${token}">
                    <button type="submit" style="padding: 15px 30px; font-size: 18px; cursor: pointer;">Download File</button>
                </form>
            </body>
        </html>
    `);
});

// 3. THE PROXY DOWNLOADER: Hides the origin URL
app.post('/download/:token', (req, res) => {
    const token = req.params.token;

    if (!activeLinks.has(token)) {
        return res.status(404).send("Link expired.");
    }

    const targetUrl = activeLinks.get(token);
    
    // IMPORTANT: Delete the token immediately so it cannot be reused.
    activeLinks.delete(token);

    const client = targetUrl.startsWith('https') ? https : http;

    // Proxy the request
    client.get(targetUrl, (proxyRes) => {
        // Copy headers from the original file host (e.g., file size, content type)
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        // Pipe the data directly to the user
        // The user's browser only sees your server, never the targetUrl
        proxyRes.pipe(res);
    }).on('error', (err) => {
        console.error(err);
        res.status(500).send("Error downloading file.");
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    // FIXED: Removed the invalid backslashes here as well
    console.log(`Server running on port ${PORT}`);
});
