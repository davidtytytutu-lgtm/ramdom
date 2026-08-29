"use strict";

/*
=========================================================
 DAVID RANDOM V2
 Render + GitHub Storage + WebSocket + Accounts
=========================================================
*/

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/*
=========================================================
 CONFIGURATION
=========================================================
*/

const PORT = process.env.PORT || 10000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER =
    process.env.GITHUB_OWNER || "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO || "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH || "main";

const SESSION_SECRET =
    process.env.SESSION_SECRET ||
    crypto.randomBytes(32).toString("hex");

const MAX_FILE_SIZE =
    25 * 1024 * 1024;

const MAX_MESSAGE_LENGTH = 500;

const ALLOWED_FOLDERS = [
    "image",
    "music",
    "video",
    "chat-log"
];

const MEDIA_FOLDERS = [
    "image",
    "music",
    "video"
];


/*
=========================================================
 EXPRESS
=========================================================
*/

app.use(express.json({
    limit: "35mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "35mb"
}));

/*
 CORS
*/

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,DELETE,OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});


/*
=========================================================
 UTILITAIRES
=========================================================
*/

function nowISO() {
    return new Date().toISOString();
}


function cleanUsername(username) {

    return String(username || "")
        .trim();

}


function safeFilename(filename) {

    return String(filename || "")
        .replace(/\\/g, "_")
        .replace(/\//g, "_")
        .replace(/\.\./g, "_")
        .trim();

}


function normalizeFolder(folder) {

    return String(folder || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");

}


function base64Encode(buffer) {

    return Buffer
        .from(buffer)
        .toString("base64");

}


function base64Decode(data) {

    return Buffer
        .from(data, "base64");

}


/*
=========================================================
 PASSWORD HASH
=========================================================
*/

function hashPassword(password) {

    const salt =
        crypto.randomBytes(16).toString("hex");

    const hash =
        crypto.scryptSync(
            password,
            salt,
            64
        ).toString("hex");

    return `${salt}:${hash}`;

}


function verifyPassword(password, stored) {

    try {

        const parts =
            String(stored).split(":");

        if (parts.length !== 2) {
            return false;
        }

        const salt = parts[0];
        const originalHash = parts[1];

        const hash =
            crypto.scryptSync(
                password,
                salt,
                64
            ).toString("hex");

        return crypto.timingSafeEqual(
            Buffer.from(hash, "hex"),
            Buffer.from(originalHash, "hex")
        );

    }
    catch {

        return false;

    }

}


/*
=========================================================
 SESSION TOKENS
=========================================================
*/

function createToken(user) {

    const payload = {
        id: user.id,
        username: user.username,
        iat: Date.now()
    };

    const encoded =
        Buffer
            .from(JSON.stringify(payload))
            .toString("base64url");

    const signature =
        crypto
            .createHmac(
                "sha256",
                SESSION_SECRET
            )
            .update(encoded)
            .digest("base64url");

    return `${encoded}.${signature}`;

}


function verifyToken(token) {

    try {

        if (!token) {
            return null;
        }

        const parts =
            String(token).split(".");

        if (parts.length !== 2) {
            return null;
        }

        const encoded = parts[0];
        const signature = parts[1];

        const expected =
            crypto
                .createHmac(
                    "sha256",
                    SESSION_SECRET
                )
                .update(encoded)
                .digest("base64url");

        if (
            signature.length !== expected.length ||
            !crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected)
            )
        ) {
            return null;
        }

        const payload =
            JSON.parse(
                Buffer
                    .from(encoded, "base64url")
                    .toString("utf8")
            );

        return payload;

    }
    catch {

        return null;

    }

}


function getBearerToken(req) {

    const header =
        req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    return header.slice(7).trim();

}


function getUserFromRequest(req) {

    const token =
        getBearerToken(req);

    if (!token) {
        return null;
    }

    return verifyToken(token);

}


function requireAuth(req, res, next) {

    const user =
        getUserFromRequest(req);

    if (!user) {

        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });

    }

    req.user = user;

    next();

}


/*
=========================================================
 GITHUB API
=========================================================
*/

function githubHeaders() {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN is missing"
        );

    }

    return {

        "Authorization":
            `Bearer ${GITHUB_TOKEN}`,

        "Accept":
            "application/vnd.github+json",

        "X-GitHub-Api-Version":
            "2022-11-28",

        "User-Agent":
            "David-Random-V2"

    };

}


function githubContentsURL(path = "") {

    const cleanPath =
        String(path)
            .replace(/^\/+/, "");

    return (
        `https://api.github.com/repos/` +
        `${encodeURIComponent(GITHUB_OWNER)}/` +
        `${encodeURIComponent(GITHUB_REPO)}/` +
        `contents/` +
        cleanPath
    );

}


/*
=========================================================
 GITHUB GET
=========================================================
*/

async function githubGet(path) {

    const response =
        await fetch(
            githubContentsURL(path),
            {
                method: "GET",
                headers: githubHeaders(),
                cache: "no-store"
            }
        );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {

        const text =
            await response.text();

        throw new Error(
            `GitHub GET ${response.status}: ${text}`
        );

    }

    return await response.json();

}


/*
=========================================================
 GITHUB PUT
=========================================================
*/

async function githubPut(
    path,
    content,
    message,
    sha = null
) {

    const body = {

        message,

        content

    };

    if (sha) {
        body.sha = sha;
    }

    body.branch =
        GITHUB_BRANCH;

    const response =
        await fetch(
            githubContentsURL(path),
            {
                method: "PUT",

                headers: {
                    ...githubHeaders(),
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(body)
            }
        );


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            data.message ||
            `GitHub PUT ${response.status}`
        );

    }


    return data;

}


/*
=========================================================
 GITHUB DELETE
=========================================================
*/

async function githubDelete(
    path,
    sha,
    message
) {

    const response =
        await fetch(
            githubContentsURL(path),
            {
                method: "DELETE",

                headers: {
                    ...githubHeaders(),
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({

                        message,

                        sha,

                        branch:
                            GITHUB_BRANCH

                    })
            }
        );


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            data.message ||
            `GitHub DELETE ${response.status}`
        );

    }


    return data;

}


/*
=========================================================
 GITHUB DIRECTORY
=========================================================
*/

async function githubListFolder(folder) {

    const result =
        await githubGet(folder);

    if (result === null) {

        /*
           Le dossier peut être vide ou ne pas
           encore exister.
        */

        return [];

    }

    if (!Array.isArray(result)) {

        throw new Error(
            "GitHub path is not a directory"
        );

    }

    return result;

}


/*
=========================================================
 ACCOUNT DATABASE
=========================================================

 accounts.json sera stocké dans le dépôt GitHub.

=========================================================
*/

const ACCOUNTS_FILE = "accounts.json";


async function getAccountsFile() {

    const file =
        await githubGet(
            ACCOUNTS_FILE
        );

    if (!file) {

        return {

            sha: null,

            accounts: []

        };

    }


    try {

        const decoded =
            Buffer
                .from(
                    file.content.replace(/\n/g, ""),
                    "base64"
                )
                .toString("utf8");

        const accounts =
            JSON.parse(decoded);

        return {

            sha: file.sha,

            accounts:
                Array.isArray(accounts)
                ? accounts
                : []

        };

    }
    catch {

        return {

            sha: file.sha,

            accounts: []

        };

    }

}


async function saveAccounts(
    accounts,
    sha
) {

    const content =
        Buffer
            .from(
                JSON.stringify(
                    accounts,
                    null,
                    2
                ),
                "utf8"
            )
            .toString("base64");


    return await githubPut(
        ACCOUNTS_FILE,
        content,
        "Update accounts",
        sha
    );

}


/*
=========================================================
 STATUS
=========================================================
*/

app.get(
    "/",
    (req, res) => {

        res.json({

            name:
                "DAVID RANDOM V2",

            online:
                true,

            server:
                "Render",

            storage:
                "GitHub",

            websocket:
                true,

            time:
                nowISO()

        });

    }
);


app.get(
    "/api/status",
    (req, res) => {

        res.json({

            online: true,

            name:
                "DAVID RANDOM V2",

            server:
                "Render",

            storage:
                "GitHub",

            websocket:
                true,

            repository:
                `${GITHUB_OWNER}/${GITHUB_REPO}`,

            time:
                nowISO()

        });

    }
);


/*
=========================================================
 ACCOUNT REGISTER
=========================================================
*/

app.post(
    "/api/account/register",
    async (req, res) => {

        try {

            const username =
                cleanUsername(
                    req.body.username
                );

            const password =
                String(
                    req.body.password || ""
                );

            const profilePicture =
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

                    success: false,

                    error:
                        "Username must contain 3-24 characters"

                });

            }


            if (
                password.length < 1
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Password required"

                });

            }


            if (
                !/^[a-zA-Z0-9_.-]+$/.test(username)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid username"

                });

            }


            const database =
                await getAccountsFile();


            const exists =
                database.accounts.some(
                    account =>
                        account.username.toLowerCase() ===
                        username.toLowerCase()
                );


            if (exists) {

                return res.status(409).json({

                    success: false,

                    error:
                        "Username already exists"

                });

            }


            const user = {

                id:
                    crypto
                        .randomUUID(),

                username,

                password:
                    hashPassword(password),

                profile_picture:
                    profilePicture,

                created_at:
                    nowISO()

            };


            database.accounts.push(
                user
            );


            await saveAccounts(
                database.accounts,
                database.sha
            );


            const publicUser = {

                id:
                    user.id,

                username:
                    user.username,

                profile_picture:
                    user.profile_picture

            };


            const token =
                createToken(
                    publicUser
                );


            res.json({

                success: true,

                token,

                user:
                    publicUser

            });

        }
        catch(error) {

            console.error(
                "[REGISTER]",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 ACCOUNT LOGIN
=========================================================
*/

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            const username =
                cleanUsername(
                    req.body.username
                );

            const password =
                String(
                    req.body.password || ""
                );


            const database =
                await getAccountsFile();


            const user =
                database.accounts.find(
                    account =>
                        account.username.toLowerCase() ===
                        username.toLowerCase()
                );


            if (
                !user ||
                !verifyPassword(
                    password,
                    user.password
                )
            ) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Invalid username or password"

                });

            }


            const publicUser = {

                id:
                    user.id,

                username:
                    user.username,

                profile_picture:
                    user.profile_picture || null

            };


            const token =
                createToken(
                    publicUser
                );


            res.json({

                success: true,

                token,

                user:
                    publicUser

            });

        }
        catch(error) {

            console.error(
                "[LOGIN]",
                error
            );

            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 ACCOUNT LOGOUT
=========================================================
*/

app.post(
    "/api/account/logout",
    requireAuth,
    (req, res) => {

        res.json({

            success: true

        });

    }
);


/*
=========================================================
 ACCOUNT ME
=========================================================
*/

app.get(
    "/api/account/me",
    requireAuth,
    (req, res) => {

        res.json({

            success: true,

            user:
                req.user

        });

    }
);


/*
=========================================================
 LIST FILES
=========================================================

 IMPORTANT :

 /api/files/image
 /api/files/music
 /api/files/video
 /api/files/chat-log

=========================================================
*/

app.get(
    "/api/files/:folder",
    async (req, res) => {

        try {

            const folder =
                normalizeFolder(
                    req.params.folder
                );


            if (
                !ALLOWED_FOLDERS.includes(
                    folder
                )
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid folder"

                });

            }


            console.log(
                `[FILES] Listing GitHub folder: ${folder}`
            );


            const githubFiles =
                await githubListFolder(
                    folder
                );


            const files =
                githubFiles
                    .filter(
                        file =>
                            file.type === "file"
                    )
                    .filter(
                        file =>
                            file.name &&
                            !file.name
                                .toLowerCase()
                                .endsWith(".gitkeep")
                    )
                    .map(
                        file => {

                            const rawURL =
                                `https://raw.githubusercontent.com/` +
                                `${encodeURIComponent(GITHUB_OWNER)}/` +
                                `${encodeURIComponent(GITHUB_REPO)}/` +
                                `${encodeURIComponent(GITHUB_BRANCH)}/` +
                                `${folder}/` +
                                file.name
                                    .split("/")
                                    .map(
                                        encodeURIComponent
                                    )
                                    .join("/");


                            return {

                                name:
                                    file.name,

                                path:
                                    file.path,

                                size:
                                    file.size || 0,

                                sha:
                                    file.sha,

                                download:
                                    rawURL,

                                html_url:
                                    file.html_url,

                                type:
                                    file.type

                            };

                        }
                    );


            res.json({

                success: true,

                folder,

                files

            });

        }
        catch(error) {

            console.error(
                `[FILES ${req.params.folder}]`,
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 UPLOAD
=========================================================
*/

app.post(
    "/api/upload",
    requireAuth,
    async (req, res) => {

        try {

            const folder =
                normalizeFolder(
                    req.body.folder
                );

            const filename =
                safeFilename(
                    req.body.filename
                );

            const content =
                String(
                    req.body.content || ""
                );


            if (
                !MEDIA_FOLDERS.includes(
                    folder
                )
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid media folder"

                });

            }


            if (!filename) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Filename required"

                });

            }


            if (!content) {

                return res.status(400).json({

                    success: false,

                    error:
                        "File content required"

                });

            }


            /*
               Le navigateur envoie :

               data:image/png;base64,AAAA...

               ou

               data:audio/mpeg;base64,AAAA...
            */

            const match =
                content.match(
                    /^data:[^;]+;base64,(.+)$/s
                );


            if (!match) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid Base64 data"

                });

            }


            const base64 =
                match[1];


            const buffer =
                base64Decode(
                    base64
                );


            if (
                buffer.length >
                MAX_FILE_SIZE
            ) {

                return res.status(413).json({

                    success: false,

                    error:
                        "File too large. Maximum is 25 MB."

                });

            }


            const githubPath =
                `${folder}/${filename}`;


            /*
               Vérifie si le fichier existe déjà.
               Si oui, GitHub exige son SHA pour
               pouvoir le remplacer.
            */

            const existing =
                await githubGet(
                    githubPath
                );


            const result =
                await githubPut(

                    githubPath,

                    base64,

                    `${existing ? "Update" : "Add"} ${githubPath}`,

                    existing
                    ? existing.sha
                    : null

                );


            const download =
                `https://raw.githubusercontent.com/` +
                `${encodeURIComponent(GITHUB_OWNER)}/` +
                `${encodeURIComponent(GITHUB_REPO)}/` +
                `${encodeURIComponent(GITHUB_BRANCH)}/` +
                `${folder}/` +
                filename
                    .split("/")
                    .map(
                        encodeURIComponent
                    )
                    .join("/");


            console.log(
                `[UPLOAD] ${githubPath} by ${req.user.username}`
            );


            res.json({

                success: true,

                filename,

                folder,

                path:
                    githubPath,

                download,

                url:
                    download,

                sha:
                    result.content
                    ? result.content.sha
                    : null

            });

        }
        catch(error) {

            console.error(
                "[UPLOAD]",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 DELETE MEDIA
=========================================================
*/

app.delete(
    "/api/files/:folder/:filename",
    requireAuth,
    async (req, res) => {

        try {

            const folder =
                normalizeFolder(
                    req.params.folder
                );

            const filename =
                safeFilename(
                    req.params.filename
                );


            if (
                !MEDIA_FOLDERS.includes(
                    folder
                )
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Invalid folder"

                });

            }


            const path =
                `${folder}/${filename}`;


            const file =
                await githubGet(
                    path
                );


            if (!file) {

                return res.status(404).json({

                    success: false,

                    error:
                        "File not found"

                });

            }


            await githubDelete(

                path,

                file.sha,

                `Delete ${path}`

            );


            res.json({

                success: true

            });

        }
        catch(error) {

            console.error(
                "[DELETE]",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 CHAT LOG
=========================================================
*/

async function saveChatLog(
    username,
    message
) {

    const date =
        new Date()
            .toISOString()
            .slice(0, 10);

    const path =
        `chat-log/${date}.txt`;


    const existing =
        await githubGet(
            path
        );


    let oldText = "";


    if (existing) {

        oldText =
            Buffer
                .from(
                    existing.content
                        .replace(/\n/g, ""),
                    "base64"
                )
                .toString("utf8");

    }


    const line =
        `[${new Date().toISOString()}] ` +
        `${username}: ${message}\n`;


    const newText =
        oldText + line;


    const encoded =
        Buffer
            .from(
                newText,
                "utf8"
            )
            .toString("base64");


    await githubPut(

        path,

        encoded,

        `Update chat log ${date}`,

        existing
        ? existing.sha
        : null

    );

}


/*
=========================================================
 CHAT HISTORY API
=========================================================
*/

app.get(
    "/api/chat/history",
    requireAuth,
    async (req, res) => {

        try {

            const files =
                await githubListFolder(
                    "chat-log"
                );


            const logs =
                files
                    .filter(
                        file =>
                            file.type === "file" &&
                            file.name.endsWith(".txt")
                    )
                    .sort(
                        (a, b) =>
                            b.name.localeCompare(
                                a.name
                            )
                    );


            res.json({

                success: true,

                files:
                    logs.map(
                        file => ({

                            name:
                                file.name,

                            download:
                                `https://raw.githubusercontent.com/` +
                                `${GITHUB_OWNER}/` +
                                `${GITHUB_REPO}/` +
                                `${GITHUB_BRANCH}/` +
                                `chat-log/` +
                                encodeURIComponent(
                                    file.name
                                )

                        })
                    )

            });

        }
        catch(error) {

            console.error(
                "[CHAT HISTORY]",
                error
            );


            res.status(500).json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/*
=========================================================
 WEBSOCKET AUTH
=========================================================
*/

function getSocketToken(ws) {

    if (ws.authToken) {
        return ws.authToken;
    }

    return null;

}


/*
=========================================================
 WEBSOCKET
=========================================================
*/

wss.on(
    "connection",
    (ws, request) => {

        console.log(
            "[WSS] Client connected"
        );


        ws.user = null;
        ws.authToken = null;


        ws.send(
            JSON.stringify({

                type:
                    "system",

                message:
                    "WSS connected."

            })
        );


        ws.on(
            "message",
            async raw => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    /*
                    =========================================
                     AUTH
                    =========================================
                    */

                    if (
                        data.type === "auth"
                    ) {

                        const user =
                            verifyToken(
                                data.token
                            );


                        if (!user) {

                            ws.send(
                                JSON.stringify({

                                    type:
                                        "auth",

                                    success:
                                        false,

                                    message:
                                        "Invalid token"

                                })
                            );

                            return;

                        }


                        ws.user =
                            user;

                        ws.authToken =
                            data.token;


                        ws.send(
                            JSON.stringify({

                                type:
                                    "auth",

                                success:
                                    true,

                                user

                            })
                        );


                        console.log(
                            `[WSS] Authenticated: ${user.username}`
                        );


                        return;

                    }


                    /*
                    =========================================
                     CHAT
                    =========================================
                    */

                    if (
                        data.type === "chat"
                    ) {

                        /*
                           IMPORTANT :
                           Le pseudo envoyé par le navigateur
                           n'est PAS considéré comme fiable.

                           Le serveur utilise le compte
                           authentifié.
                        */

                        if (!ws.user) {

                            ws.send(
                                JSON.stringify({

                                    type:
                                        "error",

                                    message:
                                        "Authentication required"

                                })
                            );

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
                            message.length >
                            MAX_MESSAGE_LENGTH
                        ) {

                            ws.send(
                                JSON.stringify({

                                    type:
                                        "error",

                                    message:
                                        "Message too long"

                                })
                            );

                            return;

                        }


                        const chatData = {

                            type:
                                "chat",

                            username:
                                ws.user.username,

                            message,

                            time:
                                nowISO()

                        };


                        /*
                           Sauvegarde GitHub.
                        */

                        try {

                            await saveChatLog(

                                ws.user.username,

                                message

                            );

                        }
                        catch(error) {

                            console.error(
                                "[CHAT LOG]",
                                error
                            );

                        }


                        /*
                           Broadcast à tous.
                        */

                        broadcast(
                            chatData
                        );


                        return;

                    }


                    /*
                    =========================================
                     PING
                    =========================================
                    */

                    if (
                        data.type === "ping"
                    ) {

                        ws.send(
                            JSON.stringify({

                                type:
                                    "pong",

                                time:
                                    nowISO()

                            })
                        );

                        return;

                    }


                    ws.send(
                        JSON.stringify({

                            type:
                                "error",

                            message:
                                "Unknown message type"

                        })
                    );

                }
                catch(error) {

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
                                    "Invalid JSON"

                            })
                        );

                    }
                    catch {}

                }

            }
        );


        ws.on(
            "close",
            () => {

                console.log(
                    "[WSS] Client disconnected"
                );

            }
        );


        ws.on(
            "error",
            error => {

                console.error(
                    "[WSS]",
                    error
                );

            }
        );

    }
);


/*
=========================================================
 BROADCAST
=========================================================
*/

function broadcast(data) {

    const message =
        JSON.stringify(data);


    wss.clients.forEach(
        client => {

            if (
                client.readyState ===
                WebSocket.OPEN
            ) {

                try {

                    client.send(
                        message
                    );

                }
                catch(error) {

                    console.error(
                        "[WSS BROADCAST]",
                        error
                    );

                }

            }

        }
    );

}


/*
=========================================================
 404
=========================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "Route introuvable.",

            path:
                req.path

        });

    }
);


/*
=========================================================
 ERROR HANDLER
=========================================================
*/

app.use(
    (error, req, res, next) => {

        console.error(
            "[EXPRESS ERROR]",
            error
        );


        res.status(500).json({

            success: false,

            error:
                error.message ||
                "Internal server error"

        });

    }
);


/*
=========================================================
 START SERVER
=========================================================
*/

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "========================================"
        );

        console.log(
            "       DAVID RANDOM V2 SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "GitHub:",
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Branch:",
            GITHUB_BRANCH
        );

        console.log(
            "GitHub token:",
            GITHUB_TOKEN
                ? "PRESENT"
                : "MISSING"
        );

        console.log(
            "WebSocket: ONLINE"
        );

        console.log(
            "Media routes:"
        );

        console.log(
            "GET /api/files/image"
        );

        console.log(
            "GET /api/files/music"
        );

        console.log(
            "GET /api/files/video"
        );

        console.log(
            "GET /api/files/chat-log"
        );

        console.log(
            "========================================"
        );

    }
);


/*
=========================================================
 KEEP-ALIVE / HEARTBEAT
=========================================================
*/

setInterval(
    () => {

        wss.clients.forEach(
            ws => {

                if (
                    ws.readyState ===
                    WebSocket.OPEN
                ) {

                    try {

                        ws.ping();

                    }
                    catch {}

                }

            }
        );

    },
    30000
);
