const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

/* =========================================================
   CONFIG
========================================================= */

const app = express();

const PORT = process.env.PORT || 10000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_OWNER =
    process.env.GITHUB_OWNER ||
    "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO ||
    "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH ||
    "main";

const ACCOUNTS_ENCRYPTION_KEY =
    process.env.ACCOUNTS_ENCRYPTION_KEY;

const MAX_FILE_SIZE =
    25 * 1024 * 1024;

const USERS_FILE =
    "accounts/users.enc";


/* =========================================================
   EXPRESS
========================================================= */

app.use(
    express.json({
        limit: "30mb"
    })
);


/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
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


/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(app);


/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
    new WebSocket.Server({
        server
    });


wss.on("connection", (socket) => {

    console.log(
        "[WSS] Nouveau client connecté"
    );

    socket.send(
        JSON.stringify({
            type: "system",
            message:
                "Connexion à David Random réussie."
        })
    );


    socket.on("message", (rawMessage) => {

        try {

            const data =
                JSON.parse(
                    rawMessage.toString()
                );


            if (
                data.type !== "chat"
            ) {
                return;
            }


            const username =
                String(
                    data.username ||
                    "Anonymous"
                )
                .trim()
                .substring(0, 24);


            const message =
                String(
                    data.message ||
                    ""
                )
                .trim()
                .substring(0, 500);


            if (!message) {
                return;
            }


            const chatMessage = {

                type: "chat",

                username:
                    username ||
                    "Anonymous",

                message,

                time:
                    new Date()
                        .toISOString()

            };


            broadcast(
                chatMessage
            );

        }

        catch (error) {

            console.error(
                "[WSS] Message invalide:",
                error
            );

            socket.send(
                JSON.stringify({
                    type: "system",
                    message:
                        "Message invalide."
                })
            );

        }

    });


    socket.on("close", () => {

        console.log(
            "[WSS] Client déconnecté"
        );

    });


    socket.on("error", (error) => {

        console.error(
            "[WSS] Socket error:",
            error
        );

    });

});


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(data) {

    const message =
        JSON.stringify(data);


    wss.clients.forEach(
        (client) => {

            if (
                client.readyState ===
                WebSocket.OPEN
            ) {

                client.send(
                    message
                );

            }

        }
    );

}


/* =========================================================
   GITHUB HELPERS
========================================================= */

function githubHeaders() {

    return {

        "Accept":
            "application/vnd.github+json",

        "Authorization":
            `Bearer ${GITHUB_TOKEN}`,

        "X-GitHub-Api-Version":
            "2022-11-28",

        "User-Agent":
            "David-Random-Server"

    };

}


function githubURL(apiPath) {

    return (
        "https://api.github.com" +
        apiPath
    );

}


/* =========================================================
   GITHUB REQUEST
========================================================= */

async function githubRequest(
    url,
    options = {}
) {

    const response =
        await fetch(
            url,
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

        const message =
            data?.message ||
            `GitHub HTTP ${response.status}`;


        const error =
            new Error(message);


        error.status =
            response.status;


        error.github =
            data;


        throw error;

    }


    return data;

}


/* =========================================================
   GITHUB CONFIG
========================================================= */

function githubConfigured() {

    return Boolean(
        GITHUB_TOKEN &&
        GITHUB_OWNER &&
        GITHUB_REPO
    );

}


/* =========================================================
   ACCOUNTS CONFIG
========================================================= */

function accountsConfigured() {

    return Boolean(
        githubConfigured() &&
        ACCOUNTS_ENCRYPTION_KEY
    );

}


/* =========================================================
   ENCRYPTION KEY
========================================================= */

function getEncryptionKey() {

    if (!ACCOUNTS_ENCRYPTION_KEY) {

        throw new Error(
            "ACCOUNTS_ENCRYPTION_KEY non configurée."
        );

    }


    const value =
        ACCOUNTS_ENCRYPTION_KEY.trim();


    /*
       HEX
       64 caractères = 32 octets
    */

    if (
        /^[0-9a-fA-F]{64}$/.test(value)
    ) {

        const key =
            Buffer.from(
                value,
                "hex"
            );


        if (key.length === 32) {
            return key;
        }

    }


    /*
       BASE64 / BASE64URL
    */

    try {

        let normalized =
            value
                .replace(/-/g, "+")
                .replace(/_/g, "/");


        while (
            normalized.length % 4 !== 0
        ) {

            normalized += "=";

        }


        const key =
            Buffer.from(
                normalized,
                "base64"
            );


        if (key.length === 32) {
            return key;
        }

    }

    catch {
        // erreur plus bas
    }


    throw new Error(
        "ACCOUNTS_ENCRYPTION_KEY doit représenter exactement 32 octets."
    );

}


/* =========================================================
   ENCRYPTION
========================================================= */

function encryptAccounts(accounts) {

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


    const plaintext =
        JSON.stringify(
            accounts
        );


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
        iv.toString("base64url"),
        authTag.toString("base64url"),
        encrypted.toString("base64url")
    ].join(":");

}


/* =========================================================
   DECRYPTION
========================================================= */

function decryptAccounts(
    encryptedText
) {

    const key =
        getEncryptionKey();


    const parts =
        String(
            encryptedText || ""
        )
        .trim()
        .split(":");


    if (
        parts.length !== 4 ||
        parts[0] !== "DR1"
    ) {

        throw new Error(
            "Format users.enc invalide."
        );

    }


    const iv =
        Buffer.from(
            parts[1],
            "base64url"
        );


    const authTag =
        Buffer.from(
            parts[2],
            "base64url"
        );


    const encrypted =
        Buffer.from(
            parts[3],
            "base64url"
        );


    if (
        iv.length !== 12 ||
        authTag.length !== 16
    ) {

        throw new Error(
            "Données de chiffrement invalides."
        );

    }


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


    const accounts =
        JSON.parse(
            decrypted.toString("utf8")
        );


    if (
        !Array.isArray(accounts)
    ) {

        throw new Error(
            "Base de comptes invalide."
        );

    }


    return accounts;

}


/* =========================================================
   PASSWORD HASH
========================================================= */

function hashPassword(password) {

    return new Promise(
        (resolve, reject) => {

            const salt =
                crypto.randomBytes(16);


            crypto.scrypt(
                password,
                salt,
                64,
                {
                    N: 16384,
                    r: 8,
                    p: 1
                },
                (error, derivedKey) => {

                    if (error) {

                        return reject(
                            error
                        );

                    }


                    resolve({

                        salt:
                            salt.toString(
                                "base64url"
                            ),

                        hash:
                            derivedKey.toString(
                                "base64url"
                            )

                    });

                }
            );

        }
    );

}


/* =========================================================
   PASSWORD VERIFY
========================================================= */

function verifyPassword(
    password,
    storedSalt,
    storedHash
) {

    return new Promise(
        (resolve, reject) => {

            try {

                const salt =
                    Buffer.from(
                        storedSalt,
                        "base64url"
                    );


                const expected =
                    Buffer.from(
                        storedHash,
                        "base64url"
                    );


                crypto.scrypt(
                    password,
                    salt,
                    expected.length,
                    {
                        N: 16384,
                        r: 8,
                        p: 1
                    },
                    (
                        error,
                        derivedKey
                    ) => {

                        if (error) {

                            return reject(
                                error
                            );

                        }


                        if (
                            derivedKey.length !==
                            expected.length
                        ) {

                            return resolve(
                                false
                            );

                        }


                        resolve(
                            crypto.timingSafeEqual(
                                derivedKey,
                                expected
                            )
                        );

                    }
                );

            }

            catch (error) {

                reject(error);

            }

        }
    );

}


/* =========================================================
   USERNAME
========================================================= */

function normalizeUsername(username) {

    return String(
        username || ""
    )
    .trim()
    .toLowerCase();

}


function validUsername(username) {

    return /^[a-zA-Z0-9_-]{3,24}$/
        .test(username);

}


/* =========================================================
   PASSWORD
========================================================= */

function validPassword(password) {

    return (
        typeof password === "string" &&
        password.length >= 6 &&
        password.length <= 128
    );

}


/* =========================================================
   GET USERS
========================================================= */

async function getUsersFile() {

    if (!accountsConfigured()) {

        throw new Error(
            "Système de comptes non configuré."
        );

    }


    const url =
        githubURL(
            `/repos/${encodeURIComponent(
                GITHUB_OWNER
            )}/${encodeURIComponent(
                GITHUB_REPO
            )}/contents/${USERS_FILE}?ref=${encodeURIComponent(
                GITHUB_BRANCH
            )}`
        );


    try {

        const data =
            await githubRequest(
                url
            );


        if (
            !data ||
            !data.content
        ) {

            throw new Error(
                "users.enc vide ou invalide."
            );

        }


        const encoded =
            String(
                data.content
            )
            .replace(
                /\s/g,
                ""
            );


        const encryptedText =
            Buffer.from(
                encoded,
                "base64"
            )
            .toString(
                "utf8"
            );


        const users =
            decryptAccounts(
                encryptedText
            );


        return {

            users,

            sha:
                data.sha

        };

    }

    catch (error) {

        if (
            error.status === 404
        ) {

            return {

                users: [],

                sha: null

            };

        }


        throw error;

    }

}


/* =========================================================
   SAVE USERS
========================================================= */

async function saveUsersFile(
    users,
    existingSha = null
) {

    if (!accountsConfigured()) {

        throw new Error(
            "Système de comptes non configuré."
        );

    }


    const encrypted =
        encryptAccounts(
            users
        );


    const content =
        Buffer.from(
            encrypted,
            "utf8"
        )
        .toString(
            "base64"
        );


    const body = {

        message:
            existingSha
                ? "Update encrypted accounts"
                : "Create encrypted accounts",

        content,

        branch:
            GITHUB_BRANCH

    };


    if (existingSha) {

        body.sha =
            existingSha;

    }


    const url =
        githubURL(
            `/repos/${encodeURIComponent(
                GITHUB_OWNER
            )}/${encodeURIComponent(
                GITHUB_REPO
            )}/contents/${USERS_FILE}`
        );


    return await githubRequest(
        url,
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
   SESSION TOKENS
========================================================= */

/*
   Les tokens sont conservés uniquement en mémoire
   du serveur.

   Si Render redémarre :
   les anciennes sessions sont invalidées.
*/

const sessions =
    new Map();


function createSession(username) {

    const token =
        crypto.randomBytes(32)
            .toString("base64url");


    sessions.set(
        token,
        {
            username,
            createdAt:
                Date.now()
        }
    );


    return token;

}


function getSessionUser(req) {

    const authorization =
        String(
            req.headers.authorization || ""
        );


    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {

        return null;

    }


    const token =
        authorization
            .slice(7)
            .trim();


    if (!token) {
        return null;
    }


    const session =
        sessions.get(token);


    if (!session) {
        return null;
    }


    return session.username;

}


/* =========================================================
   ACCOUNT REGISTER
========================================================= */

app.post(
    "/api/account/register",
    async (req, res) => {

        try {

            if (!accountsConfigured()) {

                return res.status(500).json({

                    success: false,

                    error:
                        "Système de comptes non configuré sur Render."

                });

            }


            const username =
                normalizeUsername(
                    req.body?.username
                );


            const password =
                String(
                    req.body?.password ||
                    ""
                );


            if (
                !validUsername(username)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Pseudo invalide. Utilise 3 à 24 caractères : lettres, chiffres, _ ou -."

                });

            }


            if (
                !validPassword(password)
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Mot de passe invalide. Il doit contenir entre 6 et 128 caractères."

                });

            }


            console.log(
                "[ACCOUNT] Inscription:",
                username
            );


            const database =
                await getUsersFile();


            const exists =
                database.users.some(
                    user =>
                        user.username ===
                        username
                );


            if (exists) {

                return res.status(409).json({

                    success: false,

                    error:
                        "Ce pseudo existe déjà."

                });

            }


            const passwordData =
                await hashPassword(
                    password
                );


            const user = {

                username,

                passwordHash:
                    passwordData.hash,

                passwordSalt:
                    passwordData.salt,

                createdAt:
                    new Date()
                        .toISOString()

            };


            database.users.push(
                user
            );


            await saveUsersFile(
                database.users,
                database.sha
            );


            const token =
                createSession(
                    username
                );


            console.log(
                "[ACCOUNT] Compte créé:",
                username
            );


            return res.json({

                success: true,

                message:
                    "Compte créé avec succès.",

                username,

                token

            });

        }

        catch (error) {

            console.error(
                "[ACCOUNT REGISTER]",
                error
            );


            return res.status(
                error.status || 500
            )
            .json({

                success: false,

                error:
                    error.message ||
                    "Erreur lors de la création du compte."

            });

        }

    }
);


/* =========================================================
   ACCOUNT LOGIN
========================================================= */

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            if (!accountsConfigured()) {

                return res.status(500).json({

                    success: false,

                    error:
                        "Système de comptes non configuré sur Render."

                });

            }


            const username =
                normalizeUsername(
                    req.body?.username
                );


            const password =
                String(
                    req.body?.password ||
                    ""
                );


            if (!username || !password) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Pseudo ou mot de passe manquant."

                });

            }


            console.log(
                "[ACCOUNT] Tentative connexion:",
                username
            );


            const database =
                await getUsersFile();


            const user =
                database.users.find(
                    account =>
                        account.username ===
                        username
                );


            if (!user) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Pseudo ou mot de passe incorrect."

                });

            }


            const valid =
                await verifyPassword(
                    password,
                    user.passwordSalt,
                    user.passwordHash
                );


            if (!valid) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Pseudo ou mot de passe incorrect."

                });

            }


            const token =
                createSession(
                    username
                );


            console.log(
                "[ACCOUNT] Connexion réussie:",
                username
            );


            return res.json({

                success: true,

                message:
                    "Connexion réussie.",

                username,

                token

            });

        }

        catch (error) {

            console.error(
                "[ACCOUNT LOGIN]",
                error
            );


            return res.status(
                error.status || 500
            )
            .json({

                success: false,

                error:
                    error.message ||
                    "Erreur lors de la connexion."

            });

        }

    }
);


/* =========================================================
   ACCOUNT ME
========================================================= */

app.get(
    "/api/account/me",
    (req, res) => {

        const username =
            getSessionUser(req);


        if (!username) {

            return res.status(401).json({

                success: false,

                error:
                    "Session invalide ou absente."

            });

        }


        return res.json({

            success: true,

            username

        });

    }
);


/* =========================================================
   ACCOUNT LOGOUT
========================================================= */

app.post(
    "/api/account/logout",
    (req, res) => {

        const authorization =
            String(
                req.headers.authorization || ""
            );


        if (
            authorization.startsWith(
                "Bearer "
            )
        ) {

            const token =
                authorization
                    .slice(7)
                    .trim();


            sessions.delete(
                token
            );

        }


        return res.json({

            success: true,

            message:
                "Déconnexion réussie."

        });

    }
);


/* =========================================================
   ACCOUNT STATUS
========================================================= */

app.get(
    "/api/account/status",
    async (req, res) => {

        res.json({

            success: true,

            configured:
                accountsConfigured(),

            encryptedFile:
                USERS_FILE,

            encryption:
                "AES-256-GCM",

            passwordHash:
                "scrypt",

            sessions:
                sessions.size

        });

    }
);


/* =========================================================
   SAFE FILENAME
========================================================= */

function safeFilename(filename) {

    let name =
        path.basename(
            String(filename || "")
        );


    name =
        name.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
        );


    name =
        name.replace(
            /\.{2,}/g,
            "."
        );


    if (!name) {
        name = "file";
    }


    return name.substring(
        0,
        180
    );

}


/* =========================================================
   VALIDATE FOLDER
========================================================= */

function validFolder(folder) {

    return [
        "image",
        "music",
        "video"
    ].includes(
        folder
    );

}


/* =========================================================
   API STATUS
========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

        const configured =
            githubConfigured();


        let githubOnline =
            false;


        let githubError =
            null;


        if (configured) {

            try {

                await githubRequest(
                    githubURL(
                        `/repos/${encodeURIComponent(
                            GITHUB_OWNER
                        )}/${encodeURIComponent(
                            GITHUB_REPO
                        )}`
                    )
                );


                githubOnline =
                    true;

            }

            catch (error) {

                githubError =
                    error.message;

            }

        }


        res.json({

            online: true,

            name:
                "David Random",

            server:
                "Render",

            api:
                true,

            websocket:
                true,

            github:
                githubOnline,

            githubConfigured:
                configured,

            accountsConfigured:
                accountsConfigured(),

            accountsFile:
                USERS_FILE,

            encryption:
                "AES-256-GCM",

            passwordHash:
                "scrypt",

            activeSessions:
                sessions.size,

            repository:
                `${GITHUB_OWNER}/${GITHUB_REPO}`,

            branch:
                GITHUB_BRANCH,

            time:
                new Date().toISOString(),

            ...(githubError
                ? {
                    githubError
                }
                : {})

        });

    }
);


/* =========================================================
   LIST GITHUB FOLDER
========================================================= */

app.get(
    "/api/files/:folder",
    async (req, res) => {

        const folder =
            String(
                req.params.folder || ""
            )
            .toLowerCase();


        if (!validFolder(folder)) {

            return res.status(400).json({

                success: false,

                error:
                    "Dossier invalide."

            });

        }


        if (!githubConfigured()) {

            return res.status(500).json({

                success: false,

                error:
                    "GITHUB_TOKEN non configuré."

            });

        }


        try {

            const url =
                githubURL(
                    `/repos/${encodeURIComponent(
                        GITHUB_OWNER
                    )}/${encodeURIComponent(
                        GITHUB_REPO
                    )}/contents/${folder}?ref=${encodeURIComponent(
                        GITHUB_BRANCH
                    )}`
                );


            const data =
                await githubRequest(
                    url
                );


            const files =
                Array.isArray(data)
                    ? data
                        .filter(
                            file =>
                                file.type ===
                                "file"
                        )
                        .map(
                            file => ({

                                name:
                                    file.name,

                                size:
                                    file.size,

                                download:
                                    file.download_url,

                                path:
                                    file.path

                            })
                        )
                    : [];


            res.json({

                success: true,

                folder,

                files

            });

        }

        catch (error) {

            console.error(
                "[GITHUB LIST]",
                error
            );


            if (
                error.status === 404
            ) {

                return res.json({

                    success: true,

                    folder,

                    files: []

                });

            }


            res.status(
                error.status || 500
            )
            .json({

                success: false,

                error:
                    error.message

            });

        }

    }
);


/* =========================================================
   UPLOAD TO GITHUB
========================================================= */

app.post(
    "/api/upload",
    async (req, res) => {

        try {

            if (!githubConfigured()) {

                return res.status(500).json({

                    success: false,

                    error:
                        "GITHUB_TOKEN non configuré sur Render."

                });

            }


            const {
                filename,
                content,
                folder
            } = req.body;


            if (!filename) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Nom de fichier manquant."

                });

            }


            if (!content) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Contenu du fichier manquant."

                });

            }


            if (!validFolder(folder)) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Dossier invalide."

                });

            }


            const safeName =
                safeFilename(
                    filename
                );


            const match =
                String(content).match(
                    /^data:[^;]+;base64,(.+)$/s
                );


            if (!match) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Format Base64 invalide."

                });

            }


            const base64 =
                match[1];


            const buffer =
                Buffer.from(
                    base64,
                    "base64"
                );


            if (
                buffer.length >
                MAX_FILE_SIZE
            ) {

                return res.status(413).json({

                    success: false,

                    error:
                        "Fichier trop gros. Maximum 25 MB."

                });

            }


            const githubPath =
                `${folder}/${safeName}`;


            console.log(
                "[UPLOAD]",
                githubPath,
                buffer.length,
                "bytes"
            );


            let existingSha =
                null;


            try {

                const existing =
                    await githubRequest(
                        githubURL(
                            `/repos/${encodeURIComponent(
                                GITHUB_OWNER
                            )}/${encodeURIComponent(
                                GITHUB_REPO
                            )}/contents/${githubPath}?ref=${encodeURIComponent(
                                GITHUB_BRANCH
                            )}`
                        )
                    );


                existingSha =
                    existing.sha;

            }

            catch (error) {

                if (
                    error.status !== 404
                ) {

                    throw error;

                }

            }


            const body = {

                message:
                    existingSha
                        ? `Update ${githubPath}`
                        : `Upload ${githubPath}`,

                content:
                    buffer.toString(
                        "base64"
                    ),

                branch:
                    GITHUB_BRANCH

            };


            if (existingSha) {

                body.sha =
                    existingSha;

            }


            const result =
                await githubRequest(
                    githubURL(
                        `/repos/${encodeURIComponent(
                            GITHUB_OWNER
                        )}/${encodeURIComponent(
                            GITHUB_REPO
                        )}/contents/${githubPath}`
                    ),
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


            const download =
                `https://raw.githubusercontent.com/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/` +
                `${GITHUB_BRANCH}/` +
                `${githubPath}`;


            res.json({

                success: true,

                filename:
                    safeName,

                folder,

                path:
                    githubPath,

                download,

                sha:
                    result.content?.sha ||
                    null

            });

        }

        catch (error) {

            console.error(
                "[UPLOAD ERROR]",
                error
            );


            res.status(
                error.status || 500
            )
            .json({

                success: false,

                error:
                    error.message ||
                    "Erreur upload GitHub."

            });

        }

    }
);


/* =========================================================
   ROOT
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(`

<!DOCTYPE html>

<html lang="fr">

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>David Random Server</title>

<style>

body {

    background:#050505;

    color:#35ff5a;

    font-family:monospace;

    padding:30px;

}

h1 {

    color:#00ffff;

}

.ok {

    color:#35ff5a;

}

.bad {

    color:#ff4444;

}

a {

    color:#00ffff;

}

</style>

</head>

<body>

<h1>DAVID RANDOM SERVER</h1>

<p class="ok">
Render : ONLINE
</p>

<p class="ok">
API : ONLINE
</p>

<p class="ok">
WebSocket : ONLINE
</p>

<p class="${
    accountsConfigured()
        ? "ok"
        : "bad"
}">
Encrypted Accounts :
${
    accountsConfigured()
        ? "ONLINE"
        : "NOT CONFIGURED"
}
</p>

<p>
Repository :
${GITHUB_OWNER}/${GITHUB_REPO}
</p>

<p>
Encrypted file :
${USERS_FILE}
</p>

<hr>

<p>
<a href="/api/status">
API STATUS
</a>
</p>

<p>
<a href="/api/account/status">
ACCOUNT STATUS
</a>
</p>

</body>

</html>

        `);

    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (err, req, res, next) => {

        console.error(
            "[EXPRESS ERROR]",
            err
        );


        if (
            err.type ===
            "entity.too.large"
        ) {

            return res.status(413).json({

                success: false,

                error:
                    "Requête trop volumineuse."

            });

        }


        res.status(500).json({

            success: false,

            error:
                "Erreur serveur."

        });

    }
);


/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "================================="
        );

        console.log(
            " DAVID RANDOM SERVER"
        );

        console.log(
            "================================="
        );

        console.log(
            "HTTP :",
            PORT
        );

        console.log(
            "WSS  : ENABLED"
        );

        console.log(
            "GitHub :",
            githubConfigured()
                ? "CONFIGURED"
                : "NOT CONFIGURED"
        );

        console.log(
            "Accounts encryption :",
            ACCOUNTS_ENCRYPTION_KEY
                ? "CONFIGURED"
                : "NOT CONFIGURED"
        );

        console.log(
            "Repository :",
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Encrypted accounts :",
            USERS_FILE
        );

        console.log(
            "Active sessions :",
            sessions.size
        );

        console.log(
            "================================="
        );

    }
);
