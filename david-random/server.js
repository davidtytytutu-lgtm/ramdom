"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURATION GITHUB
   ========================================================= */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

/*
Exemple :

GITHUB_OWNER = davidtytytutu-lgtm
GITHUB_REPO  = ramdom
GITHUB_BRANCH = main
*/

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.warn("⚠️ VARIABLES GITHUB MANQUANTES");
}

/* =========================================================
   EXPRESS
   ========================================================= */

app.use(express.json({
    limit: "2mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "2mb"
}));

app.use((req, res, next) => {

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

/* =========================================================
   MULTER
   ========================================================= */

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 25 * 1024 * 1024
    }
});

/* =========================================================
   GITHUB API
   ========================================================= */

const githubHeaders = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DAVID-RANDOM"
};

function githubPath(path) {
    return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
}

/* =========================================================
   GITHUB : LIRE UN FICHIER
   ========================================================= */

async function githubGetFile(path) {

    const response = await fetch(
        githubPath(path) + `?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
        {
            headers: githubHeaders
        }
    );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        const text = await response.text();

        throw new Error(
            `GitHub GET ${response.status}: ${text}`
        );
    }

    return await response.json();
}

/* =========================================================
   GITHUB : CONTENU D'UN FICHIER
   ========================================================= */

async function githubReadText(path) {

    const file = await githubGetFile(path);

    if (!file) {
        return null;
    }

    if (!file.content) {
        throw new Error("GitHub file content missing");
    }

    return Buffer
        .from(file.content.replace(/\n/g, ""), "base64")
        .toString("utf8");
}

/* =========================================================
   GITHUB : ECRIRE UN FICHIER
   ========================================================= */

async function githubWriteFile(path, content, message) {

    const existing = await githubGetFile(path);

    const body = {
        message,
        content: Buffer
            .from(content)
            .toString("base64"),
        branch: GITHUB_BRANCH
    };

    if (existing && existing.sha) {
        body.sha = existing.sha;
    }

    const response = await fetch(
        githubPath(path),
        {
            method: "PUT",
            headers: {
                ...githubHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    if (!response.ok) {

        const text = await response.text();

        throw new Error(
            `GitHub PUT ${response.status}: ${text}`
        );
    }

    return await response.json();
}

/* =========================================================
   GITHUB : SUPPRIMER
   ========================================================= */

async function githubDeleteFile(path, message) {

    const existing = await githubGetFile(path);

    if (!existing) {
        return false;
    }

    const response = await fetch(
        githubPath(path),
        {
            method: "DELETE",
            headers: {
                ...githubHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message,
                sha: existing.sha,
                branch: GITHUB_BRANCH
            })
        }
    );

    if (!response.ok) {

        const text = await response.text();

        throw new Error(
            `GitHub DELETE ${response.status}: ${text}`
        );
    }

    return true;
}

/* =========================================================
   GITHUB : LISTE D'UN DOSSIER
   ========================================================= */

async function githubList(path) {

    const response = await fetch(
        githubPath(path) +
        `?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
        {
            headers: githubHeaders
        }
    );

    if (response.status === 404) {
        return [];
    }

    if (!response.ok) {

        const text = await response.text();

        throw new Error(
            `GitHub LIST ${response.status}: ${text}`
        );
    }

    return await response.json();
}

/* =========================================================
   COMPTES
   ========================================================= */

const ACCOUNTS_JSON = "accounts/accounts.json";
const USERS_ENC = "accounts/users.enc";

/*
accounts.json contient la structure publique :

{
    "version": 2,
    "users": [...]
}

users.enc contient une copie chiffrée des informations
sensibles.
*/

let accountsCache = null;

/* =========================================================
   HASH MOT DE PASSE
   ========================================================= */

function hashPassword(password, salt) {

    return crypto
        .scryptSync(password, salt, 64)
        .toString("hex");
}

function createPassword(password) {

    const salt = crypto
        .randomBytes(32)
        .toString("hex");

    const hash = hashPassword(password, salt);

    return {
        salt,
        hash
    };
}

function verifyPassword(password, salt, hash) {

    try {

        const calculated = hashPassword(
            password,
            salt
        );

        return crypto.timingSafeEqual(
            Buffer.from(calculated, "hex"),
            Buffer.from(hash, "hex")
        );

    } catch {
        return false;
    }
}

/* =========================================================
   CHIFFREMENT users.enc
   ========================================================= */

const ENC_KEY = crypto
    .createHash("sha256")
    .update(
        process.env.ACCOUNTS_ENCRYPTION_KEY ||
        "CHANGE_THIS_SECRET_KEY"
    )
    .digest();

function encryptUsers(data) {

    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        ENC_KEY,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(
            JSON.stringify(data),
            "utf8"
        ),
        cipher.final()
    ]);

    return JSON.stringify({
        version: 1,
        iv: iv.toString("base64"),
        data: encrypted.toString("base64")
    });
}

function decryptUsers(text) {

    try {

        const obj = JSON.parse(text);

        const iv = Buffer.from(
            obj.iv,
            "base64"
        );

        const encrypted = Buffer.from(
            obj.data,
            "base64"
        );

        const decipher = crypto.createDecipheriv(
            "aes-256-cbc",
            ENC_KEY,
            iv
        );

        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);

        return JSON.parse(
            decrypted.toString("utf8")
        );

    } catch {

        return null;
    }
}

/* =========================================================
   CHARGER LES COMPTES
   ========================================================= */

async function loadAccounts() {

    if (accountsCache) {
        return accountsCache;
    }

    const text = await githubReadText(
        ACCOUNTS_JSON
    );

    if (!text) {

        accountsCache = {
            version: 2,
            users: []
        };

        return accountsCache;
    }

    try {

        accountsCache = JSON.parse(text);

    } catch {

        console.error(
            "accounts.json invalide"
        );

        accountsCache = {
            version: 2,
            users: []
        };
    }

    if (!Array.isArray(accountsCache.users)) {
        accountsCache.users = [];
    }

    return accountsCache;
}

/* =========================================================
   SAUVEGARDER LES COMPTES
   ========================================================= */

async function saveAccounts(accounts) {

    accountsCache = accounts;

    await githubWriteFile(
        ACCOUNTS_JSON,
        JSON.stringify(
            accounts,
            null,
            2
        ),
        "Update accounts.json"
    );

    /*
    Création de users.enc.

    On ne met pas le mot de passe en clair.
    */

    const encrypted = encryptUsers(
        accounts.users
    );

    await githubWriteFile(
        USERS_ENC,
        encrypted,
        "Update users.enc"
    );
}

/* =========================================================
   SESSION
   ========================================================= */

const sessions = new Map();

function createSession(user) {

    const token = crypto
        .randomBytes(48)
        .toString("hex");

    sessions.set(token, {
        userId: user.id,
        username: user.username,
        created: Date.now()
    });

    return token;
}

function getSession(req) {

    const auth =
        req.headers.authorization || "";

    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    const token =
        auth.substring(7).trim();

    if (!token) {
        return null;
    }

    return sessions.get(token) || null;
}

function requireAuth(req, res, next) {

    const session = getSession(req);

    if (!session) {

        return res.status(401).json({
            error: "LOGIN REQUIRED"
        });
    }

    req.session = session;
    req.token =
        req.headers.authorization
            .substring(7)
            .trim();

    next();
}

/* =========================================================
   NORMALISATION PSEUDO
   ========================================================= */

function normalizeUsername(username) {

    return String(username || "")
        .trim()
        .toLowerCase();
}

/* =========================================================
   PUBLIC USER
   ========================================================= */

function publicUser(user) {

    return {
        id: user.id,
        username: user.username,
        profile_picture:
            user.profile_picture || null,
        created_at:
            user.created_at
    };
}

/* =========================================================
   STATUS
   ========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        try {

            const accounts =
                await loadAccounts();

            res.json({
                online: true,
                users: accounts.users.length,
                github: true,
                render: true,
                websocket: true,
                accounts: "github"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                online: false,
                error: error.message
            });
        }
    }
);

/* =========================================================
   REGISTER
   ========================================================= */

app.post(
    "/api/account/register",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const password =
                String(
                    req.body.password || ""
                );

            const profile_picture =
                req.body.profile_picture
                    ? String(
                        req.body.profile_picture
                    ).trim()
                    : null;

            if (
                username.length < 3 ||
                username.length > 24
            ) {

                return res.status(400).json({
                    error:
                        "USERNAME MUST BE 3-24 CHARACTERS"
                });
            }

            if (
                !/^[a-zA-Z0-9_.-]+$/.test(username)
            ) {

                return res.status(400).json({
                    error:
                        "INVALID USERNAME"
                });
            }

            if (
                password.length < 8 ||
                password.length > 128
            ) {

                return res.status(400).json({
                    error:
                        "PASSWORD MUST BE 8-128 CHARACTERS"
                });
            }

            const accounts =
                await loadAccounts();

            const normalized =
                normalizeUsername(username);

            const exists =
                accounts.users.some(
                    u =>
                        normalizeUsername(
                            u.username
                        ) === normalized
                );

            if (exists) {

                return res.status(409).json({
                    error:
                        "USERNAME ALREADY EXISTS"
                });
            }

            const passwordData =
                createPassword(password);

            const user = {

                id: crypto
                    .randomUUID(),

                username,

                password_hash:
                    passwordData.hash,

                password_salt:
                    passwordData.salt,

                profile_picture,

                created_at:
                    new Date().toISOString()
            };

            accounts.users.push(user);

            await saveAccounts(accounts);

            const token =
                createSession(user);

            res.json({
                success: true,
                token,
                user: publicUser(user)
            });

        } catch (error) {

            console.error(
                "REGISTER ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "REGISTER FAILED"
            });
        }
    }
);

/* =========================================================
   LOGIN
   ========================================================= */

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const password =
                String(
                    req.body.password || ""
                );

            const accounts =
                await loadAccounts();

            const normalized =
                normalizeUsername(username);

            const user =
                accounts.users.find(
                    u =>
                        normalizeUsername(
                            u.username
                        ) === normalized
                );

            if (!user) {

                return res.status(401).json({
                    error:
                        "INVALID USERNAME OR PASSWORD"
                });
            }

            /*
            Nouveau format
            */

            let valid = false;

            if (
                user.password_hash &&
                user.password_salt
            ) {

                valid =
                    verifyPassword(
                        password,
                        user.password_salt,
                        user.password_hash
                    );
            }

            if (!valid) {

                return res.status(401).json({
                    error:
                        "INVALID USERNAME OR PASSWORD"
                });
            }

            const token =
                createSession(user);

            res.json({
                success: true,
                token,
                user: publicUser(user)
            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "LOGIN FAILED"
            });
        }
    }
);

/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
    "/api/account/logout",
    requireAuth,
    (req, res) => {

        sessions.delete(
            req.token
        );

        res.json({
            success: true
        });
    }
);

/* =========================================================
   ME
   ========================================================= */

app.get(
    "/api/account/me",
    requireAuth,
    async (req, res) => {

        try {

            const accounts =
                await loadAccounts();

            const user =
                accounts.users.find(
                    u =>
                        u.id ===
                        req.session.userId
                );

            if (!user) {

                return res.status(401).json({
                    error:
                        "LOGIN REQUIRED"
                });
            }

            res.json({
                user: publicUser(user)
            });

        } catch (error) {

            res.status(500).json({
                error:
                    "ACCOUNT ERROR"
            });
        }
    }
);

/* =========================================================
   LISTE FICHIERS GITHUB
   ========================================================= */

app.get(
    "/api/files/:folder",
    async (req, res) => {

        try {

            const allowed = [
                "image",
                "music",
                "video"
            ];

            const folder =
                req.params.folder;

            if (!allowed.includes(folder)) {

                return res.status(400).json({
                    error:
                        "INVALID FOLDER"
                });
            }

            const files =
                await githubList(folder);

            const result =
                files
                    .filter(
                        f =>
                            f.type === "file"
                    )
                    .map(f => ({

                        name: f.name,

                        path: f.path,

                        size: f.size,

                        download:
                            `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${f.path}`

                    }));

            res.json({
                files: result
            });

        } catch (error) {

            console.error(
                "FILES ERROR:",
                error
            );

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   UPLOAD
   ========================================================= */

app.post(
    "/api/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    error:
                        "NO FILE"
                });
            }

            const folder =
                String(
                    req.body.folder || ""
                );

            const allowed = [
                "image",
                "music",
                "video"
            ];

            if (!allowed.includes(folder)) {

                return res.status(400).json({
                    error:
                        "INVALID FOLDER"
                });
            }

            const originalName =
                req.file.originalname
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );

            const safeName =
                `${Date.now()}_${originalName}`;

            const path =
                `${folder}/${safeName}`;

            const existing =
                await githubGetFile(path);

            const body = {

                message:
                    `Upload ${path}`,

                content:
                    req.file.buffer.toString(
                        "base64"
                    ),

                branch:
                    GITHUB_BRANCH
            };

            if (existing?.sha) {
                body.sha = existing.sha;
            }

            const response =
                await fetch(
                    githubPath(path),
                    {
                        method: "PUT",
                        headers: {
                            ...githubHeaders,
                            "Content-Type":
                                "application/json"
                        },
                        body:
                            JSON.stringify(body)
                    }
                );

            if (!response.ok) {

                const text =
                    await response.text();

                throw new Error(text);
            }

            const download =
                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;

            res.json({
                success: true,
                name: safeName,
                path,
                download
            });

        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   CHAT LOG
   ========================================================= */

const CHAT_FOLDER =
    "chat-log";

const CHAT_LIMIT =
    15 * 1024 * 1024;

async function listChatLogs() {

    const files =
        await githubList(
            CHAT_FOLDER
        );

    return files
        .filter(
            f =>
                f.type === "file" &&
                /\.json$/i.test(f.name)
        )
        .sort(
            (a, b) =>
                a.name.localeCompare(
                    b.name,
                    undefined,
                    {
                        numeric: true
                    }
                )
        );
}

app.get(
    "/api/chat/logs",
    requireAuth,
    async (req, res) => {

        try {

            const files =
                await listChatLogs();

            res.json({
                logs:
                    files.map(
                        f => ({
                            name: f.name,
                            size: f.size
                        })
                    )
            });

        } catch (error) {

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/chat/log/:number",
    requireAuth,
    async (req, res) => {

        try {

            const number =
                String(
                    req.params.number
                ).replace(
                    /[^0-9]/g,
                    ""
                );

            const path =
                `${CHAT_FOLDER}/chat-${number}.json`;

            const text =
                await githubReadText(path);

            if (!text) {

                return res.status(404).json({
                    error:
                        "CHAT LOG NOT FOUND"
                });
            }

            const data =
                JSON.parse(text);

            res.json(data);

        } catch (error) {

            res.status(500).json({
                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   CHAT : SAUVEGARDE
   ========================================================= */

let chatMessages = [];
let chatLoaded = false;

async function loadChat() {

    if (chatLoaded) {
        return;
    }

    chatLoaded = true;

    try {

        const logs =
            await listChatLogs();

        if (!logs.length) {
            chatMessages = [];
            return;
        }

        const latest =
            logs[logs.length - 1];

        const text =
            await githubReadText(
                latest.path
            );

        if (!text) {
            chatMessages = [];
            return;
        }

        const data =
            JSON.parse(text);

        chatMessages =
            Array.isArray(
                data.messages
            )
                ? data.messages
                : [];

    } catch (error) {

        console.error(
            "CHAT LOAD:",
            error
        );

        chatMessages = [];
    }
}

async function saveChat() {

    const json =
        JSON.stringify(
            {
                version: 2,
                messages:
                    chatMessages
            },
            null,
            2
        );

    /*
    Si le fichier devient trop gros,
    on crée un nouveau log.
    */

    let logs =
        await listChatLogs();

    let filename =
        "chat-1.json";

    if (logs.length) {

        filename =
            logs[logs.length - 1]
                .name;

        const latest =
            await githubReadText(
                `${CHAT_FOLDER}/${filename}`
            );

        if (
            latest &&
            Buffer.byteLength(
                json,
                "utf8"
            ) > CHAT_LIMIT
        ) {

            const nums =
                logs
                    .map(
                        x =>
                            Number(
                                (
                                    x.name.match(
                                        /(\d+)/
                                    ) || []
                                )[1] || 0
                            )
                    );

            const next =
                Math.max(
                    0,
                    ...nums
                ) + 1;

            filename =
                `chat-${next}.json`;

            chatMessages =
                chatMessages.slice(
                    -200
                );
        }
    }

    await githubWriteFile(
        `${CHAT_FOLDER}/${filename}`,
        json,
        `Update ${filename}`
    );
}

/* =========================================================
   WEBSOCKET
   ========================================================= */

const wss =
    new WebSocket.Server({
        noServer: true
    });

const clients =
    new Set();

async function authenticateToken(token) {

    if (!token) {
        return null;
    }

    return sessions.get(token) || null;
}

server.on(
    "upgrade",
    async (request, socket, head) => {

        try {

            const url =
                new URL(
                    request.url,
                    `http://${request.headers.host}`
                );

            if (url.pathname !== "/ws") {

                socket.destroy();
                return;
            }

            const token =
                url.searchParams.get(
                    "token"
                );

            const session =
                await authenticateToken(
                    token
                );

            if (!session) {

                socket.write(
                    "HTTP/1.1 401 Unauthorized\r\n\r\n"
                );

                socket.destroy();

                return;
            }

            wss.handleUpgrade(
                request,
                socket,
                head,
                ws => {

                    wss.emit(
                        "connection",
                        ws,
                        request,
                        session
                    );
                }
            );

        } catch {

            socket.destroy();
        }
    }
);

wss.on(
    "connection",
    async (ws, request, session) => {

        clients.add(ws);

        ws.user = session;

        await loadChat();

        ws.send(
            JSON.stringify({
                type: "welcome",
                authenticated: true,
                username:
                    session.username,
                user_id:
                    session.userId
            })
        );

        ws.send(
            JSON.stringify({
                type: "users",
                count:
                    clients.size
            })
        );

        broadcastUsers();

        ws.on(
            "message",
            async raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );

                    if (
                        data.type !==
                        "message"
                    ) {
                        return;
                    }

                    const message =
                        String(
                            data.message || ""
                        ).trim();

                    if (!message) {
                        return;
                    }

                    if (
                        message.length > 500
                    ) {
                        return;
                    }

                    const chatMessage = {

                        id:
                            crypto.randomUUID(),

                        username:
                            session.username,

                        user_id:
                            session.userId,

                        message,

                        timestamp:
                            new Date()
                                .toISOString()
                    };

                    chatMessages.push(
                        chatMessage
                    );

                    /*
                    Garde les derniers messages
                    en mémoire.
                    */

                    if (
                        chatMessages.length >
                        1000
                    ) {

                        chatMessages =
                            chatMessages.slice(
                                -1000
                            );
                    }

                    broadcast({
                        type:
                            "message",

                        data:
                            chatMessage
                    });

                    try {

                        await saveChat();

                    } catch (error) {

                        console.error(
                            "CHAT SAVE ERROR:",
                            error
                        );
                    }

                } catch (error) {

                    console.error(
                        "WSS MESSAGE ERROR:",
                        error
                    );

                    ws.send(
                        JSON.stringify({
                            type:
                                "error",

                            message:
                                "INVALID MESSAGE"
                        })
                    );
                }
            }
        );

        ws.on(
            "close",
            () => {

                clients.delete(ws);

                broadcastUsers();
            }
        );

        ws.on(
            "error",
            () => {

                clients.delete(ws);

                broadcastUsers();
            }
        );
    }
);

/* =========================================================
   BROADCAST
   ========================================================= */

function broadcast(data) {

    const text =
        JSON.stringify(data);

    for (const client of clients) {

        if (
            client.readyState ===
            WebSocket.OPEN
        ) {

            client.send(text);
        }
    }
}

function broadcastUsers() {

    broadcast({
        type: "users",
        count: clients.size
    });
}

/* =========================================================
   ROOT
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({
            name:
                "DAVID RANDOM V2 API",

            online:
                true,

            accounts:
                "GitHub",

            storage:
                "GitHub",

            websocket:
                "/ws"
        });
    }
);

/* =========================================================
   START
   ========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "======================================"
        );

        console.log(
            " DAVID RANDOM V2 SERVER"
        );

        console.log(
            " PORT:",
            PORT
        );

        console.log(
            " GITHUB:",
            GITHUB_OWNER +
            "/" +
            GITHUB_REPO
        );

        console.log(
            " ACCOUNTS:",
            ACCOUNTS_JSON
        );

        console.log(
            " ENCRYPTED:",
            USERS_ENC
        );

        console.log(
            " WEBSOCKET: /ws"
        );

        console.log(
            "======================================"
        );
    }
);
