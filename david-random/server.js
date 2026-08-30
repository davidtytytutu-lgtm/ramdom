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

const PORT =
    process.env.PORT || 10000;

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
   CONFIG VALIDATION
========================================================= */

if (!ENCRYPTION_KEY) {

    console.error(
        "[FATAL] ENCRYPTION_KEY manquante."
    );

    process.exit(1);
}

if (!GITHUB_TOKEN) {

    console.error(
        "[FATAL] GITHUB_TOKEN manquant."
    );

    process.exit(1);
}

/*
AES-256 :
la clé fournie dans Render peut avoir
n'importe quelle longueur.
On la transforme en 32 octets.
*/

const CRYPTO_KEY =
    crypto
        .createHash("sha256")
        .update(ENCRYPTION_KEY)
        .digest();

/* =========================================================
   EXPRESS
========================================================= */

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

app.use(
    (req, res, next) => {

        const origin =
            req.headers.origin;

        if (
            !origin ||
            origin === ALLOWED_ORIGIN
        ) {

            res.setHeader(
                "Access-Control-Allow-Origin",
                origin ||
                ALLOWED_ORIGIN
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
    }
);

/* =========================================================
   UPLOAD
========================================================= */

const upload =
    multer({

        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                MAX_FILE_SIZE
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
   CRYPTO
========================================================= */

/*
Format AES interne :

{
    version: 1,
    iv: "...",
    data: "..."
}
*/

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

        version:
            1,

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
            "FORMAT AES INVALIDE"
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
   DR1 COMPATIBILITY
========================================================= */

/*
Certaines anciennes versions du serveur
utilisaient :

DR1:...

On essaye plusieurs représentations
sans jamais remplacer users.enc si
le déchiffrement échoue.
*/

function decodeBase64Url(value) {

    let str =
        String(value)
            .replace(/-/g, "+")
            .replace(/_/g, "/");

    while (
        str.length % 4 !== 0
    ) {

        str += "=";
    }

    return Buffer.from(
        str,
        "base64"
    );
}


function tryParseJSONBuffer(buffer) {

    const text =
        buffer
            .toString("utf8")
            .trim();

    if (!text) {

        throw new Error(
            "DONNEES VIDES"
        );
    }

    return JSON.parse(text);
}


function decryptDR1(value) {

    /*
    Retire DR1:
    */

    const raw =
        String(value)
            .trim()
            .slice(4);

    if (!raw) {

        throw new Error(
            "DR1 VIDE"
        );
    }

    /*
    CAS 1 :

    DR1:{JSON}
    */

    if (
        raw.startsWith("{")
    ) {

        try {

            const payload =
                JSON.parse(raw);

            return decryptJSON(
                payload
            );

        } catch {}
    }

    /*
    CAS 2 :

    DR1:<base64>
    */

    try {

        const decoded =
            decodeBase64Url(raw);

        const text =
            decoded
                .toString("utf8")
                .trim();

        if (
            text.startsWith("{")
        ) {

            const payload =
                JSON.parse(text);

            if (
                payload.version === 1
            ) {

                return decryptJSON(
                    payload
                );
            }

            if (
                Array.isArray(payload)
            ) {

                return payload;
            }
        }

    } catch {}

    /*
    CAS 3 :

    DR1:iv:data
    */

    const parts =
        raw.split(":");

    if (
        parts.length >= 2
    ) {

        /*
        On essaie :

        DR1:iv:data
        */

        try {

            const iv =
                decodeBase64Url(
                    parts[0]
                );

            const encrypted =
                decodeBase64Url(
                    parts.slice(1).join(":")
                );

            if (
                iv.length === 16 &&
                encrypted.length > 0
            ) {

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

        } catch {}
    }

    /*
    CAS 4 :

    DR1:<iv hex>:<data hex>
    */

    if (
        parts.length >= 2
    ) {

        try {

            const iv =
                Buffer.from(
                    parts[0],
                    "hex"
                );

            const encrypted =
                Buffer.from(
                    parts.slice(1).join(":"),
                    "hex"
                );

            if (
                iv.length === 16 &&
                encrypted.length > 0
            ) {

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

        } catch {}
    }

    throw new Error(
        "FORMAT DR1 INVALIDE OU ENCRYPTION_KEY INCORRECTE"
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


/* =========================================================
   LOAD USERS
========================================================= */

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

        const fileText =
            Buffer
                .from(
                    data.content,
                    "base64"
                )
                .toString("utf8")
                .trim();

        console.log(
            "[USERS] Format détecté :",
            fileText.substring(
                0,
                40
            )
        );

        let loadedUsers;

        /*
        =====================================================
        DR1
        =====================================================
        */

        if (
            fileText.startsWith("DR1:")
        ) {

            loadedUsers =
                decryptDR1(
                    fileText
                );

        } else {

            /*
            =================================================
            AES JSON
            =================================================
            */

            let parsed;

            try {

                parsed =
                    JSON.parse(
                        fileText
                    );

            } catch {

                throw new Error(
                    "FORMAT USERS.ENC INCONNU"
                );
            }

            loadedUsers =
                decryptJSON(
                    parsed
                );
        }

        if (
            !Array.isArray(
                loadedUsers
            )
        ) {

            throw new Error(
                "USERS DATABASE NON VALIDE"
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

        users = [];

        console.error(
            "[USERS] DATABASE ERROR:",
            error.message
        );

        console.error(
            "[USERS] Les comptes existants ne seront PAS écrasés."
        );

        return false;
    }
}

/* =========================================================
   SAVE USERS
========================================================= */

async function saveUsers() {

    /*
    Sécurité importante :
    on interdit une sauvegarde si la base
    n'a pas été correctement chargée.
    */

    if (!usersLoaded) {

        throw new Error(
            "DATABASE USERS NON CHARGEE - SAUVEGARDE REFUSEE"
        );
    }

    const payload =
        encryptJSON(users);

    const content =
        Buffer
            .from(
                JSON.stringify(
                    payload
                ),
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

    console.log(
        "[USERS] Base sauvegardée"
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

    if (!usersLoaded) {

        return res
            .status(503)
            .json({

                success:
                    false,

                error:
                    "USER DATABASE NOT AVAILABLE"
            });
    }

    const token =
        getTokenFromRequest(req);

    const user =
        getUserFromToken(
            token
        );

    if (!user) {

        return res
            .status(401)
            .json({

                success:
                    false,

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

            chat_log_format:
                "TXT"
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

            users_database:
                usersLoaded,

            websocket:
                clients.size,

            github:
                Boolean(
                    GITHUB_TOKEN
                ),

            chat_log_format:
                "TXT"
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

            if (!usersLoaded) {

                return res
                    .status(503)
                    .json({

                        error:
                            "USER DATABASE NOT AVAILABLE"
                    });
            }

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
                        )
                            .toLowerCase() ===
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
                    new Date()
                        .toISOString()
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

            if (!usersLoaded) {

                return res
                    .status(503)
                    .json({

                        error:
                            "USER DATABASE NOT AVAILABLE"
                    });
            }

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

            const user =
                users.find(
                    u =>
                        String(
                            u.username
                        )
                            .toLowerCase() ===
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
   CURRENT ACCOUNT
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

app.post(
    "/api/account/profile-picture",

    requireAuth,

    async (req, res) => {

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

            if (
                url.length > 2000
            ) {

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
                "[PROFILE PICTURE]",
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
   PROFILE ALIAS
========================================================= */

app.patch(
    "/api/account/profile",

    requireAuth,

    async (req, res) => {

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
);

/* =========================================================
   FILE LIST
========================================================= */

app.get(
    "/api/files/:folder",

    async (req, res) => {

        try {

            const folder =
                req.params.folder;

            const allowed = [
                "image",
                "music",
                "video"
            ];

            if (
                !allowed.includes(
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
                    files.map(
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
                );

            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(
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
                `${Date.now()}-${safeName}`;

            const path =
                `${folder}/${filename}`;

            const content =
                req.file.buffer
                    .toString(
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
   CHAT LOG TXT
========================================================= */

function chatLogPath(number) {

    return (
        "chat-log/" +
        number +
        ".txt"
    );
}


/*
Format d'une ligne :

[2026-08-30T15:55:00.000Z] David (user-id) : Bonjour
*/

function formatChatMessage(message) {

    const timestamp =
        message.timestamp ||
        new Date().toISOString();

    const username =
        String(
            message.username ||
            "Unknown"
        );

    const userId =
        String(
            message.user_id ||
            ""
        );

    const text =
        String(
            message.message ||
            ""
        )
            .replace(
                /\r/g,
                ""
            );

    return (
        `[${timestamp}] ` +
        `${username} ` +
        `(${userId}) : ` +
        `${text}\n`
    );
}


/*
Convertit une ligne TXT en message.
*/

function parseChatLine(line) {

    const match =
        line.match(
            /^\[([^\]]+)\]\s(.+?)\s\(([^)]*)\)\s:\s([\s\S]*)$/
        );

    if (!match) {

        return {

            username:
                "Unknown",

            user_id:
                "",

            profile_picture:
                null,

            message:
                line,

            timestamp:
                null
        };
    }

    return {

        username:
            match[2],

        user_id:
            match[3],

        profile_picture:
            null,

        message:
            match[4],

        timestamp:
            match[1]
    };
}


/*
Lit un fichier TXT.
*/

async function readChatLog(
    number
) {

    const path =
        chatLogPath(
            number
        );

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
            .toString(
                "utf8"
            );

    return decoded
        .split("\n")
        .filter(
            line =>
                line.trim().length > 0
        )
        .map(
            parseChatLine
        );
}


/*
Liste les TXT.
*/

async function getChatLogsList() {

    try {

        const data =
            await githubRequest(
                "chat-log"
            );

        return Array.isArray(data)
            ? data
            : [];

    } catch {

        return [];
    }
}


/* =========================================================
   CHAT LOG API
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
                            /\.txt$/i.test(
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
                            a.name.localeCompare(
                                b.name,
                                undefined,
                                {
                                    numeric:
                                        true
                                }
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
   SAVE CHAT MESSAGE TO TXT
========================================================= */

async function saveChatMessage(
    message
) {

    const files =
        await getChatLogsList();

    const txtFiles =
        files
            .filter(
                file =>
                    /^\d+\.txt$/i.test(
                        file.name ||
                        ""
                    )
            )
            .sort(
                (a, b) =>
                    Number(
                        a.name.replace(
                            ".txt",
                            ""
                        )
                    ) -
                    Number(
                        b.name.replace(
                            ".txt",
                            ""
                        )
                    )
            );

    let number =
        1;

    let content =
        "";

    let currentSha =
        null;

    /*
    Récupère le dernier fichier.
    */

    if (
        txtFiles.length > 0
    ) {

        const last =
            txtFiles[
                txtFiles.length - 1
            ];

        number =
            Number(
                last.name.replace(
                    ".txt",
                    ""
                )
            );

        try {

            const githubFile =
                await githubRequest(
                    last.path
                );

            currentSha =
                githubFile.sha;

            content =
                Buffer
                    .from(
                        githubFile.content,
                        "base64"
                    )
                    .toString(
                        "utf8"
                    );

        } catch (error) {

            console.error(
                "[CHAT LOG READ]",
                error.message
            );

            content =
                "";
        }
    }

    const line =
        formatChatMessage(
            message
        );

    const newContent =
        content +
        line;

    /*
    Si > 15 MB :
    nouveau fichier.
    */

    if (
        Buffer.byteLength(
            newContent,
            "utf8"
        ) > CHAT_LOG_LIMIT
    ) {

        number++;

        content =
            line;

        currentSha =
            null;

    } else {

        content =
            newContent;
    }

    const path =
        chatLogPath(
            number
        );

    /*
    Vérifie le SHA si nécessaire.
    */

    if (!currentSha) {

        try {

            const existing =
                await githubRequest(
                    path
                );

            currentSha =
                existing.sha;

        } catch {

            currentSha =
                null;
        }
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
                .toString(
                    "base64"
                ),

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

    console.log(
        `[CHAT] Message sauvegardé dans ${path}`
    );
}

/* =========================================================
   WEBSOCKET TOKEN
========================================================= */

function getTokenFromWebSocket(
    request
) {

    const url =
        new URL(
            request.url,
            `http://${request.headers.host}`
        );

    const token =
        url.searchParams.get(
            "token"
        );

    return token || null;
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

        if (
            !user ||
            !usersLoaded
        ) {

            try {

                ws.send(
                    JSON.stringify({

                        type:
                            "error",

                        message:
                            "LOGIN REQUIRED"
                    })
                );

            } catch {}

            ws.close(
                1008,
                "LOGIN REQUIRED"
            );

            return;
        }

        ws.authToken =
            token;

        ws.userId =
            user.id;

        clients.add(ws);

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
                    Sauvegarde TXT.
                    */

                    try {

                        await saveChatMessage(
                            chatMessage
                        );

                    } catch (error) {

                        console.error(
                            "[CHAT LOG SAVE]",
                            error
                        );
                    }

                    /*
                    Diffusion.
                    */

                    broadcast({

                        type:
                            "message",

                        data:
                            chatMessage
                    });

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

            } catch {}
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
        "CHAT LOG FORMAT: TXT"
    );

    console.log(
        "CHAT LOG LIMIT: 15 MB"
    );

    console.log(
        "UPLOAD LIMIT: 25 MB"
    );

    console.log(
        "MESSAGE LIMIT: 500"
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
            "Les comptes existants ne seront PAS écrasés."
        );

        console.error(
            "Les fonctions de compte sont temporairement désactivées."
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
                "CHAT LOG TXT READY"
            );

            console.log(
                "================================"
            );
        }
    );
}

start();
