const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const crypto = require('crypto');

const app = express();
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------
// THE DATABASE HELPER (Talks to Upstash permanently)
// ---------------------------------------------------------
async function db(commandArray) {
    const res = await fetch(process.env.UPSTASH_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.UPSTASH_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(commandArray)
    });
    const data = await res.json();
    return data.result;
}

// ---------------------------------------------------------
// 0. KEEP-AWAKE PING ROUTE
// ---------------------------------------------------------
app.get('/ping', (req, res) => {
    res.status(200).send("Server is awake!");
});

// ---------------------------------------------------------
// 1. ADMIN PANEL (Secure URL Generator)
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

app.post('/admin/generate', async (req, res) => {
    const { password, sourceUrl } = req.body;
    
    // Grabs your password from Render's Environment Variables
    const adminPass = process.env.ADMIN_PASSWORD;
    
    if (password !== adminPass) {
        return res.status(403).send("Forbidden: Incorrect Password");
    }

    // Generate a secure, random ID
    const randomId = crypto.randomBytes(16).toString('hex');
    
    try {
        // STORE THE LINK PERMANENTLY IN THE UPSTASH DATABASE
        await db(["SET", randomId, sourceUrl]);

        // Give you the link to share
        const shareableLink = `${req.protocol}://${req.get('host')}/p/${randomId}`;
        res.send(`Success! Share this link: <br><br><b><a href="${shareableLink}">${shareableLink}</a></b><br><br><i>This link will self-destruct after one use.</i>`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error connecting to the database.");
    }
});

// ---------------------------------------------------------
// 2. THE REDIRECT PAGE
// ---------------------------------------------------------
app.get('/p/:id', async (req, res) => {
    const id = req.params.id;
    
    try {
        // Check if link exists in the database
        const sourceUrl = await db(["GET", id]);
        
        if (!sourceUrl) {
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
                    }, 100);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// ---------------------------------------------------------
// 3. THE PROXY DOWNLOAD (With Burn-After-Reading)
// ---------------------------------------------------------
app.post('/download/:id', async (req, res) => {
    const id = req.params.id;

    try {
        // 1. Get the original URL from the database
        const sourceUrl = await db(["GET", id]);
        
        if (!sourceUrl) {
            return res.status(404).send("Link expired or invalid.");
        }

        // 2. SECURITY: Delete the link immediately from the database so it can never be used again
        await db(["DEL", id]);

        // 3. Fetch the file from the original source as a proxy
        const response = await fetch(sourceUrl);
        
        if (!response.ok) throw new Error(`Unexpected response ${response.statusText}`);

        // 4. Forward headers and stream the file directly to the user
        res.setHeader('Content-Disposition', 'attachment');
        if (response.headers.get('content-type')) res.setHeader('Content-Type', response.headers.get('content-type'));
        if (response.headers.get('content-length')) res.setHeader('Content-Length', response.headers.get('content-length'));

        response.body.pipe(res);

    } catch (err) {
        console.error(err);
        res.status(500).send("Error proxying the download.");
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
