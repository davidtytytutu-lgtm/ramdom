// ============================================================
// DAVID RANDOM V2 - SERVER
// Render + GitHub Storage + WebSocket + Accounts
// Persistent Accounts: accounts.json + accounts/users.enc
// Chat Logs + Media
// ============================================================

const express = require("express");
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

// Clé de chiffrement des comptes.
// IMPORTANT : à mettre dans les variables Render.
const ACCOUNT_ENCRYPTION_KEY =
    process.env.ACCOUNT_ENCRYPTION_KEY || "";

const MAX_UPLOAD_SIZE =
    25 * 1024 * 1024;

const MAX_MESSAGE_LENGTH = 500;

const CHAT_LOG_LIMIT =
    15 * 1024 * 1024;

// ============================================================
// MIDDLEWARE
// ============================================================

// CORS sans dépendance supplémentaire
app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        req.headers.origin || "*"
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
        "GET,POST,PUT,DELETE,OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});

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

async function githubRequest(apiPath, options = {}) {

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
        data = await response.json();
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
            .join("/")
        }?ref=${encodeURIComponent(GITHUB_BRANCH)}`
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
                .join("/")
            }?ref=${encodeURIComponent(GITHUB_BRANCH)}`
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
            await githubRequest(
                `/contents/${cleanPath
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")
                }?ref=${encodeURIComponent(GITHUB_BRANCH)}`
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
                .from(content, "utf8")
                .toString("base64"),

        branch:
            GITHUB_BRANCH

    };

    if (sha) {
        body.sha = sha;
    }

    return githubRequest(
        `/contents/${cleanPath
            .split("/")
            .map(encodeURIComponent)
            .join("/")
        }`,
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
            await githubRequest(
                `/contents/${cleanPath
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")
                }?ref=${encodeURIComponent(GITHUB_BRANCH)}`
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
        body.sha = sha;
    }

    return githubRequest(
        `/contents/${cleanPath
            .split("/")
            .map(encodeURIComponent)
            .join("/")
        }`,
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

// SHA-256 conservé pour être compatible avec
// les comptes créés par ta version actuelle.

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
// ACCOUNT ENCRYPTION
// ============================================================

function getEncryptionKey() {

    if (!ACCOUNT_ENCRYPTION_KEY) {

        throw new Error(
            "ACCOUNT_ENCRYPTION_KEY n'est pas configurée sur Render."
        );

    }

    /*
       SHA-256 permet d'obtenir exactement 32 octets
       pour AES-256-GCM.
    */

    return crypto
        .createHash("sha256")
        .update(
            ACCOUNT_ENCRYPTION_KEY,
            "utf8"
        )
        .digest();

}

// ============================================================
// ENCRYPT USERS
// ============================================================

function encryptAccounts(users) {

    const key =
        getEncryptionKey();

    const iv =
        crypto.randomBytes(12);

    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    const json =
        JSON.stringify(
            users,
            null,
            2
        );

    const encrypted =
        Buffer.concat([
            cipher.update(
                json,
                "utf8"
            ),
            cipher.final()
        ]);

    const authTag =
        cipher.getAuthTag();

    /*
       Format :

       DRAC1:
       IV:
       AUTH TAG:
       DATA
    */

    return [
        "DRAC1",
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64")
    ].join(":");

}

// ============================================================
// DECRYPT USERS
// ============================================================

function decryptAccounts(text) {

    const clean =
        String(text || "").trim();

    if (!clean) {
        return [];
    }

    /*
       Nouveau format DAVID RANDOM
    */

    if (clean.startsWith("DRAC1:")) {

        const parts =
            clean.split(":");

        if (parts.length !== 4) {

            throw new Error(
                "FORMAT users.enc INVALIDE."
            );

        }

        const iv =
            Buffer.from(
                parts[1],
                "base64"
            );

        const authTag =
            Buffer.from(
                parts[2],
                "base64"
            );

        const encrypted =
            Buffer.from(
                parts[3],
                "base64"
            );

        const decipher =
            crypto.createDecipheriv(
                "aes-256-gcm",
                getEncryptionKey(),
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
            ]).toString("utf8");

        const users =
            JSON.parse(decrypted);

        return Array.isArray(users)
            ? users
            : [];

    }

    /*
       Compatibilité :
       si users.enc contient directement du JSON.
    */

    try {

        const decoded =
            Buffer.from(
                clean,
                "base64"
            ).toString("utf8");

        const parsed =
            JSON.parse(decoded);

        if (Array.isArray(parsed)) {
            return parsed;
        }

    }
    catch {}

    /*
       Dernière possibilité :
       users.enc contient du JSON normal.
    */

    try {

        const parsed =
            JSON.parse(clean);

        if (Array.isArray(parsed)) {
            return parsed;
        }

    }
    catch {}

    throw new Error(
        "Impossible de déchiffrer accounts/users.enc avec le format actuel."
    );

}

// ============================================================
// ACCOUNTS.JSON
// ============================================================

function createAccountsIndex() {

    const users =
        Array.from(
            accounts.values()
        );

    return {

        version: 2,

        storage:
            "accounts/users.enc",

        updatedAt:
            new Date().toISOString(),

        users:
            users.map(user => ({
                id: user.id,
                username: user.username,
                createdAt: user.createdAt
            }))

    };

}

// ============================================================
// SAVE ACCOUNTS
// ============================================================

async function saveAccounts() {

    const users =
        Array.from(
            accounts.values()
        );

    /*
       users.enc contient les informations complètes
       des utilisateurs.
    */

    const encrypted =
        encryptAccounts(users);

    await githubWriteFile(
        "accounts/users.enc",
        encrypted,
        "Update encrypted accounts"
    );

    /*
       accounts.json sert d'index public/non-secret.
       AUCUN mot de passe n'y est enregistré.
    */

    const index =
        createAccountsIndex();

    await githubWriteFile(
        "accounts.json",
        JSON.stringify(
            index,
            null,
            2
        ),
        "Update accounts index"
    );

}

// ============================================================
// LOAD ACCOUNTS
// ============================================================

async function loadAccounts() {

    if (accountsLoaded) {
        return;
    }

    accountsLoaded = true;

    console.log(
        "[ACCOUNTS] Chargement depuis GitHub..."
    );

    let users = [];

    /*
       1. On essaye users.enc
    */

    try {

        const encrypted =
            await githubReadFile(
                "accounts/users.enc"
            );

        users =
            decryptAccounts(
                encrypted
            );

        console.log(
            `[ACCOUNTS] users.enc chargé : ${users.length} compte(s)`
        );

    }
    catch (error) {

        if (error.status === 404) {

            console.log(
                "[ACCOUNTS] accounts/users.enc inexistant."
            );

        }
        else {

            console.error(
                "[ACCOUNTS] Erreur users.enc:",
                error.message
            );

        }

    }

    /*
       2. Si users.enc ne contient rien,
          on essaye accounts.json.
    */

    if (users.length === 0) {

        try {

            const text =
                await githubReadFile(
                    "accounts.json"
                );

            const data =
                JSON.parse(text);

            if (Array.isArray(data)) {

                users = data;

            }
            else if (
                Array.isArray(data.users)
            ) {

                /*
                   Attention :
                   accounts.json ne devrait normalement
                   pas contenir les mots de passe.
                */

                users =
                    data.users;

            }

            console.log(
                `[ACCOUNTS] accounts.json chargé : ${users.length} compte(s)`
            );

        }
        catch (error) {

            if (error.status === 404) {

                console.log(
                    "[ACCOUNTS] Aucun ancien compte trouvé."
                );

            }
            else {

                console.error(
                    "[ACCOUNTS] Erreur accounts.json:",
                    error.message
                );

            }

        }

    }

    /*
       3. Mise en mémoire
    */

    for (const user of users) {

        if (!user || !user.id) {
            continue;
        }

        if (!user.username) {
            continue;
        }

        accounts.set(
            user.id,
            {
                id:
                    String(user.id),

                username:
                    String(user.username),

                password:
                    String(user.password || ""),

                profile_picture:
                    user.profile_picture ||
                    null,

                createdAt:
                    user.createdAt ||
                    new Date().toISOString()

            }
        );

    }

    console.log(
        `[ACCOUNTS] ${accounts.size} compte(s) disponible(s).`
    );

}

// ============================================================
// SESSION
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
// TOKEN
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

function authMiddleware(req, res, next) {

    const token =
        getTokenFromRequest(req);

    const user =
        getUserFromToken(token);

    if (!user) {

        return res.status(401).json({
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
            user.profile_picture ||
            null

    };

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

            accounts:
                accounts.size,

            websocket:
                true

        });

    }
);

// ============================================================

app.get(
    "/api/status",
    (req, res) => {

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
                Boolean(GITHUB_TOKEN),

            accounts:
                accounts.size,

            accounts_loaded:
                accountsLoaded,

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
// REGISTER
// ============================================================

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

            const profilePicture =
                req.body.profile_picture ||
                null;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

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

                return res.status(400).json({

                    success:
                        false,

                    error:
                        "USERNAME MUST BE 3-24 CHARACTERS"

                });

            }

            if (password.length < 4) {

                return res.status(400).json({

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

                    return res.status(409).json({

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
                    hashPassword(password),

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
               Sauvegarde IMMÉDIATE sur GitHub.
            */

            try {

                await saveAccounts();

            }
            catch (saveError) {

                /*
                   On retire le compte de la mémoire
                   si la sauvegarde échoue.
                */

                accounts.delete(
                    user.id
                );

                console.error(
                    "[REGISTER SAVE]",
                    saveError
                );

                return res.status(500).json({

                    success:
                        false,

                    error:
                        "ACCOUNT SAVE ERROR: " +
                        saveError.message

                });

            }

            const token =
                createSession(user);

            console.log(
                `[ACCOUNT] Nouveau compte : ${user.username}`
            );

            res.json({

                success:
                    true,

                token,

                user:
                    publicUser(user)

            });

        }
        catch (error) {

            console.error(
                "[REGISTER]",
                error
            );

            res.status(500).json({

                success:
                    false,

                error:
                    "REGISTRATION ERROR"

            });

        }

    }
);

// ============================================================
// LOGIN
// ============================================================

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            /*
               S'assurer que les comptes GitHub sont
               chargés avant de chercher l'utilisateur.
            */

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

                console.log(
                    `[LOGIN] Utilisateur inconnu : ${username}`
                );

                return res.status(401).json({

                    success:
                        false,

                    error:
                        "INVALID USERNAME OR PASSWORD"

                });

            }

            /*
               Vérification du mot de passe.
            */

            const passwordHash =
                hashPassword(
                    password
                );

            if (
                foundUser.password !==
                passwordHash
            ) {

                console.log(
                    `[LOGIN] Mauvais mot de passe : ${username}`
                );

                return res.status(401).json({

                    success:
                        false,

                    error:
                        "INVALID USERNAME OR PASSWORD"

                });

            }

            /*
               IMPORTANT :
               nouveau token de session.
            */

            const token =
                createSession(
                    foundUser
                );

            console.log(
                `[LOGIN] Connexion réussie : ${foundUser.username}`
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

            res.status(500).json({

                success:
                    false,

                error:
                    "LOGIN ERROR: " +
                    error.message

            });

        }

    }
);

// ============================================================
// ME
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
// LOGOUT
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

function getAllowedExtensions(folder) {

    if (folder === "image") {

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

    if (folder === "music") {

        return [
            ".mp3",
            ".wav",
            ".ogg",
            ".flac",
            ".m4a",
            ".aac"
        ];

    }

    if (folder === "video") {

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

function githubRawUrl(folder, filename) {

    return (
        "https://raw.githubusercontent.com/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/" +
        encodeURIComponent(GITHUB_BRANCH) +
        "/" +
        folder +
        "/" +
        filename
            .split("/")
            .map(encodeURIComponent)
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

            return res.status(400).json({

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
                Array.isArray(entries)
                ? entries
                    .filter(item => {

                        if (
                            item.type !==
                            "file"
                        ) {
                            return false;
                        }

                        if (
                            item.name
                                .toLowerCase()
                                .endsWith(".gitkeep")
                        ) {
                            return false;
                        }

                        return allowed.includes(
                            path.extname(
                                item.name
                            ).toLowerCase()
                        );

                    })
                    .map(item => ({

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

                    }))
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

            res.status(
                error.status === 404
                    ? 404
                    : 500
            ).json({

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

                return res.status(400).json({

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

                return res.status(400).json({

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
                ).includes(extension)
            ) {

                return res.status(400).json({

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

                return res.status(413).json({

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

            res.status(500).json({

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
// CHAT LOG
// ============================================================

function chatLogFilename(number) {

    return (
        "chat-log/chat-log" +
        String(number).padStart(3, "0") +
        ".json"
    );

}

// ============================================================

function calculateChatLogSize(messages) {

    return Buffer.byteLength(
        JSON.stringify(
            messages,
            null,
            2
        ),
        "utf8"
    );

}

// ============================================================

async function getChatLogFiles() {

    try {

        const entries =
            await githubListFolder(
                "chat-log"
            );

        return Array.isArray(entries)
            ? entries
                .filter(
                    item =>
                        item.type === "file" &&
                        /^chat-log\d+\.json$/i
                            .test(item.name)
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

        if (error.status === 404) {
            return [];
        }

        throw error;

    }

}

// ============================================================

async function loadChatLogs() {

    if (chatLogLoaded) {
        return chatLogCache;
    }

    chatLogCache = [];

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
                    JSON.parse(text);

                if (
                    Array.isArray(parsed)
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
        chatLogCache.length > 1000
    ) {

        chatLogCache =
            chatLogCache.slice(-1000);

    }

    chatLogLoaded = true;

    return chatLogCache;

}

// ============================================================

async function getNextChatLogNumber() {

    const files =
        await getChatLogFiles();

    let max = 0;

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
                    Number(match[1])
                );

        }

    }

    return max + 1;

}

// ============================================================

async function saveChatMessage(message) {

    chatLogCache.push(
        message
    );

    if (
        chatLogCache.length >
        1000
    ) {

        chatLogCache =
            chatLogCache.slice(-1000);

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
                        chatLogCache.length / 2
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
            chatLogFilename(number),
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

    if (files.length > 0) {

        const last =
            files[files.length - 1];

        const match =
            last.name.match(
                /^chat-log(\d+)\.json$/i
            );

        if (match) {

            number =
                Number(match[1]);

        }

    }

    await githubWriteFile(
        chatLogFilename(number),
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
                    messages.slice(-200)

            });

        }
        catch (error) {

            console.error(
                "[CHAT HISTORY]",
                error
            );

            res.status(500).json({

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

            res.status(500).json({

                success:
                    false,

                error:
                    error.message

            });

        }

    }
);

// ============================================================
// INDIVIDUAL CHAT LOG
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
                !Number.isInteger(number) ||
                number < 1
            ) {

                return res.status(400).json({

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
                    JSON.parse(text);

            }
            catch {

                return res.status(500).json({

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
                    Array.isArray(data)
                    ? data
                    : data.messages || []

            });

        }
        catch (error) {

            console.error(
                "[CHAT LOG READ]",
                error
            );

            res.status(
                error.status === 404
                    ? 404
                    : 500
            ).json({

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

// ============================================================

function sendWS(ws, data) {

    if (
        ws.readyState === 1
    ) {

        try {

            ws.send(
                JSON.stringify(data)
            );

        }
        catch {}

    }

}

// ============================================================

function broadcast(data) {

    const text =
        JSON.stringify(data);

    for (
        const ws
        of clients
    ) {

        if (
            ws.readyState === 1
        ) {

            try {

                ws.send(text);

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
    (ws) => {

        clients.add(ws);

        let authenticatedUser =
            null;

        console.log(
            `[WSS] Client connecté (${clients.size})`
        );

        sendWS(ws, {

            type:
                "system",

            message:
                "Connexion au serveur DAVID RANDOM ✓"

        });

        /*
           Le client DOIT envoyer :

           {
               type: "auth",
               token: "..."
           }

           avant de pouvoir envoyer un message.
        */

        ws.on(
            "message",
            async raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );

                    if (
                        !data ||
                        typeof data !==
                        "object"
                    ) {

                        return;

                    }

                    // ====================================================
                    // AUTH
                    // ====================================================

                    if (
                        data.type === "auth"
                    ) {

                        const token =
                            String(
                                data.token || ""
                            ).trim();

                        if (!token) {

                            sendWS(ws, {

                                type:
                                    "auth",

                                success:
                                    false,

                                message:
                                    "TOKEN MISSING"

                            });

                            return;

                        }

                        const user =
                            getUserFromToken(
                                token
                            );

                        if (!user) {

                            console.log(
                                "[WSS] Token invalide"
                            );

                            sendWS(ws, {

                                type:
                                    "auth",

                                success:
                                    false,

                                message:
                                    "TOKEN INVALID"

                            });

                            return;

                        }

                        authenticatedUser =
                            user;

                        sendWS(ws, {

                            type:
                                "auth",

                            success:
                                true,

                            user:
                                publicUser(
                                    user
                                )

                        });

                        console.log(
                            `[WSS] Auth OK: ${user.username}`
                        );

                        return;

                    }

                    // ====================================================
                    // CHAT
                    // ====================================================

                    if (
                        data.type === "chat" ||
                        data.type === "message"
                    ) {

                        /*
                           IMPORTANT :
                           On vérifie d'abord l'utilisateur déjà
                           authentifié avec le message auth.
                        */

                        let user =
                            authenticatedUser;

                        /*
                           Compatibilité :
                           le client peut aussi envoyer son token
                           directement dans le message.
                        */

                        if (
                            !user &&
                            data.token
                        ) {

                            user =
                                getUserFromToken(
                                    String(
                                        data.token
                                    ).trim()
                                );

                        }

                        if (!user) {

                            sendWS(ws, {

                                type:
                                    "error",

                                message:
                                    "LOGIN REQUIRED"

                            });

                            return;

                        }

                        authenticatedUser =
                            user;

                        const message =
                            String(
                                data.message || ""
                            ).trim();

                        if (!message) {
                            return;
                        }

                        if (
                            message.length >
                            MAX_MESSAGE_LENGTH
                        ) {

                            sendWS(ws, {

                                type:
                                    "error",

                                message:
                                    "MESSAGE TOO LONG"

                            });

                            return;

                        }

                        const chatMessage = {

                            type:
                                "chat",

                            id:
                                randomId(6),

                            username:
                                user.username,

                            message,

                            time:
                                new Date()
                                    .toISOString()

                        };

                        /*
                           Broadcast immédiat.
                        */

                        broadcast(
                            chatMessage
                        );

                        /*
                           Sauvegarde GitHub.
                        */

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

                            sendWS(ws, {

                                type:
                                    "error",

                                message:
                                    "Message envoyé mais sauvegarde GitHub échouée."

                            });

                        }

                        return;

                    }

                    // ====================================================
                    // PING
                    // ====================================================

                    if (
                        data.type === "ping"
                    ) {

                        sendWS(ws, {

                            type:
                                "pong",

                            time:
                                Date.now()

                        });

                        return;

                    }

                    // ====================================================
                    // UNKNOWN
                    // ====================================================

                    sendWS(ws, {

                        type:
                            "error",

                        message:
                            "UNKNOWN MESSAGE TYPE"

                    });

                }
                catch (error) {

                    console.error(
                        "[WSS MESSAGE]",
                        error
                    );

                    sendWS(ws, {

                        type:
                            "error",

                        message:
                            "INVALID JSON"

                    });

                }

            }
        );

        // ============================================================
        // CLOSE
        // ============================================================

        ws.on(
            "close",
            () => {

                clients.delete(
                    ws
                );

                console.log(
                    `[WSS] Client déconnecté (${clients.size})`
                );

            }
        );

        // ============================================================
        // ERROR
        // ============================================================

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

        res.status(404).json({

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

        res.status(500).json({

            success:
                false,

            error:
                error.message ||
                "Internal server error"

        });

    }
);

// ============================================================
// START
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
            "ACCOUNT ENCRYPTION:",
            ACCOUNT_ENCRYPTION_KEY
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

        // ============================================================
        // CHARGEMENT DES COMPTES
        // ============================================================

        try {

            await loadAccounts();

        }
        catch (error) {

            console.error(
                "[ACCOUNTS] Chargement impossible:",
                error.message
            );

        }

        // ============================================================
        // CHARGEMENT CHAT
        // ============================================================

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

        console.log(
            "======================================"
        );

        console.log(
            "DAVID RANDOM V2 READY"
        );

        console.log(
            "======================================"

        );

    }
);
