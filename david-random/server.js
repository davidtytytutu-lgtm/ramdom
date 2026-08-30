"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const ALLOWED_ORIGIN =
    "https://david-officiel.neocities.org";

const GITHUB_TOKEN =
    process.env.GITHUB_TOKEN;

const GITHUB_OWNER =
    process.env.GITHUB_OWNER ||
    "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO ||
    "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH ||
    "main";

const ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY;

const CHAT_LOG_LIMIT =
    15 * 1024 * 1024;

const MAX_FILE_SIZE =
    25 * 1024 * 1024;

const MESSAGE_LIMIT =
    500;

/* =========================================================
   VALIDATION
========================================================= */

if (!ENCRYPTION_KEY) {
    console.error(
        "ERREUR : ENCRYPTION_KEY est manquante."
    );

    process.exit(1);
}

if (!GITHUB_TOKEN) {
    console.error(
        "ERREUR : GITHUB_TOKEN est manquante."
    );

    process.exit(1);
}

const CRYPTO_KEY =
    crypto
        .createHash("sha256")
        .update(ENCRYPTION_KEY)
        .digest();

/* =========================================================
   EXPRESS
========================================================= */

app.disable("x-powered-by");

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "2mb"
    })
);

/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {

    const origin =
        req.headers.origin;

    if (
        !origin ||
        origin === ALLOWED_ORIGIN
    ) {

        res.setHeader(
            "Access-Control-Allow-Origin",
            origin || ALLOWED_ORIGIN
        );

        res.setHeader(
            "Vary",
            "Origin"
        );

        res.setHeader(
            "Access-Control-Allow-Credentials",
            "true"
        );

        res.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization"
        );

        res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PATCH,DELETE,OPTIONS"
        );
    }

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

/* =========================================================
   UPLOAD
========================================================= */

const upload =
    multer({
        storage: multer.memoryStorage(),

        limits: {
            fileSize: MAX_FILE_SIZE
        }
    });

/* =========================================================
   MEMORY
========================================================= */

const sessions =
    new Map();

const clients =
    new Set();

/* =========================================================
   GITHUB
========================================================= */

function githubApiUrl(path = "") {

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/contents/" +
        path
    );
}

async function githubRequest(
    path,
    options = {}
) {

    const response =
        await fetch(
            githubApiUrl(path),
            {
                ...options,

                headers: {
                    "Accept":
                        "application/vnd.github+json",

                    "Authorization":
                        `Bearer ${GITHUB_TOKEN}`,

                    "X-GitHub-Api-Version":
                        "2022-11-28",

                    "User-Agent":
                        "David-Random-Server",

                    ...(options.headers || {})
                }
            }
        );

    const text =
        await response.text();

    let data = {};

    try {
        data =
            text
                ? JSON.parse(text)
                : {};
    } catch {
        throw new Error(
            "Réponse GitHub invalide"
        );
    }

    if (!response.ok) {

        throw new Error(
            data.message ||
            `GitHub HTTP ${response.status}`
        );
    }

    return data;
}

/* =========================================================
   ENCRYPTION
========================================================= */

function encryptJSON(value) {

    const iv =
        crypto.randomBytes(16);

    const cipher =
        crypto.createCipheriv(
            "aes-256-cbc",
            CRYPTO_KEY,
            iv
        );

    const input =
        JSON.stringify(value);

    const encrypted =
        Buffer.concat([
            cipher.update(
                Buffer.from(
                    input,
                    "utf8"
                )
            ),
            cipher.final()
        ]);

    return {
        version: 1,

        iv:
            iv.toString("base64"),

        data:
            encrypted.toString("base64")
    };
}

function decryptJSON(payload) {

    if (
        !payload ||
        payload.version !== 1 ||
        !payload.iv ||
        !payload.data
    ) {

        throw new Error(
            "FORMAT USERS.ENC INVALIDE"
        );
    }

    const iv =
        Buffer.from(
            payload.iv,
            "base64"
        );

    const encrypted =
        Buffer.from(
            payload.data,
            "base64"
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-cbc",
            CRYPTO_KEY,
            iv
        );

    const decrypted =
        Buffer.concat([
            decipher.update(
                encrypted
            ),
            decipher.final()
        ]);

    return JSON.parse(
        decrypted.toString("utf8")
    );
}

/* =========================================================
   USERS DATABASE
========================================================= */

const USERS_FILE =
    "accounts/users.enc";

let users = [];

let usersLoaded =
    false;

async function loadUsers() {

    try {

        const data =
            await githubRequest(
                USERS_FILE
            );

        if (!data.content) {
            throw new Error(
                "USERS DATABASE VIDE"
            );
        }

        const encrypted =
            Buffer
                .from(
                    data.content,
                    "base64"
                )
                .toString("utf8");

        const payload =
            JSON.parse(
                encrypted
            );

        const loadedUsers =
            decryptJSON(
                payload
            );

        if (!Array.isArray(loadedUsers)) {
            throw new Error(
                "USERS DATABASE CORRUPTED"
            );
        }

        users =
            loadedUsers;

        usersLoaded =
            true;

        console.log(
            `[USERS] ${users.length} comptes chargés`
        );

        return true;

    } catch (error) {

        usersLoaded =
            false;

        console.error(
            "[USERS] DATABASE ERROR:",
            error.message
        );

        return false;
    }
}

async function saveUsers() {

    if (!usersLoaded) {

        throw new Error(
            "Impossible de sauvegarder : users.enc n'est pas chargé correctement."
        );
    }

    const payload =
        encryptJSON(users);

    const content =
        Buffer
            .from(
                JSON.stringify(payload),
                "utf8"
            )
            .toString("base64");

    let sha;

    try {

        const old =
            await githubRequest(
                USERS_FILE
            );

        sha =
            old.sha;

    } catch {
        sha =
            undefined;
    }

    const body = {

        message:
            "Update accounts database",

        content,

        branch:
            GITHUB_BRANCH
    };

    if (sha) {
        body.sha =
            sha;
    }

    await githubRequest(
        USERS_FILE,
        {
            method: "PUT",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body:
                JSON.stringify(body)
        }
    );
}

/* =========================================================
   AUTH
========================================================= */

function createToken() {

    return crypto
        .randomBytes(48)
        .toString("hex");
}

function publicUser(user) {

    if (!user) {
        return null;
    }

    return {

        id:
            user.id,

        username:
            user.username,

        profile_picture:
            user.profile_picture ||
            null,

        created_at:
            user.created_at
    };
}

function getTokenFromRequest(req) {

    const header =
        req.headers.authorization;

    if (
        !header ||
        typeof header !== "string"
    ) {
        return null;
    }

    if (
        !header
            .toLowerCase()
            .startsWith("bearer ")
    ) {
        return null;
    }

    return header
        .slice(7)
        .trim() || null;
}

function getUserFromToken(token) {

    if (!token) {
        return null;
    }

    const session =
        sessions.get(token);

    if (!session) {
        return null;
    }

    const user =
        users.find(
            u =>
                u.id ===
                session.userId
        );

    if (!user) {

        sessions.delete(token);

        return null;
    }

    return user;
}

function requireAuth(
    req,
    res,
    next
) {

    const token =
        getTokenFromRequest(req);

    const user =
        getUserFromToken(token);

    if (!user) {

        return res
            .status(401)
            .json({
                success: false,
                error:
                    "LOGIN REQUIRED"
            });
    }

    req.authToken =
        token;

    req.user =
        user;

    next();
}

/* =========================================================
   STATUS
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({

            online:
                true,

            name:
                "DAVID RANDOM V2 API",

            version:
                "2.1",

            users:
                users.length,

            websocket:
                clients.size

        });
    }
);

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            online:
                true,

            users:
                users.length,

            websocket:
                clients.size,

            github:
                Boolean(
                    GITHUB_TOKEN
                ),

            users_loaded:
                usersLoaded

        });
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
                    req.body.username ||
                    ""
                ).trim();

            const password =
                String(
                    req.body.password ||
                    ""
                );

            const profile =
                req.body.profile_picture
                    ? String(
                        req.body.profile_picture
                    ).trim()
                    : null;

            if (!usersLoaded) {

                return res
                    .status(503)
                    .json({
                        error:
                            "USER DATABASE NOT READY"
                    });
            }

            if (
                username.length < 3 ||
                username.length > 24
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "USERNAME MUST BE 3-24 CHARACTERS"
                    });
            }

            if (
                !/^[a-zA-Z0-9_\- ]+$/.test(
                    username
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "USERNAME CONTAINS INVALID CHARACTERS"
                    });
            }

            if (
                password.length < 8 ||
                password.length > 128
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "PASSWORD MUST BE 8-128 CHARACTERS"
                    });
            }

            const exists =
                users.some(
                    user =>
                        String(
                            user.username
                        ).toLowerCase() ===
                        username.toLowerCase()
                );

            if (exists) {

                return res
                    .status(409)
                    .json({
                        error:
                            "USERNAME ALREADY EXISTS"
                    });
            }

            if (
                profile &&
                !/^https?:\/\/.+/i.test(
                    profile
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "INVALID IMAGE URL"
                    });
            }

            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );

            const user = {

                id:
                    crypto.randomUUID(),

                username,

                password_hash:
                    passwordHash,

                profile_picture:
                    profile ||
                    null,

                created_at:
                    new Date().toISOString()

            };

            users.push(user);

            await saveUsers();

            const token =
                createToken();

            sessions.set(
                token,
                {
                    userId:
                        user.id,

                    createdAt:
                        Date.now()
                }
            );

            res.json({

                success:
                    true,

                token,

                user:
                    publicUser(user)

            });

        } catch (error) {

            console.error(
                "[REGISTER]",
                error
            );

            res
                .status(500)
                .json({
                    error:
                        error.message
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
                    req.body.username ||
                    ""
                ).trim();

            const password =
                String(
                    req.body.password ||
                    ""
                );

            if (!usersLoaded) {

                return res
                    .status(503)
                    .json({
                        error:
                            "USER DATABASE NOT READY"
                    });
            }

            const user =
                users.find(
                    u =>
                        String(
                            u.username
                        ).toLowerCase() ===
                        username.toLowerCase()
                );

            if (!user) {

                return res
                    .status(401)
                    .json({
                        error:
                            "INVALID USERNAME OR PASSWORD"
                    });
            }

            const valid =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );

            if (!valid) {

                return res
                    .status(401)
                    .json({
                        error:
                            "INVALID USERNAME OR PASSWORD"
                    });
            }

            const token =
                createToken();

            sessions.set(
                token,
                {
                    userId:
                        user.id,

                    createdAt:
                        Date.now()
                }
            );

            res.json({

                success:
                    true,

                token,

                user:
                    publicUser(user)

            });

        } catch (error) {

            console.error(
                "[LOGIN]",
                error
            );

            res
                .status(500)
                .json({
                    error:
                        error.message
                });
        }
    }
);

/* =========================================================
   ME
========================================================= */

app.get(
    "/api/account/me",

    requireAuth,

    (req, res) => {

        res.json({

            success:
                true,

            user:
                publicUser(
                    req.user
                )

        });
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
            req.authToken
        );

        res.json({
            success:
                true
        });
    }
);

/* =========================================================
   PROFILE PICTURE
========================================================= */

async function updateProfilePicture(
    req,
    res
) {

    try {

        const url =
            String(
                req.body.profile_picture ||
                ""
            ).trim();

        if (
            !/^https?:\/\/.+/i.test(
                url
            )
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "INVALID IMAGE URL"
                });
        }

        if (url.length > 2000) {

            return res
                .status(400)
                .json({
                    error:
                        "PROFILE PICTURE URL TOO LONG"
                });
        }

        req.user.profile_picture =
            url;

        await saveUsers();

        res.json({

            success:
                true,

            user:
                publicUser(
                    req.user
                )

        });

    } catch (error) {

        console.error(
            "[PROFILE]",
            error
        );

        res
            .status(500)
            .json({
                error:
                    error.message
            });
    }
}

app.post(
    "/api/account/profile-picture",

    requireAuth,

    updateProfilePicture
);

app.patch(
    "/api/account/profile",

    requireAuth,

    updateProfilePicture
);

/* =========================================================
   FILES
========================================================= */

const ALLOWED_FOLDERS = [
    "image",
    "music",
    "video"
];

app.get(
    "/api/files/:folder",

    async (req, res) => {

        try {

            const folder =
                req.params.folder;

            if (
                !ALLOWED_FOLDERS.includes(
                    folder
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "INVALID FOLDER"
                    });
            }

            const data =
                await githubRequest(
                    folder
                );

            const files =
                Array.isArray(data)
                    ? data
                    : [];

            res.json({

                success:
                    true,

                files:
                    files
                        .filter(
                            file =>
                                file.type ===
                                "file"
                        )
                        .map(
                            file => ({

                                name:
                                    file.name,

                                path:
                                    file.path,

                                download:
                                    file.download_url ||
                                    `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file.path}`

                            })
                        )

            });

        } catch (error) {

            console.error(
                "[FILES]",
                error
            );

            res
                .status(500)
                .json({
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

                return res
                    .status(400)
                    .json({
                        error:
                            "NO FILE"
                    });
            }

            const folder =
                String(
                    req.body.folder ||
                    ""
                ).trim();

            if (
                !ALLOWED_FOLDERS.includes(
                    folder
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "INVALID FOLDER"
                    });
            }

            const safeName =
                req.file.originalname
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );

            const filename =
                `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`;

            const path =
                `${folder}/${filename}`;

            const content =
                req.file.buffer.toString(
                    "base64"
                );

            await githubRequest(
                path,
                {
                    method:
                        "PUT",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({

                            message:
                                `Upload ${path}`,

                            content,

                            branch:
                                GITHUB_BRANCH

                        })
                }
            );

            const download =
                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;

            res.json({

                success:
                    true,

                name:
                    filename,

                path,

                download

            });

        } catch (error) {

            console.error(
                "[UPLOAD]",
                error
            );

            res
                .status(500)
                .json({
                    error:
                        error.message
                });
        }
    }
);

/* =========================================================
   CHAT LOGS
========================================================= */

function chatLogPath(number) {

    return (
        "chat-log/" +
        number +
        ".json"
    );
}

async function getChatLogsList() {

    try {

        const data =
            await githubRequest(
                "chat-log"
            );

        return Array.isArray(data)
            ? data
            : [];

    } catch (error) {

        console.error(
            "[CHAT LOG LIST]",
            error.message
        );

        return [];
    }
}

async function readChatLog(number) {

    const path =
        chatLogPath(number);

    const data =
        await githubRequest(
            path
        );

    if (!data.content) {
        return [];
    }

    const decoded =
        Buffer
            .from(
                data.content,
                "base64"
            )
            .toString("utf8");

    const json =
        JSON.parse(decoded);

    if (Array.isArray(json)) {
        return json;
    }

    if (
        json &&
        Array.isArray(
            json.messages
        )
    ) {
        return json.messages;
    }

    return [];
}

/* =========================================================
   CHAT LOG LIST API
========================================================= */

app.get(
    "/api/chat/logs",

    requireAuth,

    async (req, res) => {

        try {

            const files =
                await getChatLogsList();

            const logs =
                files
                    .filter(
                        file =>
                            file.name &&
                            /^\d+\.json$/i.test(
                                file.name
                            )
                    )
                    .map(
                        file => ({

                            name:
                                file.name,

                            path:
                                file.path,

                            download:
                                file.download_url ||
                                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file.path}`

                        })
                    )
                    .sort(
                        (a, b) =>
                            Number(
                                a.name.replace(
                                    ".json",
                                    ""
                                )
                            ) -
                            Number(
                                b.name.replace(
                                    ".json",
                                    ""
                                )
                            )
                    );

            res.json({

                success:
                    true,

                logs

            });

        } catch (error) {

            console.error(
                "[CHAT LOGS]",
                error
            );

            res
                .status(500)
                .json({
                    error:
                        error.message
                });
        }
    }
);

/* =========================================================
   SINGLE CHAT LOG
========================================================= */

app.get(
    "/api/chat/log/:number",

    requireAuth,

    async (req, res) => {

        try {

            const number =
                String(
                    req.params.number
                );

            if (
                !/^\d+$/.test(
                    number
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "INVALID LOG NUMBER"
                    });
            }

            const messages =
                await readChatLog(
                    number
                );

            res.json({

                success:
                    true,

                messages

            });

        } catch (error) {

            console.error(
                "[CHAT LOG]",
                error
            );

            res
                .status(404)
                .json({
                    error:
                        error.message
                });
        }
    }
);

/* =========================================================
   SAVE CHAT MESSAGE
========================================================= */

async function saveChatMessage(
    message
) {

    const files =
        await getChatLogsList();

    const jsonFiles =
        files
            .filter(
                file =>
                    /^\d+\.json$/i.test(
                        file.name ||
                        ""
                    )
            )
            .sort(
                (a, b) =>
                    Number(
                        a.name.replace(
                            ".json",
                            ""
                        )
                    ) -
                    Number(
                        b.name.replace(
                            ".json",
                            ""
                        )
                    )
            );

    let number =
        1;

    let messages =
        [];

    let currentSha =
        null;

    if (jsonFiles.length) {

        const last =
            jsonFiles[
                jsonFiles.length - 1
            ];

        number =
            Number(
                last.name.replace(
                    ".json",
                    ""
                )
            );

        try {

            messages =
                await readChatLog(
                    number
                );

            const githubFile =
                await githubRequest(
                    last.path
                );

            currentSha =
                githubFile.sha;

        } catch (error) {

            console.error(
                "[CHAT LAST LOG]",
                error.message
            );

            messages =
                [];

            currentSha =
                null;
        }
    }

    messages.push(
        message
    );

    let content =
        JSON.stringify(
            {
                messages
            },
            null,
            2
        );

    if (
        Buffer.byteLength(
            content,
            "utf8"
        ) >
        CHAT_LOG_LIMIT
    ) {

        number++;

        messages = [
            message
        ];

        content =
            JSON.stringify(
                {
                    messages
                },
                null,
                2
            );

        currentSha =
            null;
    }

    const path =
        chatLogPath(
            number
        );

    if (!currentSha) {

        try {

            const existing =
                await githubRequest(
                    path
                );

            currentSha =
                existing.sha;

        } catch {}
    }

    const body = {

        message:
            `Chat message ${number}`,

        content:
            Buffer
                .from(
                    content,
                    "utf8"
                )
                .toString("base64"),

        branch:
            GITHUB_BRANCH
    };

    if (currentSha) {

        body.sha =
            currentSha;
    }

    await githubRequest(
        path,
        {
            method:
                "PUT",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body:
                JSON.stringify(body)
        }
    );

    return {
        number,
        path
    };
}

/* =========================================================
   WEBSOCKET TOKEN
========================================================= */

function getTokenFromWebSocket(
    request
) {

    try {

        const url =
            new URL(
                request.url,
                `http://${request.headers.host}`
            );

        return (
            url.searchParams.get(
                "token"
            ) ||
            null
        );

    } catch {

        return null;
    }
}

/* =========================================================
   WEBSOCKET
========================================================= */

wss.on(
    "connection",
    (ws, request) => {

        const token =
            getTokenFromWebSocket(
                request
            );

        const user =
            getUserFromToken(
                token
            );

        if (!user) {

            try {

                ws.send(
                    JSON.stringify({

                        type:
                            "error",

                        message:
                            "LOGIN REQUIRED"

                    })
                );

                ws.close(
                    1008,
                    "LOGIN REQUIRED"
                );

            } catch {}

            return;
        }

        ws.authToken =
            token;

        ws.userId =
            user.id;

        clients.add(
            ws
        );

        console.log(
            "[WSS] Connected:",
            user.username
        );

        ws.send(
            JSON.stringify({

                type:
                    "welcome",

                authenticated:
                    true,

                username:
                    user.username,

                user_id:
                    user.id,

                profile_picture:
                    user.profile_picture ||
                    null

            })
        );

        broadcastUsers();

        ws.on(
            "message",
            async raw => {

                try {

                    const current =
                        getUserFromToken(
                            ws.authToken
                        );

                    if (!current) {

                        ws.send(
                            JSON.stringify({

                                type:
                                    "error",

                                message:
                                    "SESSION EXPIRED"

                            })
                        );

                        ws.close(
                            1008,
                            "SESSION EXPIRED"
                        );

                        return;
                    }

                    let data;

                    try {

                        data =
                            JSON.parse(
                                raw.toString()
                            );

                    } catch {

                        ws.send(
                            JSON.stringify({

                                type:
                                    "error",

                                message:
                                    "INVALID JSON"

                            })
                        );

                        return;
                    }

                    if (
                        !data ||
                        data.type !==
                        "message"
                    ) {
                        return;
                    }

                    const message =
                        String(
                            data.message ||
                            ""
                        ).trim();

                    if (!message) {
                        return;
                    }

                    if (
                        message.length >
                        MESSAGE_LIMIT
                    ) {

                        ws.send(
                            JSON.stringify({

                                type:
                                    "error",

                                message:
                                    "MESSAGE TOO LONG"

                            })
                        );

                        return;
                    }

                    const chatMessage = {

                        username:
                            current.username,

                        user_id:
                            current.id,

                        profile_picture:
                            current.profile_picture ||
                            null,

                        message,

                        timestamp:
                            new Date()
                                .toISOString()

                    };

                    /*
                    On envoie immédiatement
                    le message aux utilisateurs.
                    */

                    broadcast({

                        type:
                            "message",

                        data:
                            chatMessage

                    });

                    /*
                    Puis on sauvegarde sur GitHub.
                    */

                    try {

                        await saveChatMessage(
                            chatMessage
                        );

                    } catch (error) {

                        console.error(
                            "[CHAT LOG SAVE]",
                            error.message
                        );

                        /*
                        Le message reste visible
                        même si GitHub est temporairement
                        indisponible.
                        */

                        try {

                            ws.send(
                                JSON.stringify({

                                    type:
                                        "warning",

                                    message:
                                        "Message envoyé mais impossible de sauvegarder le chat-log."

                                })
                            );

                        } catch {}
                    }

                } catch (error) {

                    console.error(
                        "[WSS MESSAGE]",
                        error
                    );

                    try {

                        ws.send(
                            JSON.stringify({

                                type:
                                    "error",

                                message:
                                    "INVALID MESSAGE"

                            })
                        );

                    } catch {}
                }
            }
        );

        ws.on(
            "close",
            () => {

                clients.delete(
                    ws
                );

                console.log(
                    "[WSS] Disconnected:",
                    user.username
                );

                broadcastUsers();
            }
        );

        ws.on(
            "error",
            error => {

                console.error(
                    "[WSS]",
                    error.message
                );
            }
        );
    }
);

/* =========================================================
   BROADCAST
========================================================= */

function broadcast(data) {

    const message =
        JSON.stringify(
            data
        );

    for (
        const client
        of clients
    ) {

        if (
            client.readyState ===
            WebSocket.OPEN
        ) {

            try {

                client.send(
                    message
                );

            } catch (error) {

                console.error(
                    "[BROADCAST]",
                    error.message
                );
            }
        }
    }
}

function broadcastUsers() {

    broadcast({

        type:
            "users",

        count:
            clients.size

    });
}

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (
        err,
        req,
        res,
        next
    ) => {

        console.error(
            "[EXPRESS ERROR]",
            err
        );

        if (
            err instanceof
            multer.MulterError
        ) {

            return res
                .status(400)
                .json({
                    error:
                        err.message
                });
        }

        res
            .status(500)
            .json({
                error:
                    err.message ||
                    "SERVER ERROR"
            });
    }
);

/* =========================================================
   START
========================================================= */

async function start() {

    console.log(
        "================================"
    );

    console.log(
        "DAVID RANDOM V2 API"
    );

    console.log(
        "================================"
    );

    console.log(
        "PORT:",
        PORT
    );

    console.log(
        "GITHUB:",
        `${GITHUB_OWNER}/${GITHUB_REPO}`
    );

    console.log(
        "BRANCH:",
        GITHUB_BRANCH
    );

    console.log(
        "ORIGIN:",
        ALLOWED_ORIGIN
    );

    console.log(
        "CHAT LOG LIMIT:",
        `${CHAT_LOG_LIMIT / 1024 / 1024} MB`
    );

    console.log(
        "UPLOAD LIMIT:",
        `${MAX_FILE_SIZE / 1024 / 1024} MB`
    );

    console.log(
        "MESSAGE LIMIT:",
        MESSAGE_LIMIT
    );

    console.log(
        "================================"
    );

    const loaded =
        await loadUsers();

    if (!loaded) {

        console.error(
            "================================"
        );

        console.error(
            "ATTENTION : users.enc n'a pas pu être chargé."
        );

        console.error(
            "Le serveur démarre quand même,"
        );

        console.error(
            "mais les comptes sont désactivés"
        );

        console.error(
            "tant que la base n'est pas chargée."
        );

        console.error(
            "================================"
        );
    }

    server.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                `SERVER LISTENING ON ${PORT}`
            );

            console.log(
                "API READY"
            );

            console.log(
                "WSS READY"
            );

            console.log(
                "================================"
            );
        }
    );
}

start();
