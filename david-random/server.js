"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");

/* =========================================================
   APP
========================================================= */

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
    Number(process.env.PORT) || 10000;

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

const USERS_FILE =
    "accounts/users.enc";

/*
Les logs sont des TXT.
*/

const CHAT_LOG_FOLDER =
    "chat-log";

/* =========================================================
   CONFIG CHECK
========================================================= */

if (!ENCRYPTION_KEY) {

    console.error(
        "ERREUR : ENCRYPTION_KEY est manquante."
    );

    process.exit(1);
}

/*
Clé principale.

32 octets pour AES-256.
*/

const CRYPTO_KEY =
    crypto
        .createHash("sha256")
        .update(String(ENCRYPTION_KEY))
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

        if (
            req.method === "OPTIONS"
        ) {

            return res.sendStatus(204);
        }

        next();
    }
);

/* =========================================================
   MULTER
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

/*
Si la base utilisateurs ne peut pas être chargée,
on interdit register/login pour éviter
d'écraser les comptes.
*/

let usersDatabaseReady =
    false;

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

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN manquant"
        );
    }

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
   BASE64 HELPERS
========================================================= */

function base64UrlToBuffer(value) {

    let text =
        String(value)
            .replace(/-/g, "+")
            .replace(/_/g, "/");

    while (
        text.length % 4 !== 0
    ) {

        text += "=";
    }

    return Buffer.from(
        text,
        "base64"
    );
}


function bufferToBase64Url(buffer) {

    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

/* =========================================================
   AES JSON
========================================================= */

/*
Format moderne :

{
    version: 1,
    iv: "...",
    data: "..."
}

AES-256-CBC
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
        Buffer.from(
            JSON.stringify(value),
            "utf8"
        );

    const encrypted =
        Buffer.concat([
            cipher.update(input),
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
            "FORMAT JSON CHIFFRÉ INVALIDE"
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
            decipher.update(encrypted),
            decipher.final()
        ]);

    return JSON.parse(
        decrypted.toString("utf8")
    );
}

/* =========================================================
   DR1
========================================================= */

/*
Le fichier existant commence par :

DR1:...

On tente plusieurs représentations
afin de pouvoir récupérer une ancienne
base DR1 sans la remplacer.

Formats supportés :

DR1:<JSON AES>

DR1:<base64>

DR1:<base64url>

DR1:<iv>:<data>

DR1:<iv>:<tag>:<data>

AES-256-GCM
AES-256-CBC
*/

/*
DR1 JSON :

DR1:{
    ...
}
*/

function tryDR1JSON(raw) {

    const content =
        raw.slice(4).trim();

    if (!content) {

        throw new Error(
            "DR1 VIDE"
        );
    }

    const payload =
        JSON.parse(content);

    /*
    Cas payload classique :
    {
       version,
       iv,
       data
    }
    */

    if (
        payload &&
        payload.version === 1 &&
        payload.iv &&
        payload.data
    ) {

        return decryptJSON(
            payload
        );
    }

    /*
    Formats GCM possibles.
    */

    if (
        payload &&
        payload.iv &&
        payload.tag &&
        payload.data
    ) {

        return decryptGCM(
            payload.iv,
            payload.tag,
            payload.data
        );
    }

    throw new Error(
        "FORMAT DR1 JSON INVALIDE"
    );
}


function decryptGCM(
    ivValue,
    tagValue,
    dataValue
) {

    const iv =
        Buffer.from(
            ivValue,
            "base64"
        );

    const tag =
        Buffer.from(
            tagValue,
            "base64"
        );

    const encrypted =
        Buffer.from(
            dataValue,
            "base64"
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            CRYPTO_KEY,
            iv
        );

    decipher.setAuthTag(
        tag
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


function decryptDR1Binary(
    raw
) {

    const encoded =
        raw.slice(4).trim();

    if (!encoded) {

        throw new Error(
            "DR1 VIDE"
        );
    }

    /*
    Essai base64url.
    */

    const decoded =
        base64UrlToBuffer(
            encoded
        );

    if (
        decoded.length < 20
    ) {

        throw new Error(
            "DR1 TROP COURT"
        );
    }

    /*
    GCM :
    IV 12 octets
    TAG 16 octets
    reste = données
    */

    if (
        decoded.length > 28
    ) {

        try {

            const iv =
                decoded.subarray(
                    0,
                    12
                );

            const tag =
                decoded.subarray(
                    12,
                    28
                );

            const encrypted =
                decoded.subarray(
                    28
                );

            const decipher =
                crypto.createDecipheriv(
                    "aes-256-gcm",
                    CRYPTO_KEY,
                    iv
                );

            decipher.setAuthTag(
                tag
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

        } catch {}
    }

    /*
    CBC :
    IV 16 octets
    reste = données
    */

    if (
        decoded.length > 32
    ) {

        try {

            const iv =
                decoded.subarray(
                    0,
                    16
                );

            const encrypted =
                decoded.subarray(
                    16
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

        } catch {}
    }

    throw new Error(
        "IMPOSSIBLE DE DÉCHIFFRER DR1"
    );
}


function decryptDR1(raw) {

    /*
    1. DR1 + JSON
    */

    try {

        return tryDR1JSON(
            raw
        );

    } catch {}

    /*
    2. DR1 + données binaires
    */

    try {

        return decryptDR1Binary(
            raw
        );

    } catch {}

    throw new Error(
        "FORMAT DR1 INVALIDE OU ENCRYPTION_KEY INCORRECTE"
    );
}

/* =========================================================
   USERS LOAD
========================================================= */

let users = [];


async function loadUsers() {

    try {

        const data =
            await githubRequest(
                USERS_FILE
            );

        if (!data.content) {

            throw new Error(
                "USERS.ENC VIDE"
            );
        }

        const raw =
            Buffer
                .from(
                    data.content,
                    "base64"
                )
                .toString("utf8")
                .trim();

        console.log(
            "[USERS] Format détecté :",
            raw.slice(0, 20)
        );

        let result;

        /*
        DR1
        */

        if (
            raw.startsWith("DR1:")
        ) {

            result =
                decryptDR1(
                    raw
                );

        }

        /*
        Ancien JSON AES
        */

        else {

            try {

                const payload =
                    JSON.parse(raw);

                result =
                    decryptJSON(
                        payload
                    );

            } catch {

                /*
                Dernier essai :
                contenu base64url.
                */

                throw new Error(
                    "FORMAT USERS.ENC INCONNU"
                );
            }
        }

        if (
            !Array.isArray(result)
        ) {

            /*
            Certaines anciennes bases
            peuvent être :

            {
                users: [...]
            }
            */

            if (
                result &&
                Array.isArray(
                    result.users
                )
            ) {

                result =
                    result.users;

            } else {

                throw new Error(
                    "USERS DATABASE CORRUPTED"
                );
            }
        }

        users =
            result;

        usersDatabaseReady =
            true;

        console.log(
            `[USERS] ${users.length} comptes chargés`
        );

        return true;

    } catch (error) {

        usersDatabaseReady =
            false;

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
   USERS SAVE
========================================================= */

async function saveUsers() {

    if (!usersDatabaseReady) {

        throw new Error(
            "BASE UTILISATEURS NON CHARGÉE - SAUVEGARDE REFUSÉE"
        );
    }

    /*
    Nouveau format sauvegardé :
    DR1:<base64url>
    */

    const encrypted =
        encryptJSON(
            users
        );

    const raw =
        JSON.stringify(
            encrypted
        );

    const content =
        Buffer
            .from(
                "DR1:" +
                bufferToBase64Url(
                    Buffer.from(
                        raw,
                        "utf8"
                    )
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

    } catch {}

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
        sessions.get(
            token
        );

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

        sessions.delete(
            token
        );

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
        getTokenFromRequest(
            req
        );

    const user =
        getUserFromToken(
            token
        );

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

            users_database:
                usersDatabaseReady,

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

            users_database:
                usersDatabaseReady,

            chat_log_format:
                "txt"

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

            if (
                !usersDatabaseReady
            ) {

                return res
                    .status(503)
                    .json({
                        error:
                            "USER DATABASE UNAVAILABLE"
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
                            user.username || ""
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
                    profile || null,

                created_at:
                    new Date().toISOString()

            };

            users.push(
                user
            );

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
                    publicUser(
                        user
                    )

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

            if (
                !usersDatabaseReady
            ) {

                return res
                    .status(503)
                    .json({
                        error:
                            "USER DATABASE UNAVAILABLE"
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
                            u.username || ""
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

            if (
                !user.password_hash
            ) {

                return res
                    .status(500)
                    .json({
                        error:
                            "ACCOUNT FORMAT INVALID"
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
                    publicUser(
                        user
                    )

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
   FILES
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

            const original =
                String(
                    req.file.originalname ||
                    "file"
                );

            const safeName =
                original
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
   CHAT TXT HELPERS
========================================================= */

function chatLogPath(number) {

    return (
        `${CHAT_LOG_FOLDER}/${number}.txt`
    );
}


/*
Liste les TXT du dossier chat-log.
*/

async function getChatLogsList() {

    try {

        const data =
            await githubRequest(
                CHAT_LOG_FOLDER
            );

        return Array.isArray(data)
            ? data
            : [];

    } catch {

        return [];
    }
}


/*
Transforme une ligne TXT en message.

Format utilisé :

[2026-08-30T15:00:00.000Z] username | message
*/

function parseChatLine(line) {

    const match =
        line.match(
            /^\[([^\]]+)\]\s*(.*?)\s*\|\s*(.*)$/
        );

    if (!match) {

        return null;
    }

    const timestamp =
        match[1];

    const username =
        match[2];

    const message =
        match[3];

    return {

        username,

        user_id:
            null,

        profile_picture:
            null,

        message,

        timestamp

    };
}


/*
Lecture d'un TXT.

Le serveur renvoie toujours
des objets JSON à l'API afin que
le HTML n'ait pas besoin de changer.
*/

async function readChatLog(number) {

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
            .toString("utf8");

    const lines =
        decoded.split(
            /\r?\n/
        );

    const messages = [];

    for (
        const line
        of lines
    ) {

        if (
            !line.trim()
        ) {

            continue;
        }

        const message =
            parseChatLine(
                line
            );

        if (message) {

            /*
            On essaie de récupérer
            les infos utilisateur
            depuis la base actuelle.
            */

            const user =
                users.find(
                    u =>
                        String(
                            u.username || ""
                        ).toLowerCase() ===
                        String(
                            message.username
                        ).toLowerCase()
                );

            if (user) {

                message.user_id =
                    user.id;

                message.profile_picture =
                    user.profile_picture ||
                    null;
            }

            messages.push(
                message
            );
        }
    }

    return messages;
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

/* =========================================================
   CHAT LOG READ
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
   CHAT LOG SAVE
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
                        file.name || ""
                    )
            )
            .sort(
                (a, b) =>
                    Number(
                        a.name.replace(
                            /\.txt$/i,
                            ""
                        )
                    ) -
                    Number(
                        b.name.replace(
                            /\.txt$/i,
                            ""
                        )
                    )
            );

    let number =
        1;

    let currentText =
        "";

    let currentSha =
        null;

    /*
    Récupération du dernier fichier.
    */

    if (
        txtFiles.length
    ) {

        const last =
            txtFiles[
                txtFiles.length - 1
            ];

        number =
            Number(
                last.name.replace(
                    /\.txt$/i,
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

            if (
                githubFile.content
            ) {

                currentText =
                    Buffer
                        .from(
                            githubFile.content,
                            "base64"
                        )
                        .toString(
                            "utf8"
                        );
            }

        } catch (error) {

            console.error(
                "[CHAT LOG READ BEFORE SAVE]",
                error.message
            );

            currentText =
                "";
        }
    }

    /*
    Ligne du nouveau message.
    */

    const safeUsername =
        String(
            message.username || "Unknown"
        )
            .replace(
                /[\r\n|]/g,
                " "
            );

    const safeMessage =
        String(
            message.message || ""
        )
            .replace(
                /\r/g,
                ""
            )
            .replace(
                /\n/g,
                "\\n"
            );

    const line =
        `[${message.timestamp}] ${safeUsername} | ${safeMessage}\n`;

    const newText =
        currentText +
        line;

    /*
    Si le TXT dépasse 15 MB,
    nouveau fichier.
    */

    if (
        Buffer.byteLength(
            newText,
            "utf8"
        ) > CHAT_LOG_LIMIT
    ) {

        number++;

        currentText =
            "";

        currentSha =
            null;
    }

    const finalText =
        currentText +
        line;

    const path =
        chatLogPath(
            number
        );

    /*
    Si le nouveau fichier existe déjà,
    récupérer son SHA.
    */

    if (
        !currentSha
    ) {

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
                    finalText,
                    "utf8"
                )
                .toString(
                    "base64"
                ),

        branch:
            GITHUB_BRANCH

    };

    if (
        currentSha
    ) {

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
                JSON.stringify(
                    body
                )

        }
    );
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
                    Sauvegarde TXT GitHub.
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
                    Broadcast.
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
            "Les comptes sont désactivés."
        );

        console.error(
            "AUCUNE base vide ne sera créée."
        );

        console.error(
            "Vérifie ENCRYPTION_KEY."
        );

        console.error(
            "================================"
        );

    } else {

        console.log(
            "================================"
        );

        console.log(
            "USER DATABASE READY"
        );

        console.log(
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
