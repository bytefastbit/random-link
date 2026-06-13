const express = require('express');
const { Readable } = require('stream'); // Required for modern streaming
const crypto = require('crypto');
const app = express();

// 1. Tell Express to trust Render's proxy (Fixes the http vs https issue)
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// In-memory database to store our one-time links
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
                    <input type="url" name="originUrl" placeholder="Original Download Link" style="width: 400px;" required /><br><br>
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

    const token = crypto.randomUUID(); 
    activeLinks.set(token, originUrl);

    // This will now correctly generate https:// links
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
app.post('/download/:token', async (req, res) => {
    const token = req.params.token;

    if (!activeLinks.has(token)) {
        return res.status(404).send("Link expired.");
    }

    const targetUrl = activeLinks.get(token);
    
    // IMPORTANT: Delete the token immediately so it cannot be reused.
    activeLinks.delete(token);

    try {
        // Fetch the file while pretending to be a normal Chrome browser
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send(`Target server rejected the request. Status: ${response.status}`);
        }

        // Forward necessary headers (file size, type, etc.)
        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');
        const contentDisposition = response.headers.get('content-disposition');

        if (contentType) res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);
        
        // Force the browser to download the file instead of playing it inside the tab
        if (contentDisposition) {
            res.setHeader('Content-Disposition', contentDisposition);
        } else {
            res.setHeader('Content-Disposition', 'attachment'); 
        }

        // Pipe the file data directly to the user
        if (response.body) {
            Readable.fromWeb(response.body).pipe(res);
        } else {
            res.status(500).send("File is empty.");
        }

    } catch (error) {
        console.error(error);
        res.status(500).send("Error downloading file. The target server may be unreachable.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
