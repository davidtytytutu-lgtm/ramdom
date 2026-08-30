"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const WebSocket = require("ws");

const app = express();

const PORT = process.env.PORT || 10000;

/*
===========================================================
CONFIGURATION
===========================================================
*/

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

/*
URL facultative de ton site NeoCities.
Si elle n'est pas définie, CORS autorise tout.
*/

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

/*
===========================================================
GITHUB
===========================================================
*/

if (!GITHUB_TOKEN) {
    console.warn("WARNING: GITHUB_TOKEN absent");
}

if (!GITHUB_OWNER) {
    console.warn("WARNING: GITHUB_OWNER absent");
}

if (!GITHUB_REPO) {
    console.warn("WARNING: GITHUB_REPO absent");
}

if (!ENCRYPTION_KEY) {
    console.warn("WARNING: ENCRYPTION_KEY absent");
}

const GITHUB_API =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

const githubHeaders = {
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DAVID-RANDOM"
};

/*
===========================================================
EXPRESS
===========================================================
*/

app.use(cors({
    origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN,
    credentials: true
}));

app.use(express.json({
    limit: "2mb"
}));

/*
===========================================================
MULTER
===========================================================
*/

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024
    }
});

/*
===========================================================
VARIABLES MEMOIRE
===========================================================
*/

/*
Les comptes permanents sont dans GitHub.

Les sessions sont volontairement en mémoire sur Render.
Un redémarrage Render invalide donc les sessions.
Le compte lui-même reste dans GitHub.
*/

const sessions = new Map();

const connectedSockets = new Set();

/*
===========================================================
UTILITAIRES
===========================================================
*/

function randomId(length = 24) {
    return crypto.randomBytes(length).toString("hex");
}

function hashPassword(password, salt) {
    return crypto
        .pbkdf2Sync(
            password,
            salt,
            120000,
            64,
            "sha512"
        )
        .toString("hex");
}

function createPasswordHash(password) {
    const salt = crypto.randomBytes(32).toString("hex");

    return {
        salt,
        hash: hashPassword(password, salt)
    };
}

function verifyPassword(password, salt, hash) {
    const calculated = hashPassword(password, salt);

    return crypto.timingSafeEqual(
        Buffer.from(calculated, "hex"),
        Buffer.from(hash, "hex")
    );
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase();
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        profile_picture: user.profile_picture || null,
        created_at: user.created_at
    };
}

/*
===========================================================
CHIFFREMENT users.enc
===========================================================
*/

function getEncryptionKey() {
    if (!ENCRYPTION_KEY) {
        throw new Error("ENCRYPTION_KEY NOT CONFIGURED");
    }

    return crypto
        .createHash("sha256")
        .update(ENCRYPTION_KEY)
        .digest();
}

function encryptUsers(data) {
    const key = getEncryptionKey();

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    const json = JSON.stringify(data);

    const encrypted = Buffer.concat([
        cipher.update(json, "utf8"),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return [
        "DR1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url")
    ].join(":");
}

function decryptUsers(text) {
    const key = getEncryptionKey();

    const parts = String(text).trim().split(":");

    if (parts.length !== 4 || parts[0] !== "DR1") {
        throw new Error("INVALID USERS ENC FORMAT");
    }

    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const encrypted = Buffer.from(parts[3], "base64url");

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
}

/*
===========================================================
GITHUB FILES
===========================================================
*/

async function githubGet(path) {

    const response = await fetch(
        `${GITHUB_API}/${path}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
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
            `GITHUB GET ${response.status}: ${text}`
        );
    }

    return await response.json();
}

async function githubReadText(path) {

    const file = await githubGet(path);

    if (!file) {
        return null;
    }

    if (!file.content) {
        throw new Error("GITHUB FILE HAS NO CONTENT");
    }

    return Buffer.from(
        file.content.replace(/\n/g, ""),
        "base64"
    ).toString("utf8");
}

async function githubWriteText(
    path,
    content,
    message
) {

    const existing = await githubGet(path);

    const body = {
        message,
        content: Buffer
            .from(content, "utf8")
            .toString("base64"),
        branch: GITHUB_BRANCH
    };

    if (existing && existing.sha) {
        body.sha = existing.sha;
    }

    const response = await fetch(
        `${GITHUB_API}/${path}`,
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
            `GITHUB WRITE ${response.status}: ${text}`
        );
    }

    return await response.json();
}

async function githubWriteBuffer(
    path,
    buffer,
    message
) {

    const existing = await githubGet(path);

    const body = {
        message,
        content: buffer.toString("base64"),
        branch: GITHUB_BRANCH
    };

    if (existing && existing.sha) {
        body.sha = existing.sha;
    }

    const response = await fetch(
        `${GITHUB_API}/${path}`,
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
            `GITHUB WRITE ${response.status}: ${text}`
        );
    }

    return await response.json();
}

/*
===========================================================
ACCOUNTS
===========================================================
*/

const ACCOUNTS_FILE = "accounts/accounts.json";
const USERS_FILE = "accounts/users.enc";

async function loadAccounts() {

    const text = await githubReadText(
        ACCOUNTS_FILE
    );

    if (!text) {
        return {
            users: []
        };
    }

    try {
        const data = JSON.parse(text);

        if (!Array.isArray(data.users)) {
            data.users = [];
        }

        return data;

    } catch {
        throw new Error(
            "accounts.json IS INVALID JSON"
        );
    }
}

async function saveAccounts(accounts) {

    await githubWriteText(
        ACCOUNTS_FILE,
        JSON.stringify(accounts, null, 2),
        "Update accounts.json"
    );
}

/*
===========================================================
USERS.ENCRYPTED
===========================================================
*/

async function loadEncryptedUsers() {

    const text = await githubReadText(
        USERS_FILE
    );

    if (!text) {
        return {
            users: []
        };
    }

    try {
        return decryptUsers(text);
    } catch (error) {
        console.error(
            "users.enc decrypt error:",
            error.message
        );

        throw new Error(
            "USERS DATABASE CORRUPTED OR ENCRYPTION KEY INVALID"
        );
    }
}

async function saveEncryptedUsers(data) {

    const encrypted = encryptUsers(data);

    await githubWriteText(
        USERS_FILE,
        encrypted,
        "Update encrypted users database"
    );
}

/*
===========================================================
DATABASE INITIALISATION
===========================================================
*/

async function ensureDatabase() {

    if (!GITHUB_TOKEN ||
        !GITHUB_OWNER ||
        !GITHUB_REPO ||
        !ENCRYPTION_KEY) {

        console.warn(
            "GitHub database cannot initialize: missing environment variables."
        );

        return;
    }

    try {

        let accounts = await loadAccounts();

        if (!accounts) {
            accounts = {
                users: []
            };
        }

        if (!Array.isArray(accounts.users)) {
            accounts.users = [];
        }

        /*
        Crée accounts.json si absent.
        */

        if (!(await githubGet(ACCOUNTS_FILE))) {

            await saveAccounts(accounts);

            console.log(
                "Created accounts/accounts.json"
            );
        }

        /*
        Crée users.enc si absent.
        */

        if (!(await githubGet(USERS_FILE))) {

            await saveEncryptedUsers({
                users: []
            });

            console.log(
                "Created accounts/users.enc"
            );
        }

        console.log(
            "GitHub account database ready."
        );

    } catch (error) {

        console.error(
            "Database initialization error:",
            error
        );
    }
}

/*
===========================================================
AUTHENTICATION
===========================================================
*/

function getTokenFromRequest(req) {

    const auth =
        req.headers.authorization || "";

    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    return auth.substring(7).trim() || null;
}

async function authenticateRequest(req) {

    const authToken =
        getTokenFromRequest(req);

    if (!authToken) {
        return null;
    }

    const session =
        sessions.get(authToken);

    if (!session) {
        return null;
    }

    /*
    Recharge le compte depuis GitHub.
    */

    const accounts =
        await loadAccounts();

    const user =
        accounts.users.find(
            u => u.id === session.userId
        );

    if (!user) {
        sessions.delete(authToken);
        return null;
    }

    return {
        token: authToken,
        user
    };
}

/*
===========================================================
STATUS
===========================================================
*/

app.get(
    "/api/status",
    async (req, res) => {

        try {

            let users = 0;

            if (
                GITHUB_TOKEN &&
                GITHUB_OWNER &&
                GITHUB_REPO
            ) {

                const accounts =
                    await loadAccounts();

                users =
                    accounts.users.length;
            }

            res.json({
                online: true,
                service: "DAVID RANDOM V2",
                users,
                github: true,
                websocket: true
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

/*
===========================================================
REGISTER
===========================================================
*/

app.post(
    "/api/account/register",
    async (req, res) => {

        try {

            const username =
                String(req.body.username || "").trim();

            const password =
                String(req.body.password || "");

            const profilePicture =
                req.body.profile_picture
                    ? String(req.body.profile_picture).trim()
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
                !/^[a-zA-Z0-9_-]+$/.test(username)
            ) {

                return res.status(400).json({
                    error:
                        "USERNAME CAN ONLY CONTAIN LETTERS, NUMBERS, _ AND -"
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
                        normalizeUsername(u.username) ===
                        normalized
                );

            if (exists) {

                return res.status(409).json({
                    error:
                        "USERNAME ALREADY EXISTS"
                });
            }

            const {
                salt,
                hash
            } = createPasswordHash(password);

            const user = {
                id: randomId(12),
                username,
                username_normalized: normalized,
                password_hash: hash,
                password_salt: salt,
                profile_picture:
                    profilePicture || null,
                created_at:
                    new Date().toISOString()
            };

            accounts.users.push({
                id: user.id,
                username: user.username,
                username_normalized:
                    user.username_normalized,
                profile_picture:
                    user.profile_picture,
                created_at:
                    user.created_at
            });

            /*
            Les informations sensibles sont conservées
            dans users.enc.
            */

            const encryptedUsers =
                await loadEncryptedUsers();

            encryptedUsers.users.push({
                id: user.id,
                username_normalized:
                    user.username_normalized,
                password_hash:
                    user.password_hash,
                password_salt:
                    user.password_salt
            });

            await saveAccounts(accounts);

            await saveEncryptedUsers(
                encryptedUsers
            );

            const token =
                crypto.randomBytes(48)
                    .toString("base64url");

            sessions.set(token, {
                userId: user.id,
                createdAt: Date.now()
            });

            console.log(
                `Account created: ${username}`
            );

            res.status(201).json({
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
                error: error.message
            });
        }
    }
);

/*
===========================================================
LOGIN
===========================================================
*/

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            const username =
                String(req.body.username || "").trim();

            const password =
                String(req.body.password || "");

            if (!username || !password) {

                return res.status(400).json({
                    error:
                        "USERNAME AND PASSWORD REQUIRED"
                });
            }

            const normalized =
                normalizeUsername(username);

            const accounts =
                await loadAccounts();

            const publicAccount =
                accounts.users.find(
                    u =>
                        normalizeUsername(
                            u.username
                        ) === normalized
                );

            if (!publicAccount) {

                return res.status(401).json({
                    error:
                        "INVALID USERNAME OR PASSWORD"
                });
            }

            const encryptedUsers =
                await loadEncryptedUsers();

            const secureUser =
                encryptedUsers.users.find(
                    u =>
                        u.id === publicAccount.id
                );

            if (!secureUser) {

                return res.status(401).json({
                    error:
                        "INVALID USERNAME OR PASSWORD"
                });
            }

            const valid =
                verifyPassword(
                    password,
                    secureUser.password_salt,
                    secureUser.password_hash
                );

            if (!valid) {

                return res.status(401).json({
                    error:
                        "INVALID USERNAME OR PASSWORD"
                });
            }

            const token =
                crypto.randomBytes(48)
                    .toString("base64url");

            sessions.set(token, {
                userId: publicAccount.id,
                createdAt: Date.now()
            });

            console.log(
                `Login: ${publicAccount.username}`
            );

            res.json({
                success: true,
                token,
                user: publicUser(
                    publicAccount
                )
            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
===========================================================
LOGOUT
===========================================================
*/

app.post(
    "/api/account/logout",
    async (req, res) => {

        const token =
            getTokenFromRequest(req);

        if (token) {
            sessions.delete(token);
        }

        res.json({
            success: true
        });
    }
);

/*
===========================================================
ME
===========================================================
*/

app.get(
    "/api/account/me",
    async (req, res) => {

        try {

            const auth =
                await authenticateRequest(req);

            if (!auth) {

                return res.status(401).json({
                    error: "LOGIN REQUIRED"
                });
            }

            res.json({
                success: true,
                user: publicUser(
                    auth.user
                )
            });

        } catch (error) {

            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
===========================================================
CHANGE PROFILE PICTURE
===========================================================
*/

app.post(
    "/api/account/profile-picture",
    async (req, res) => {

        try {

            const auth =
                await authenticateRequest(req);

            if (!auth) {

                return res.status(401).json({
                    error: "LOGIN REQUIRED"
                });
            }

            let profilePicture =
                req.body.profile_picture;

            if (
                profilePicture === undefined ||
                profilePicture === null
            ) {

                return res.status(400).json({
                    error:
                        "PROFILE PICTURE REQUIRED"
                });
            }

            profilePicture =
                String(profilePicture).trim();

            if (
                profilePicture.length > 2000
            ) {

                return res.status(400).json({
                    error:
                        "PROFILE PICTURE URL TOO LONG"
                });
            }

            if (
                profilePicture &&
                !/^https?:\/\//i.test(
                    profilePicture
                )
            ) {

                return res.status(400).json({
                    error:
                        "PROFILE PICTURE MUST BE A HTTP/HTTPS URL"
                });
            }

            const accounts =
                await loadAccounts();

            const user =
                accounts.users.find(
                    u =>
                        u.id === auth.user.id
                );

            if (!user) {

                return res.status(404).json({
                    error: "USER NOT FOUND"
                });
            }

            user.profile_picture =
                profilePicture || null;

            await saveAccounts(accounts);

            /*
            Envoie la nouvelle PDP aux clients
            connectés avec ce compte.
            */

            broadcastUserUpdate(
                user
            );

            res.json({
                success: true,
                user: publicUser(user)
            });

        } catch (error) {

            console.error(
                "PROFILE PICTURE ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
===========================================================
FILES / GITHUB
===========================================================
*/

app.get(
    "/api/files/:folder",
    async (req, res) => {

        try {

            const folder =
                req.params.folder;

            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(folder)
            ) {

                return res.status(400).json({
                    error:
                        "INVALID FOLDER"
                });
            }

            const file =
                await githubGet(folder);

            if (!file) {

                return res.json({
                    files: []
                });
            }

            const files =
                Array.isArray(file)
                    ? file
                    : [file];

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
                error: error.message
            });
        }
    }
);

/*
===========================================================
UPLOAD
===========================================================
*/

app.post(
    "/api/upload",
    upload.single("file"),
    async (req, res) => {

        try {

            const auth =
                await authenticateRequest(req);

            if (!auth) {

                return res.status(401).json({
                    error: "LOGIN REQUIRED"
                });
            }

            if (!req.file) {

                return res.status(400).json({
                    error:
                        "NO FILE PROVIDED"
                });
            }

            const folder =
                String(
                    req.body.folder || ""
                ).trim();

            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(folder)
            ) {

                return res.status(400).json({
                    error:
                        "INVALID FOLDER"
                });
            }

            if (
                req.file.size >
                25 * 1024 * 1024
            ) {

                return res.status(413).json({
                    error:
                        "FILE TOO LARGE. MAXIMUM 25 MB"
                });
            }

            const originalName =
                req.file.originalname
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );

            const timestamp =
                Date.now();

            const random =
                crypto.randomBytes(4)
                    .toString("hex");

            const filename =
                `${timestamp}_${random}_${originalName}`;

            const path =
                `${folder}/${filename}`;

            await githubWriteBuffer(
                path,
                req.file.buffer,
                `Upload ${folder}/${filename} by ${auth.user.username}`
            );

            const download =
                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;

            res.json({
                success: true,
                name: filename,
                path,
                download
            });

        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
===========================================================
CHAT LOG
===========================================================
*/

async function getChatLogs() {

    const data =
        await githubGet("chat-log");

    if (!data) {
        return [];
    }

    const files =
        Array.isArray(data)
            ? data
            : [data];

    return files
        .filter(
            f =>
                f.type === "file" &&
                /\.json$/i.test(f.name)
        )
        .sort(
            (a, b) =>
                a.name.localeCompare(b.name)
        );
}

app.get(
    "/api/chat/logs",
    async (req, res) => {

        try {

            const auth =
                await authenticateRequest(req);

            if (!auth) {

                return res.status(401).json({
                    error: "LOGIN REQUIRED"
                });
            }

            const logs =
                await getChatLogs();

            res.json({
                logs: logs.map(
                    f => ({
                        name: f.name,
                        path: f.path
                    })
                )
            });

        } catch (error) {

            console.error(
                "CHAT LOG LIST ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

app.get(
    "/api/chat/log/:number",
    async (req, res) => {

        try {

            const auth =
                await authenticateRequest(req);

            if (!auth) {

                return res.status(401).json({
                    error: "LOGIN REQUIRED"
                });
            }

            const number =
                String(req.params.number)
                    .replace(
                        /[^0-9]/g,
                        ""
                    );

            if (!number) {

                return res.status(400).json({
                    error:
                        "INVALID LOG NUMBER"
                });
            }

            const path =
                `chat-log/chat-${number}.json`;

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

            console.error(
                "CHAT LOG ERROR:",
                error
            );

            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
===========================================================
CHAT LOG WRITE
===========================================================
*/

async function appendChatMessage(message) {

    try {

        let logs =
            await getChatLogs();

        let target = null;

        if (logs.length) {

            target =
                logs[logs.length - 1];
        }

        let messages = [];

        if (target) {

            try {

                const text =
                    await githubReadText(
                        target.path
                    );

                const data =
                    JSON.parse(text);

                messages =
                    Array.isArray(data.messages)
                        ? data.messages
                        : [];

            } catch {

                messages = [];
            }
        }

        messages.push(message);

        /*
        Nouveau fichier si > 15 MB approximativement.
        */

        const serialized =
            JSON.stringify(
                {
                    messages
                },
                null,
                2
            );

        if (
            !target ||
            Buffer.byteLength(
                serialized,
                "utf8"
            ) > 15 * 1024 * 1024
        ) {

            let nextNumber = 1;

            if (logs.length) {

                const numbers =
                    logs
                        .map(
                            f =>
                                Number(
                                    (f.name.match(
                                        /(\d+)/
                                    ) || [])[1]
                                ) || 0
                        );

                nextNumber =
                    Math.max(...numbers) + 1;
            }

            const path =
                `chat-log/chat-${nextNumber}.json`;

            await githubWriteText(
                path,
                JSON.stringify(
                    {
                        messages: [message]
                    },
                    null,
                    2
                ),
                `Create chat log ${nextNumber}`
            );

        } else {

            await githubWriteText(
                target.path,
                serialized,
                `Update chat log by ${message.username}`
            );
        }

    } catch (error) {

        console.error(
            "CHAT LOG WRITE ERROR:",
            error
        );
    }
}

/*
===========================================================
WEBSOCKET
===========================================================
*/

const server =
    require("http").createServer(app);

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    });

async function authenticateSocket(
    ws,
    token
) {

    if (!token) {
        return null;
    }

    const session =
        sessions.get(token);

    if (!session) {
        return null;
    }

    try {

        const accounts =
            await loadAccounts();

        const user =
            accounts.users.find(
                u =>
                    u.id === session.userId
            );

        if (!user) {
            return null;
        }

        return user;

    } catch {

        return null;
    }
}

wss.on(
    "connection",
    async (ws, req) => {

        try {

            const url =
                new URL(
                    req.url,
                    `http://${req.headers.host}`
                );

            const token =
                url.searchParams.get(
                    "token"
                );

            const user =
                await authenticateSocket(
                    ws,
                    token
                );

            if (!user) {

                ws.send(
                    JSON.stringify({
                        type: "error",
                        message:
                            "LOGIN REQUIRED"
                    })
                );

                ws.close(
                    1008,
                    "LOGIN REQUIRED"
                );

                return;
            }

            ws.user = user;
            ws.authenticated = true;

            connectedSockets.add(ws);

            ws.send(
                JSON.stringify({
                    type: "welcome",
                    authenticated: true,
                    username:
                        user.username,
                    user_id:
                        user.id,
                    profile_picture:
                        user.profile_picture
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
                                randomId(8),
                            username:
                                ws.user.username,
                            user_id:
                                ws.user.id,
                            profile_picture:
                                ws.user.profile_picture ||
                                null,
                            message,
                            timestamp:
                                new Date()
                                    .toISOString()
                        };

                        broadcast({
                            type:
                                "message",
                            data:
                                chatMessage
                        });

                        await appendChatMessage(
                            chatMessage
                        );

                    } catch (error) {

                        console.error(
                            "WSS MESSAGE ERROR:",
                            error
                        );

                        ws.send(
                            JSON.stringify({
                                type: "error",
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

                    connectedSockets.delete(
                        ws
                    );

                    broadcastUsers();
                }
            );

            ws.on(
                "error",
                () => {

                    connectedSockets.delete(
                        ws
                    );
                }
            );

        } catch (error) {

            console.error(
                "WSS CONNECTION ERROR:",
                error
            );

            try {
                ws.close();
            } catch {}
        }
    }
);

/*
===========================================================
WEBSOCKET BROADCAST
===========================================================
*/

function broadcast(data) {

    const text =
        JSON.stringify(data);

    for (
        const ws of connectedSockets
    ) {

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            try {
                ws.send(text);
            } catch {}
        }
    }
}

function broadcastUsers() {

    broadcast({
        type: "users",
        count:
            connectedSockets.size
    });
}

function broadcastUserUpdate(user) {

    for (
        const ws of connectedSockets
    ) {

        if (
            ws.user &&
            ws.user.id === user.id &&
            ws.readyState === WebSocket.OPEN
        ) {

            ws.user =
                user;

            ws.send(
                JSON.stringify({
                    type:
                        "profile_updated",
                    username:
                        user.username,
                    user_id:
                        user.id,
                    profile_picture:
                        user.profile_picture
                })
            );
        }
    }
}

/*
===========================================================
ROOT
===========================================================
*/

app.get(
    "/",
    (req, res) => {

        res.json({
            name:
                "DAVID RANDOM V2 API",
            status:
                "ONLINE",
            github:
                "STORAGE ACTIVE",
            websocket:
                "wss://david-random.onrender.com/ws"
        });
    }
);

/*
===========================================================
404
===========================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({
            error:
                "ENDPOINT NOT FOUND"
        });
    }
);

/*
===========================================================
ERROR HANDLER
===========================================================
*/

app.use(
    (error, req, res, next) => {

        console.error(
            "EXPRESS ERROR:",
            error
        );

        res.status(500).json({
            error:
                error.message ||
                "INTERNAL SERVER ERROR"
        });
    }
);

/*
===========================================================
START
===========================================================
*/

server.listen(
    PORT,
    async () => {

        console.log(
            "========================================"
        );

        console.log(
            "      DAVID RANDOM V2 SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "GITHUB:",
            GITHUB_OWNER && GITHUB_REPO
                ? `${GITHUB_OWNER}/${GITHUB_REPO}`
                : "NOT CONFIGURED"
        );

        console.log(
            "WEBSOCKET:",
            "/ws"
        );

        console.log(
            "ACCOUNT STORAGE:",
            "GitHub"
        );

        console.log(
            "========================================"
        );

        await ensureDatabase();
    }
);
