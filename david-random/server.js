// ============================================================
// DAVID RANDOM V2 - SERVER
// Render + GitHub Storage + WebSocket + Accounts + Chat Logs
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// ============================================================
// CONFIG
// ============================================================

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

const GITHUB_OWNER =
    process.env.GITHUB_OWNER || "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO || "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH || "main";

const GITHUB_TOKEN =
    process.env.GITHUB_TOKEN || "";

const ACCOUNTS_ENCRYPTION_KEY =
    process.env.ACCOUNTS_ENCRYPTION_KEY || "";

const MAX_UPLOAD_SIZE =
    25 * 1024 * 1024;

const MAX_MESSAGE_LENGTH =
    500;

const CHAT_LOG_LIMIT =
    15 * 1024 * 1024;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({
    limit: "35mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "35mb"
}));

// ============================================================
// MEMORY
// ============================================================

const accounts = new Map();
const sessions = new Map();

let visitors = 1337;

let chatLogCache = [];
let chatLogLoaded = false;

let accountsLoaded = false;

let accountsSaveQueue = Promise.resolve();

// ============================================================
// GITHUB HELPERS
// ============================================================

function githubHeaders() {

    const headers = {
        "Accept":
            "application/vnd.github+json",

        "X-GitHub-Api-Version":
            "2022-11-28",

        "User-Agent":
            "David-Random-V2"
    };

    if (GITHUB_TOKEN) {

        headers.Authorization =
            `Bearer ${GITHUB_TOKEN}`;

    }

    return headers;
}


// ============================================================
// GITHUB URL
// ============================================================

function githubApiUrl(apiPath) {

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        apiPath
    );

}


// ============================================================
// GITHUB REQUEST
// ============================================================

async function githubRequest(
    apiPath,
    options = {}
) {

    const response =
        await fetch(
            githubApiUrl(apiPath),
            {
                ...options,

                headers: {
                    ...githubHeaders(),
                    ...(options.headers || {})
                }
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    }
    catch {

        data = null;

    }

    if (!response.ok) {

        const error =
            new Error(
                data?.message ||
                `GitHub HTTP ${response.status}`
            );

        error.status =
            response.status;

        error.github =
            data;

        throw error;

    }

    return data;

}


// ============================================================
// GITHUB LIST FOLDER
// ============================================================

async function githubListFolder(folder) {

    const cleanFolder =
        String(folder || "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");

    return githubRequest(
        `/contents/${cleanFolder
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(GITHUB_BRANCH)}`
    );

}


// ============================================================
// GITHUB READ FILE
// ============================================================

async function githubReadFile(filePath) {

    const cleanPath =
        String(filePath || "")
            .replace(/^\/+/, "");

    const data =
        await githubRequest(
            `/contents/${cleanPath
                .split("/")
                .map(encodeURIComponent)
                .join("/")}?ref=${encodeURIComponent(GITHUB_BRANCH)}`
        );

    if (!data || !data.content) {

        throw new Error(
            "Fichier GitHub sans contenu."
        );

    }

    return Buffer
        .from(
            data.content.replace(/\n/g, ""),
            "base64"
        )
        .toString("utf8");

}


// ============================================================
// GITHUB GET FILE INFO
// ============================================================

async function githubGetFile(filePath) {

    const cleanPath =
        String(filePath || "")
            .replace(/^\/+/, "");

    return githubRequest(
        `/contents/${cleanPath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(GITHUB_BRANCH)}`
    );

}


// ============================================================
// GITHUB WRITE FILE
// ============================================================

async function githubWriteFile(
    filePath,
    content,
    message
) {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN n'est pas configuré sur Render."
        );

    }

    const cleanPath =
        String(filePath || "")
            .replace(/^\/+/, "");

    let sha = null;

    try {

        const existing =
            await githubGetFile(
                cleanPath
            );

        sha =
            existing.sha || null;

    }
    catch (error) {

        if (error.status !== 404) {

            throw error;

        }

    }

    const body = {

        message:
            message ||
            "David Random update",

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

    if (sha) {

        body.sha =
            sha;

    }

    return githubRequest(
        `/contents/${cleanPath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
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


// ============================================================
// GITHUB WRITE BUFFER
// ============================================================

async function githubWriteBuffer(
    filePath,
    buffer,
    message
) {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN n'est pas configuré."
        );

    }

    const cleanPath =
        String(filePath || "")
            .replace(/^\/+/, "");

    let sha = null;

    try {

        const existing =
            await githubGetFile(
                cleanPath
            );

        sha =
            existing.sha || null;

    }
    catch (error) {

        if (error.status !== 404) {

            throw error;

        }

    }

    const body = {

        message:
            message ||
            "David Random file upload",

        content:
            buffer.toString("base64"),

        branch:
            GITHUB_BRANCH

    };

    if (sha) {

        body.sha =
            sha;

    }

    return githubRequest(
        `/contents/${cleanPath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
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


// ============================================================
// RANDOM ID
// ============================================================

function randomId(length = 16) {

    return crypto
        .randomBytes(length)
        .toString("hex");

}


// ============================================================
// PASSWORD HASH
// ============================================================

function hashPassword(password) {

    return crypto
        .createHash("sha256")
        .update(
            String(password),
            "utf8"
        )
        .digest("hex");

}


// ============================================================
// SESSION TOKEN
// ============================================================

function createSession(user) {

    const token =
        crypto
            .randomBytes(32)
            .toString("hex");

    sessions.set(
        token,
        {
            userId:
                user.id,

            createdAt:
                Date.now()
        }
    );

    return token;

}


// ============================================================
// AUTH
// ============================================================

function getTokenFromRequest(req) {

    const auth =
        req.headers.authorization || "";

    if (
        auth.startsWith("Bearer ")
    ) {

        return auth
            .slice(7)
            .trim();

    }

    return null;

}


// ============================================================
// GET USER FROM TOKEN
// ============================================================

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
        accounts.get(
            session.userId
        );

    return user || null;

}


// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function authMiddleware(
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
                    "AUTHENTICATION REQUIRED"
            });

    }

    req.user =
        user;

    req.token =
        token;

    next();

}


// ============================================================
// PUBLIC USER
// ============================================================

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
            user.profile_picture || null

    };

}


// ============================================================
// ============================================================
// ACCOUNTS ENCRYPTION
// ============================================================
// Format:
// DR1:version:iv:authTag:encryptedData
// ============================================================

const ACCOUNTS_FILE =
    "accounts/users.enc";

const ACCOUNTS_JSON_FILE =
    "accounts.json";


// ============================================================
// DERIVE ENCRYPTION KEY
// ============================================================

function getAccountsEncryptionKey() {

    if (!ACCOUNTS_ENCRYPTION_KEY) {

        throw new Error(
            "ACCOUNTS_ENCRYPTION_KEY n'est pas configurée sur Render."
        );

    }

    /*
       SHA-256 permet de transformer la clé
       Render en clé AES-256 de 32 octets.
    */

    return crypto
        .createHash("sha256")
        .update(
            ACCOUNTS_ENCRYPTION_KEY,
            "utf8"
        )
        .digest();

}


// ============================================================
// ENCRYPT ACCOUNTS
// ============================================================

function encryptAccounts(users) {

    const key =
        getAccountsEncryptionKey();

    const iv =
        crypto.randomBytes(12);

    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    const plaintext =
        JSON.stringify({
            version:
                1,

            users
        });

    const encrypted =
        Buffer.concat([
            cipher.update(
                plaintext,
                "utf8"
            ),
            cipher.final()
        ]);

    const authTag =
        cipher.getAuthTag();

    return [
        "DR1",

        "1",

        iv.toString("base64url"),

        authTag.toString("base64url"),

        encrypted.toString("base64url")

    ].join(":");

}


// ============================================================
// DECRYPT ACCOUNTS
// ============================================================

function decryptAccounts(text) {

    const parts =
        String(text || "")
            .trim()
            .split(":");

    if (
        parts.length !== 5
    ) {

        throw new Error(
            "Format users.enc invalide."
        );

    }

    const [
        magic,
        version,
        ivText,
        authTagText,
        encryptedText
    ] =
        parts;

    if (
        magic !== "DR1"
    ) {

        throw new Error(
            "Format users.enc inconnu."
        );

    }

    if (
        version !== "1"
    ) {

        throw new Error(
            "Version users.enc non supportée."
        );

    }

    const key =
        getAccountsEncryptionKey();

    const iv =
        Buffer.from(
            ivText,
            "base64url"
        );

    const authTag =
        Buffer.from(
            authTagText,
            "base64url"
        );

    const encrypted =
        Buffer.from(
            encryptedText,
            "base64url"
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    decipher.setAuthTag(
        authTag
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


// ============================================================
// SAVE ACCOUNTS
// ============================================================

async function saveAccountsToGitHub() {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN n'est pas configuré."
        );

    }

    if (!ACCOUNTS_ENCRYPTION_KEY) {

        throw new Error(
            "ACCOUNTS_ENCRYPTION_KEY n'est pas configurée."
        );

    }

    const users =
        Array.from(
            accounts.values()
        );

    /*
       users.enc
    */

    const encrypted =
        encryptAccounts(
            users
        );

    /*
       accounts.json contient uniquement
       des informations publiques.
       Aucun mot de passe.
    */

    const accountsJson = {

        version:
            2,

        format:
            "DR1",

        encrypted:
            true,

        count:
            users.length,

        updatedAt:
            new Date().toISOString(),

        users:
            users.map(
                user => ({
                    id:
                        user.id,

                    username:
                        user.username,

                    profile_picture:
                        user.profile_picture ||
                        null,

                    createdAt:
                        user.createdAt ||
                        null
                })
            )

    };

    /*
       On sauvegarde users.enc puis accounts.json.
    */

    await githubWriteFile(
        ACCOUNTS_FILE,
        encrypted,
        "Update encrypted accounts"
    );

    await githubWriteFile(
        ACCOUNTS_JSON_FILE,
        JSON.stringify(
            accountsJson,
            null,
            2
        ),
        "Update accounts metadata"
    );

}


// ============================================================
// QUEUED ACCOUNT SAVE
// ============================================================

function queueAccountsSave() {

    accountsSaveQueue =
        accountsSaveQueue
            .then(
                () =>
                    saveAccountsToGitHub()
            )
            .catch(
                error => {

                    console.error(
                        "[ACCOUNTS SAVE]",
                        error
                    );

                }
            );

    return accountsSaveQueue;

}


// ============================================================
// LOAD ACCOUNTS
// ============================================================

async function loadAccounts() {

    if (accountsLoaded) {

        return;

    }

    accounts.clear();

    /*
       Vérification de la clé.
    */

    if (!ACCOUNTS_ENCRYPTION_KEY) {

        console.error(
            "[ACCOUNTS] ACCOUNTS_ENCRYPTION_KEY absente."
        );

        console.error(
            "[ACCOUNTS] Les comptes ne peuvent pas être chargés."
        );

        accountsLoaded =
            true;

        return;

    }

    try {

        const encrypted =
            await githubReadFile(
                ACCOUNTS_FILE
            );

        const decoded =
            decryptAccounts(
                encrypted
            );

        const users =
            Array.isArray(
                decoded?.users
            )
                ? decoded.users
                : [];

        for (
            const user
            of users
        ) {

            if (
                !user ||
                !user.id ||
                !user.username ||
                !user.password
            ) {

                continue;

            }

            accounts.set(
                user.id,
                {
                    id:
                        user.id,

                    username:
                        user.username,

                    password:
                        user.password,

                    profile_picture:
                        user.profile_picture ||
                        null,

                    createdAt:
                        user.createdAt ||
                        null
                }
            );

        }

        console.log(
            `[ACCOUNTS] ${accounts.size} compte(s) chargé(s) depuis GitHub.`
        );

    }
    catch (error) {

        if (
            error.status === 404
        ) {

            console.log(
                "[ACCOUNTS] users.enc n'existe pas encore."
            );

            console.log(
                "[ACCOUNTS] Il sera créé à la première inscription."
            );

        }
        else {

            console.error(
                "[ACCOUNTS] Impossible de charger users.enc:"
            );

            console.error(
                error.message
            );

            /*
               Si l'ancien users.enc est encore présent
               mais utilise l'ancien format, on ne le détruit pas
               automatiquement.
            */

        }

    }

    accountsLoaded =
        true;

}


// ============================================================
// STATUS
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            name:
                "DAVID RANDOM",

            version:
                "2.0",

            online:
                true,

            server:
                "Render",

            storage:
                "GitHub",

            websocket:
                true

        });

    }
);


// ============================================================
// API STATUS
// ============================================================

app.get(
    "/api/status",
    async (req, res) => {

        res.json({

            success:
                true,

            online:
                true,

            service:
                "DAVID RANDOM V2",

            server:
                "Render",

            github:
                Boolean(
                    GITHUB_TOKEN
                ),

            accounts:
                accounts.size,

            accounts_storage:
                "accounts/users.enc",

            websocket:
                true,

            visitors

        });

    }
);


// ============================================================
// VISITORS
// ============================================================

app.get(
    "/api/visitors",
    (req, res) => {

        res.json({

            success:
                true,

            visitors

        });

    }
);


// ============================================================
// ACCOUNT REGISTER
// ============================================================

app.post(
    "/api/account/register",
    async (req, res) => {

        try {

            await loadAccounts();

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const password =
                String(
                    req.body.password || ""
                );

            const profilePicture =
                req.body.profile_picture ||
                null;

            if (
                !username ||
                !password
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "USERNAME AND PASSWORD REQUIRED"

                    });

            }

            if (
                username.length < 3 ||
                username.length > 24
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "USERNAME MUST BE 3-24 CHARACTERS"

                    });

            }

            if (
                password.length < 4
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "PASSWORD TOO SHORT"

                    });

            }

            const usernameKey =
                username.toLowerCase();

            for (
                const user
                of accounts.values()
            ) {

                if (
                    user.username
                        .toLowerCase() ===
                    usernameKey
                ) {

                    return res
                        .status(409)
                        .json({

                            success:
                                false,

                            error:
                                "USERNAME ALREADY EXISTS"

                        });

                }

            }

            const user = {

                id:
                    randomId(8),

                username,

                password:
                    hashPassword(
                        password
                    ),

                profile_picture:
                    profilePicture,

                createdAt:
                    new Date().toISOString()

            };

            accounts.set(
                user.id,
                user
            );

            /*
               Sauvegarde immédiate sur GitHub.
            */

            try {

                await saveAccountsToGitHub();

            }
            catch (saveError) {

                /*
                   Si GitHub échoue, on retire le compte
                   de la mémoire afin de ne pas créer
                   un compte qui disparaîtrait au prochain
                   redémarrage.
                */

                accounts.delete(
                    user.id
                );

                throw saveError;

            }

            const token =
                createSession(
                    user
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

        }
        catch (error) {

            console.error(
                "[REGISTER]",
                error
            );

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        "REGISTRATION ERROR"

                });

        }

    }
);


// ============================================================
// ACCOUNT LOGIN
// ============================================================

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            await loadAccounts();

            const username =
                String(
                    req.body.username || ""
                ).trim();

            const password =
                String(
                    req.body.password || ""
                );

            let foundUser =
                null;

            for (
                const user
                of accounts.values()
            ) {

                if (
                    user.username
                        .toLowerCase() ===
                    username.toLowerCase()
                ) {

                    foundUser =
                        user;

                    break;

                }

            }

            if (!foundUser) {

                return res
                    .status(401)
                    .json({

                        success:
                            false,

                        error:
                            "INVALID USERNAME OR PASSWORD"

                    });

            }

            const passwordHash =
                hashPassword(
                    password
                );

            if (
                foundUser.password !==
                passwordHash
            ) {

                return res
                    .status(401)
                    .json({

                        success:
                            false,

                        error:
                            "INVALID USERNAME OR PASSWORD"

                    });

            }

            const token =
                createSession(
                    foundUser
                );

            res.json({

                success:
                    true,

                token,

                user:
                    publicUser(
                        foundUser
                    )

            });

        }
        catch (error) {

            console.error(
                "[LOGIN]",
                error
            );

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        "LOGIN ERROR"

                });

        }

    }
);


// ============================================================
// ACCOUNT ME
// ============================================================

app.get(
    "/api/account/me",
    authMiddleware,
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


// ============================================================
// ACCOUNT LOGOUT
// ============================================================

app.post(
    "/api/account/logout",
    authMiddleware,
    (req, res) => {

        sessions.delete(
            req.token
        );

        res.json({

            success:
                true

        });

    }
);


// ============================================================
// FILE EXTENSIONS
// ============================================================

function getAllowedExtensions(
    folder
) {

    if (
        folder === "image"
    ) {

        return [

            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".webp",
            ".bmp",
            ".svg"

        ];

    }

    if (
        folder === "music"
    ) {

        return [

            ".mp3",
            ".wav",
            ".ogg",
            ".flac",
            ".m4a",
            ".aac"

        ];

    }

    if (
        folder === "video"
    ) {

        return [

            ".mp4",
            ".webm",
            ".mov",
            ".avi",
            ".mkv"

        ];

    }

    return [];

}


// ============================================================
// MEDIA URL
// ============================================================

function githubRawUrl(
    folder,
    filename
) {

    return (
        "https://raw.githubusercontent.com/" +
        encodeURIComponent(
            GITHUB_OWNER
        ) +
        "/" +
        encodeURIComponent(
            GITHUB_REPO
        ) +
        "/" +
        encodeURIComponent(
            GITHUB_BRANCH
        ) +
        "/" +
        folder +
        "/" +
        filename
            .split("/")
            .map(
                encodeURIComponent
            )
            .join("/")
    );

}


// ============================================================
// LIST MEDIA
// ============================================================

app.get(
    "/api/files/:folder",
    async (req, res) => {

        const folder =
            String(
                req.params.folder || ""
            ).toLowerCase();

        if (
            ![
                "image",
                "music",
                "video"
            ].includes(folder)
        ) {

            return res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        "DOSSIER MEDIA INVALIDE"

                });

        }

        try {

            const entries =
                await githubListFolder(
                    folder
                );

            const allowed =
                getAllowedExtensions(
                    folder
                );

            const files =
                Array.isArray(
                    entries
                )
                    ? entries
                        .filter(
                            item => {

                                if (
                                    item.type !==
                                    "file"
                                ) {

                                    return false;

                                }

                                if (
                                    item.name
                                        .toLowerCase()
                                        .endsWith(
                                            ".gitkeep"
                                        )
                                ) {

                                    return false;

                                }

                                return allowed
                                    .includes(
                                        path.extname(
                                            item.name
                                        ).toLowerCase()
                                    );

                            }
                        )
                        .map(
                            item => ({

                                name:
                                    item.name,

                                path:
                                    item.path,

                                size:
                                    item.size || 0,

                                download:
                                    githubRawUrl(
                                        folder,
                                        item.name
                                    )

                            })
                        )
                    : [];

            res.json({

                success:
                    true,

                folder,

                files

            });

        }
        catch (error) {

            console.error(
                `[FILES/${folder}]`,
                error
            );

            res
                .status(
                    error.status === 404
                        ? 404
                        : 500
                )
                .json({

                    success:
                        false,

                    error:
                        error.status === 404
                            ? "DOSSIER INTROUVABLE"
                            : error.message

                });

        }

    }
);


// ============================================================
// UPLOAD MEDIA
// ============================================================

app.post(
    "/api/upload",
    authMiddleware,
    async (req, res) => {

        try {

            const filename =
                String(
                    req.body.filename || ""
                ).trim();

            const content =
                String(
                    req.body.content || ""
                );

            const folder =
                String(
                    req.body.folder || ""
                ).toLowerCase();

            if (
                !filename ||
                !content ||
                !folder
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "FILENAME, CONTENT AND FOLDER REQUIRED"

                    });

            }

            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(folder)
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "INVALID MEDIA FOLDER"

                    });

            }

            const extension =
                path.extname(
                    filename
                ).toLowerCase();

            if (
                !getAllowedExtensions(
                    folder
                ).includes(
                    extension
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "FILE TYPE NOT ALLOWED"

                    });

            }

            let base64 =
                content;

            if (
                base64.includes(",")
            ) {

                base64 =
                    base64.split(",")[1];

            }

            const buffer =
                Buffer.from(
                    base64,
                    "base64"
                );

            if (
                buffer.length >
                MAX_UPLOAD_SIZE
            ) {

                return res
                    .status(413)
                    .json({

                        success:
                            false,

                        error:
                            "FILE TOO LARGE. MAXIMUM 25 MB."

                    });

            }

            const safeFilename =
                path.basename(
                    filename
                )
                .replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

            const githubPath =
                `${folder}/${safeFilename}`;

            const result =
                await githubWriteBuffer(
                    githubPath,
                    buffer,
                    `Upload ${folder}/${safeFilename} by ${req.user.username}`
                );

            const download =
                githubRawUrl(
                    folder,
                    safeFilename
                );

            res.json({

                success:
                    true,

                filename:
                    safeFilename,

                folder,

                download,

                github:
                    result.content?.html_url ||
                    null

            });

        }
        catch (error) {

            console.error(
                "[UPLOAD]",
                error
            );

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message ||
                        "UPLOAD ERROR"

                });

        }

    }
);


// ============================================================
// CHAT LOG HELPERS
// ============================================================

function chatLogFilename(
    number
) {

    return (
        "chat-log/chat-log" +
        String(number)
            .padStart(3, "0") +
        ".json"
    );

}


function calculateChatLogSize(
    messages
) {

    return Buffer
        .byteLength(
            JSON.stringify(
                messages,
                null,
                2
            ),
            "utf8"
        );

}


// ============================================================
// FIND CHAT LOG FILES
// ============================================================

async function getChatLogFiles() {

    try {

        const entries =
            await githubListFolder(
                "chat-log"
            );

        return Array.isArray(
            entries
        )
            ? entries
                .filter(
                    item =>
                        item.type === "file" &&
                        /^chat-log\d+\.json$/i
                            .test(
                                item.name
                            )
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
                )
            : [];

    }
    catch (error) {

        if (
            error.status === 404
        ) {

            return [];

        }

        throw error;

    }

}


// ============================================================
// LOAD CHAT LOGS
// ============================================================

async function loadChatLogs() {

    if (
        chatLogLoaded
    ) {

        return chatLogCache;

    }

    chatLogCache =
        [];

    try {

        const files =
            await getChatLogFiles();

        for (
            const file
            of files
        ) {

            try {

                const text =
                    await githubReadFile(
                        file.path
                    );

                const parsed =
                    JSON.parse(
                        text
                    );

                if (
                    Array.isArray(
                        parsed
                    )
                ) {

                    chatLogCache.push(
                        ...parsed
                    );

                }
                else if (
                    Array.isArray(
                        parsed.messages
                    )
                ) {

                    chatLogCache.push(
                        ...parsed.messages
                    );

                }

            }
            catch (error) {

                console.warn(
                    "[CHAT LOG] Impossible de lire",
                    file.name,
                    error.message
                );

            }

        }

    }
    catch (error) {

        console.warn(
            "[CHAT LOG] Chargement impossible:",
            error.message
        );

    }

    if (
        chatLogCache.length >
        1000
    ) {

        chatLogCache =
            chatLogCache.slice(
                -1000
            );

    }

    chatLogLoaded =
        true;

    return chatLogCache;

}


// ============================================================
// GET NEXT CHAT LOG NUMBER
// ============================================================

async function getNextChatLogNumber() {

    const files =
        await getChatLogFiles();

    let max =
        0;

    for (
        const file
        of files
    ) {

        const match =
            file.name.match(
                /^chat-log(\d+)\.json$/i
            );

        if (match) {

            max =
                Math.max(
                    max,
                    Number(
                        match[1]
                    )
                );

        }

    }

    return max + 1;

}


// ============================================================
// SAVE CHAT MESSAGE
// ============================================================

async function saveChatMessage(
    message
) {

    chatLogCache.push(
        message
    );

    if (
        chatLogCache.length >
        1000
    ) {

        chatLogCache =
            chatLogCache.slice(
                -1000
            );

    }

    const size =
        calculateChatLogSize(
            chatLogCache
        );

    if (
        size >
        CHAT_LOG_LIMIT
    ) {

        const previousMessages =
            chatLogCache.slice(
                0,
                Math.max(
                    1,
                    Math.floor(
                        chatLogCache.length /
                        2
                    )
                )
            );

        const remainingMessages =
            chatLogCache.slice(
                previousMessages.length
            );

        const number =
            await getNextChatLogNumber();

        await githubWriteFile(
            chatLogFilename(
                number
            ),
            JSON.stringify(
                previousMessages,
                null,
                2
            ),
            `Create chat log ${number}`
        );

        chatLogCache =
            remainingMessages;

    }

    const files =
        await getChatLogFiles();

    let number =
        1;

    if (
        files.length > 0
    ) {

        const last =
            files[
                files.length - 1
            ];

        const match =
            last.name.match(
                /^chat-log(\d+)\.json$/i
            );

        if (match) {

            number =
                Number(
                    match[1]
                );

        }

    }

    await githubWriteFile(
        chatLogFilename(
            number
        ),
        JSON.stringify(
            chatLogCache,
            null,
            2
        ),
        `Update chat log ${number}`
    );

}


// ============================================================
// CHAT HISTORY
// ============================================================

app.get(
    "/api/chat/history",
    async (req, res) => {

        try {

            const messages =
                await loadChatLogs();

            res.json({

                success:
                    true,

                messages:
                    messages.slice(
                        -200
                    )

            });

        }
        catch (error) {

            console.error(
                "[CHAT HISTORY]",
                error
            );

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


// ============================================================
// CHAT LOG LIST
// ============================================================

app.get(
    "/api/chat/logs",
    async (req, res) => {

        try {

            const files =
                await getChatLogFiles();

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

                            size:
                                file.size || 0,

                            download:
                                githubRawUrl(
                                    "chat-log",
                                    file.name
                                )

                        })
                    )

            });

        }
        catch (error) {

            console.error(
                "[CHAT LOGS]",
                error
            );

            res
                .status(500)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


// ============================================================
// READ CHAT LOG
// ============================================================

app.get(
    "/api/chat/log/:number",
    async (req, res) => {

        try {

            const number =
                Number(
                    req.params.number
                );

            if (
                !Number.isInteger(
                    number
                ) ||
                number < 1
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        error:
                            "INVALID LOG NUMBER"

                    });

            }

            const filePath =
                chatLogFilename(
                    number
                );

            const text =
                await githubReadFile(
                    filePath
                );

            let data;

            try {

                data =
                    JSON.parse(
                        text
                    );

            }
            catch {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        error:
                            "CHAT LOG JSON INVALID"

                    });

            }

            res.json({

                success:
                    true,

                number,

                messages:
                    Array.isArray(
                        data
                    )
                        ? data
                        : (
                            Array.isArray(
                                data.messages
                            )
                                ? data.messages
                                : []
                        )

            });

        }
        catch (error) {

            console.error(
                "[CHAT LOG READ]",
                error
            );

            res
                .status(
                    error.status === 404
                        ? 404
                        : 500
                )
                .json({

                    success:
                        false,

                    error:
                        error.status === 404
                            ? "CHAT LOG NOT FOUND"
                            : error.message

                });

        }

    }
);


// ============================================================
// WEBSOCKET
// ============================================================

const wss =
    new WebSocketServer({
        server,
        path:
            "/ws"
    });

const clients =
    new Set();

function sendWS(
    ws,
    data
) {

    if (
        ws.readyState ===
        1
    ) {

        try {

            ws.send(
                JSON.stringify(
                    data
                )
            );

        }
        catch {}

    }

}


function broadcast(
    data
) {

    const text =
        JSON.stringify(
            data
        );

    for (
        const ws
        of clients
    ) {

        if (
            ws.readyState ===
            1
        ) {

            try {

                ws.send(
                    text
                );

            }
            catch {}

        }

    }

}


// ============================================================
// WEBSOCKET CONNECTION
// ============================================================

wss.on(
    "connection",
    async ws => {

        clients.add(
            ws
        );

        let authenticatedUser =
            null;

        console.log(
            "[WSS] Client connecté"
        );

        sendWS(
            ws,
            {

                type:
                    "system",

                message:
                    "Connexion au serveur DAVID RANDOM ✓"

            }
        );

        ws.on(
            "message",
            async raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );

                    // ========================================
                    // AUTH
                    // ========================================

                    if (
                        data.type ===
                        "auth"
                    ) {

                        await loadAccounts();

                        const user =
                            getUserFromToken(
                                data.token
                            );

                        if (!user) {

                            sendWS(
                                ws,
                                {

                                    type:
                                        "auth",

                                    success:
                                        false,

                                    message:
                                        "TOKEN INVALID"

                                }
                            );

                            return;

                        }

                        authenticatedUser =
                            user;

                        sendWS(
                            ws,
                            {

                                type:
                                    "auth",

                                success:
                                    true,

                                user:
                                    publicUser(
                                        user
                                    )

                            }
                        );

                        console.log(
                            `[WSS] Auth: ${user.username}`
                        );

                        return;

                    }

                    // ========================================
                    // CHAT
                    // ========================================

                    if (
                        data.type ===
                            "chat" ||
                        data.type ===
                            "message"
                    ) {

                        await loadAccounts();

                        let user =
                            authenticatedUser;

                        if (
                            !user &&
                            data.token
                        ) {

                            user =
                                getUserFromToken(
                                    data.token
                                );

                        }

                        if (!user) {

                            sendWS(
                                ws,
                                {

                                    type:
                                        "error",

                                    message:
                                        "LOGIN REQUIRED"

                                }
                            );

                            return;

                        }

                        authenticatedUser =
                            user;

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
                            MAX_MESSAGE_LENGTH
                        ) {

                            sendWS(
                                ws,
                                {

                                    type:
                                        "error",

                                    message:
                                        "MESSAGE TOO LONG"

                                }
                            );

                            return;

                        }

                        const chatMessage = {

                            type:
                                "chat",

                            id:
                                randomId(
                                    6
                                ),

                            username:
                                user.username,

                            message,

                            time:
                                new Date()
                                    .toISOString()

                        };

                        broadcast(
                            chatMessage
                        );

                        try {

                            await saveChatMessage(
                                chatMessage
                            );

                        }
                        catch (error) {

                            console.error(
                                "[CHAT SAVE]",
                                error
                            );

                            sendWS(
                                ws,
                                {

                                    type:
                                        "error",

                                    message:
                                        "Message envoyé mais sauvegarde GitHub échouée."

                                }
                            );

                        }

                        return;

                    }

                    // ========================================
                    // PING
                    // ========================================

                    if (
                        data.type ===
                        "ping"
                    ) {

                        sendWS(
                            ws,
                            {

                                type:
                                    "pong",

                                time:
                                    Date.now()

                            }
                        );

                        return;

                    }

                    // ========================================
                    // UNKNOWN
                    // ========================================

                    sendWS(
                        ws,
                        {

                            type:
                                "error",

                            message:
                                "UNKNOWN MESSAGE TYPE"

                        }
                    );

                }
                catch (error) {

                    console.error(
                        "[WSS MESSAGE]",
                        error
                    );

                    sendWS(
                        ws,
                        {

                            type:
                                "error",

                            message:
                                "INVALID JSON"

                        }
                    );

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
                    "[WSS] Client déconnecté"
                );

            }
        );

        ws.on(
            "error",
            error => {

                console.error(
                    "[WSS CLIENT]",
                    error
                );

                clients.delete(
                    ws
                );

            }
        );

    }
);


// ============================================================
// HTTP 404
// ============================================================

app.use(
    (req, res) => {

        res
            .status(404)
            .json({

                success:
                    false,

                error:
                    "Route introuvable.",

                path:
                    req.originalUrl

            });

    }
);


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "[SERVER ERROR]",
            error
        );

        res
            .status(500)
            .json({

                success:
                    false,

                error:
                    error.message ||
                    "Internal server error"

            });

    }
);


// ============================================================
// START SERVER
// ============================================================

server.listen(
    PORT,
    async () => {

        console.log(
            "======================================"
        );

        console.log(
            "DAVID RANDOM V2"
        );

        console.log(
            "======================================"
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
            "GITHUB TOKEN:",
            GITHUB_TOKEN
                ? "PRESENT"
                : "MISSING"
        );

        console.log(
            "ACCOUNTS ENCRYPTION KEY:",
            ACCOUNTS_ENCRYPTION_KEY
                ? "PRESENT"
                : "MISSING"
        );

        console.log(
            "ACCOUNTS:"
        );

        console.log(
            "  accounts.json"
        );

        console.log(
            "  accounts/users.enc"
        );

        console.log(
            "MEDIA:"
        );

        console.log(
            "  /image/"
        );

        console.log(
            "  /music/"
        );

        console.log(
            "  /video/"
        );

        console.log(
            "CHAT LOG:"
        );

        console.log(
            "  /chat-log/"
        );

        console.log(
            "API:"
        );

        console.log(
            "  /api/status"
        );

        console.log(
            "  /api/account/register"
        );

        console.log(
            "  /api/account/login"
        );

        console.log(
            "  /api/account/me"
        );

        console.log(
            "  /api/account/logout"
        );

        console.log(
            "  /api/files/:folder"
        );

        console.log(
            "  /api/upload"
        );

        console.log(
            "  /api/chat/history"
        );

        console.log(
            "  /api/chat/logs"
        );

        console.log(
            "  /api/chat/log/:number"
        );

        console.log(
            "WEBSOCKET:"
        );

        console.log(
            "  /ws"
        );

        console.log(
            "======================================"
        );

        // ================================================
        // LOAD ACCOUNTS
        // ================================================

        try {

            await loadAccounts();

            console.log(
                `[ACCOUNTS] ${accounts.size} compte(s) disponible(s)`
            );

        }
        catch (error) {

            console.error(
                "[ACCOUNTS] Chargement impossible:",
                error.message
            );

        }

        // ================================================
        // LOAD CHAT
        // ================================================

        try {

            await loadChatLogs();

            console.log(
                `[CHAT] ${chatLogCache.length} messages chargés`
            );

        }
        catch (error) {

            console.warn(
                "[CHAT] Préchargement impossible:",
                error.message
            );

        }

    }
);
