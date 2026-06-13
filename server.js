const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const crypto = require('crypto');

const app = express();
app.use(express.urlencoded({ extended: true }));

// Store active links in memory. 
// Note: On free hosts, this resets if the server goes to sleep.
const activeLinks = new Map();

// YOUR SECRET PASSWORD - Change this!
const ADMIN_PASSWORD = 'mysecretpassword123';

// ---------------------------------------------------------
// 1. ADMIN PANEL (Only you can access this to generate links)
// ---------------------------------------------------------
app.get('/admin', (req, res) => {
    res.send(`
        <h2>Create Secure Link</h2>
        <form method="POST" action="/admin/generate">
            <input type="password" name="password" placeholder="Admin Password" required><br><br>
            <input type="url" name="sourceUrl" placeholder="Original Download Link" required size="50"><br><br>
            <button type="submit">Generate Link</button>
        </form>
    `);
});

app.post('/admin/generate', (req, res) => {
    const { password, sourceUrl } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).send("Forbidden");
    }

    // Generate a secure, random ID
    const randomId = crypto.randomBytes(16).toString('hex');
    
    // Store the original URL mapped to the random ID
    activeLinks.set(randomId, sourceUrl);

    // Give you the link to share
    const shareableLink = \`\${req.protocol}://\${req.get('host')}/p/\${randomId}\`;
    res.send(`Success! Share this link: <br><br><b><a href="\${shareableLink}">\${shareableLink}</a></b><br><br><i>This link will self-destruct after one use.</i>`);
});

// ---------------------------------------------------------
// 2. THE REDIRECT PAGE
// ---------------------------------------------------------
app.get('/p/:id', (req, res) => {
    const id = req.params.id;
    
    // Check if link exists
    if (!activeLinks.has(id)) {
        return res.status(404).send("This link does not exist or has already been used.");
    }

    // Render the page with the download button and the URL-scrambling script
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Secure Download</title>
            <style>
                body { display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; background: #111; color: white; }
                .btn { padding: 15px 30px; font-size: 20px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; border: none; cursor: pointer;}
            </style>
        </head>
        <body>
            <form method="POST" action="/download/${id}">
                <button class="btn" type="submit">Start Secure Download</button>
            </form>

            <script>
                // This script rapidly scrambles the URL in the address bar
                function generateRandomString(length) {
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~-';
                    let result = '';
                    for (let i = 0; i < length; i++) {
                        result += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    return result;
                }

                setInterval(() => {
                    const fakePath = "/" + generateRandomString(4) + "-" + generateRandomString(6) + "~" + generateRandomString(5);
                    window.history.replaceState(null, "", fakePath);
                }, 100); // Changes 10 times a second
            </script>
        </body>
        </html>
    `);
});

// ---------------------------------------------------------
// 3. THE PROXY DOWNLOAD (Hides the source from DevTools)
// ---------------------------------------------------------
app.post('/download/:id', async (req, res) => {
    const id = req.params.id;

    if (!activeLinks.has(id)) {
        return res.status(404).send("Link expired or invalid.");
    }

    const sourceUrl = activeLinks.get(id);
    
    // SECURITY: Delete the link immediately so it can never be used again
    activeLinks.delete(id);

    try {
        // Fetch the file from the original source as a proxy
        const response = await fetch(sourceUrl);
        
        if (!response.ok) throw new Error(\`Unexpected response \${response.statusText}\`);

        // Forward headers to the client so it triggers a file download
        res.setHeader('Content-Disposition', 'attachment');
        if (response.headers.get('content-type')) {
            res.setHeader('Content-Type', response.headers.get('content-type'));
        }
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }

        // Stream the file directly to the user
        response.body.pipe(res);

    } catch (err) {
        console.error(err);
        res.status(500).send("Error proxying the download.");
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});
