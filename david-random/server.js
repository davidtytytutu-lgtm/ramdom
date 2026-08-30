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
        "[FATAL] ENCRYPTION_KEY est manquante."
    );

    process.exit(1);
}

if (!GITHUB_TOKEN) {

    console.error(
        "[WARNING] GITHUB_TOKEN est manquante."
    );

    console.error(
        "[WARNING] Les fonctions GitHub ne fonctionneront pas."
    );
}

/*
AES-256
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

/* =========================================================
   GITHUB
========================================================= */

function githubApiUrl(path = "") {

    const cleanPath =
        String(path)
            .replace(/^\/+/, "");

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/contents/" +
        cleanPath
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

    if (text) {

        try {

            data =
                JSON.parse(text);

        } catch {

            throw new Error(
                "Réponse GitHub invalide"
            );
        }
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

/*
Nouveau format :

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
   ANCIEN FORMAT DR1
========================================================= */

/*
Ton fichier users.enc actuel commence par :

DR1:w43QZZ...

Le serveur essaye maintenant plusieurs formats.

IMPORTANT :

Le format DR1 doit être déchiffrable avec ENCRYPTION_KEY.

Si la clé Render n'est pas la même que celle utilisée
pour créer users.enc, aucun serveur ne pourra récupérer
les anciens comptes.
*/

function decryptDR1(content) {

    content =
        String(content)
            .trim();

    if (
        !content.startsWith("DR1:")
    ) {

        throw new Error(
            "Ce fichier n'est pas au format DR1"
        );
    }

    /*
    Format supposé :

    DR1:<iv>:<data>

    */

    const parts =
        content.split(":");

    if (
        parts.length !== 3
    ) {

        throw new Error(
            "FORMAT DR1 INVALIDE"
        );
    }

    const ivText =
        parts[1];

    const dataText =
        parts[2];

    /*
    Essaie base64.
    */

    let iv;

    let encrypted;

    try {

        iv =
            Buffer.from(
                ivText,
                "base64"
            );

        encrypted =
            Buffer.from(
                dataText,
                "base64"
            );

    } catch {

        throw new Error(
            "DR1 BASE64 INVALIDE"
        );
    }

    if (
        iv.length !== 16
    ) {

        throw new Error(
            "IV DR1 INVALIDE"
        );
    }

    if (
        encrypted.length === 0
    ) {

        throw new Error(
            "DATA DR1 VIDE"
        );
    }

    /*
    AES-256-CBC
    */

    try {

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
            decrypted.toString(
                "utf8"
            )
        );

    } catch (error) {

        throw new Error(
            "Impossible de déchiffrer DR1 avec ENCRYPTION_KEY"
        );
    }
}

/* =========================================================
   UNIVERSAL USERS DECODER
========================================================= */

function decodeUsersFile(
    raw
) {

    let content =
        String(raw)
            .trim();

    if (!content) {

        throw new Error(
            "USERS.ENC VIDE"
        );
    }

    /*
    ---------------------------------------------------------
    FORMAT 1 : DR1
    ---------------------------------------------------------
    */

    if (
        content.startsWith("DR1:")
    ) {

        const decoded =
            decryptDR1(
                content
            );

        if (
            !Array.isArray(decoded)
        ) {

            throw new Error(
                "DR1 USERS DATABASE INVALIDE"
            );
        }

        return decoded;
    }

    /*
    ---------------------------------------------------------
    FORMAT 2 : JSON AES
    ---------------------------------------------------------
    */

    try {

        const payload =
            JSON.parse(
                content
            );

        if (
            payload &&
            payload.version === 1 &&
            payload.iv &&
            payload.data
        ) {

            const decoded =
                decryptJSON(
                    payload
                );

            if (
                !Array.isArray(decoded)
            ) {

                throw new Error(
                    "DATABASE USERS INVALIDE"
                );
            }

            return decoded;
        }

        /*
        JSON non chiffré.
        Utile pour récupérer une ancienne base.
        */

        if (
            Array.isArray(payload)
        ) {

            console.warn(
                "[USERS] Base JSON non chiffrée détectée."
            );

            return payload;
        }

    } catch (error) {

        /*
        On continue vers les autres formats.
        */
    }

    /*
    ---------------------------------------------------------
    FORMAT 3 : base64 contenant du JSON
    ---------------------------------------------------------
    */

    try {

        const decoded =
            Buffer
                .from(
                    content,
                    "base64"
                )
                .toString(
                    "utf8"
                );

        const parsed =
            JSON.parse(
                decoded
            );

        if (
            Array.isArray(parsed)
        ) {

            return parsed;
        }

        if (
            parsed &&
            parsed.version === 1
        ) {

            const decrypted =
                decryptJSON(
                    parsed
                );

            if (
                Array.isArray(
                    decrypted
                )
            ) {

                return decrypted;
            }
        }

    } catch {}

    throw new Error(
        "FORMAT USERS.ENC INCONNU OU CORROMPU"
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

        if (
            !data.content
        ) {

            throw new Error(
                "USERS DATABASE VIDE"
            );
        }

        const raw =
            Buffer
                .from(
                    data.content,
                    "base64"
                )
                .toString(
                    "utf8"
                );

        console.log(
            "[USERS] Format détecté :",
            raw.substring(
                0,
                20
            )
        );

        users =
            decodeUsersFile(
                raw
            );

        if (
            !Array.isArray(users)
        ) {

            throw new Error(
                "USERS DATABASE INVALID"
            );
        }

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

        return false;
    }
}

/* =========================================================
   SAVE USERS
========================================================= */

async function saveUsers() {

    if (
        !usersLoaded
    ) {

        throw new Error(
            "Impossible de sauvegarder : database users non chargée"
        );
    }

    const payload =
        encryptJSON(
            users
        );

    const content =
        Buffer
            .from(
                JSON.stringify(
                    payload
                ),
                "utf8"
            )
            .toString(
                "base64"
            );

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

    if (
        sha
    ) {

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
                JSON.stringify(
                    body
                )
        }
    );

    console.log(
        "[USERS] Database sauvegardée"
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

function publicUser(
    user
) {

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

function getTokenFromRequest(
    req
) {

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
            .startsWith(
                "bearer "
            )
    ) {

        return null;
    }

    return header
        .slice(7)
        .trim() || null;
}

function getUserFromToken(
    token
) {

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

    if (
        !usersLoaded
    ) {

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

            users_loaded:
                usersLoaded,

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

            users_loaded:
                usersLoaded,

            websocket:
                clients.size,

            github:
                Boolean(
                    GITHUB_TOKEN
                )

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
                !usersLoaded
            ) {

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
                            user.username ||
                            ""
                        )
                            .toLowerCase() ===
                        username.toLowerCase()
                );

            if (
                exists
            ) {

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
                    new Date()
                        .toISOString()
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
                !usersLoaded
            ) {

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
                            u.username ||
                            ""
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
                    .status(401)
                    .json({
                        error:
                            "ACCOUNT PASSWORD INVALID"
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

            if (
                !req.file
            ) {

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
   CHAT LOG HELPERS
========================================================= */

function chatLogPath(
    number
) {

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

    } catch {

        return [];
    }
}

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

    if (
        !data.content
    ) {

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

    const json =
        JSON.parse(
            decoded
        );

    if (
        Array.isArray(json)
    ) {

        return json;
    }

    if (
        Array.isArray(
            json.messages
        )
    ) {

        return json.messages;
    }

    return [];
}

/* =========================================================
   CHAT LOG LIST
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
                            /\.json$/i.test(
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

    if (
        jsonFiles.length
    ) {

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

        } catch {

            messages =
                [];
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

    /*
    15 MB maximum.
    */

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

    /*
    Vérification supplémentaire.
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
                    content,
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

    const url =
        new URL(
            request.url,
            `http://${request.headers.host}`
        );

    const token =
        url.searchParams.get(
            "token"
        );

    return token ||
        null;
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
            !user
        ) {

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

                    if (
                        !current
                    ) {

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

                    if (
                        !message
                    ) {

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
                    Sauvegarde GitHub.
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

function broadcast(
    data
) {

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
        "CHAT LOG LIMIT:",
        "15 MB"
    );

    console.log(
        "UPLOAD LIMIT:",
        "25 MB"
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

    if (
        !loaded
    ) {

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
            `${users.length} comptes disponibles`
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

        }
    );
}

start();
