"use strict";

/*
===========================================================
DAVID RANDOM V2
SERVER COMPLET
===========================================================

Fonctions :
- Express
- CORS
- GitHub Storage
- accounts.json
- users.enc
- sessions persistantes via tokens signés
- Login / Register / Logout
- /api/account/me
- Profile picture URL
- Profile picture upload
- Media upload
- Images / Music / Videos
- Chat logs
- WebSocket WSS
- Render

IMPORTANT :

ENCRYPTION_KEY doit être une vraie clé secrète.

NE METS PAS le contenu de users.enc dans ENCRYPTION_KEY.

Exemple :

ENCRYPTION_KEY=une-longue-cle-secrete-random

===========================================================
*/

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const multer = require("multer");
const WebSocket = require("ws");
const http = require("http");


/*
===========================================================
APP
===========================================================
*/

const app = express();

const server = http.createServer(app);

const PORT =
    process.env.PORT || 10000;


/*
===========================================================
CONFIGURATION
===========================================================
*/

const GITHUB_TOKEN =
    process.env.GITHUB_TOKEN;

const GITHUB_OWNER =
    process.env.GITHUB_OWNER;

const GITHUB_REPO =
    process.env.GITHUB_REPO;

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH || "main";

const ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY;

const ALLOWED_ORIGIN =
    process.env.ALLOWED_ORIGIN || "*";


/*
===========================================================
GITHUB
===========================================================
*/

const GITHUB_API =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;


const githubHeaders = {
    "Authorization":
        `Bearer ${GITHUB_TOKEN}`,

    "Accept":
        "application/vnd.github+json",

    "X-GitHub-Api-Version":
        "2022-11-28",

    "User-Agent":
        "DAVID-RANDOM"
};


if (!GITHUB_TOKEN) {
    console.warn(
        "[CONFIG] GITHUB_TOKEN absent"
    );
}

if (!GITHUB_OWNER) {
    console.warn(
        "[CONFIG] GITHUB_OWNER absent"
    );
}

if (!GITHUB_REPO) {
    console.warn(
        "[CONFIG] GITHUB_REPO absent"
    );
}

if (!ENCRYPTION_KEY) {
    console.warn(
        "[CONFIG] ENCRYPTION_KEY absent"
    );
}


/*
===========================================================
EXPRESS
===========================================================
*/

app.use(
    cors({
        origin:
            ALLOWED_ORIGIN === "*"
                ? true
                : ALLOWED_ORIGIN,

        credentials: true
    })
);


app.use(
    express.json({
        limit: "5mb"
    })
);


app.use(
    express.urlencoded({
        extended: true,
        limit: "5mb"
    })
);


/*
===========================================================
MULTER
===========================================================
*/

const upload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                25 * 1024 * 1024
        }
    });


/*
===========================================================
MEMORY
===========================================================
*/

/*
Anciennes sessions conservées temporairement
pour ne pas casser les tokens déjà créés
avant cette version.
*/

const sessions =
    new Map();


const connectedSockets =
    new Set();


/*
===========================================================
CONSTANTES
===========================================================
*/

const ACCOUNTS_FILE =
    "accounts/accounts.json";

const USERS_FILE =
    "accounts/users.enc";

const CHAT_FOLDER =
    "chat-log";

const MAX_CHAT_LOG_SIZE =
    15 * 1024 * 1024;

const MAX_UPLOAD_SIZE =
    25 * 1024 * 1024;


/*
===========================================================
UTILITAIRES
===========================================================
*/

function randomId(length = 24) {

    return crypto
        .randomBytes(length)
        .toString("hex");

}


function normalizeUsername(username) {

    return String(
        username || ""
    )
        .trim()
        .toLowerCase();

}


function publicUser(user) {

    return {
        id:
            user.id,

        username:
            user.username,

        profile_picture:
            user.profile_picture || null,

        created_at:
            user.created_at
    };

}


/*
===========================================================
PASSWORD
===========================================================
*/

function hashPassword(
    password,
    salt
) {

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


function createPasswordHash(
    password
) {

    const salt =
        crypto
            .randomBytes(32)
            .toString("hex");


    const hash =
        hashPassword(
            password,
            salt
        );


    return {
        salt,
        hash
    };

}


function verifyPassword(
    password,
    salt,
    hash
) {

    try {

        const calculated =
            hashPassword(
                password,
                salt
            );


        const a =
            Buffer.from(
                calculated,
                "hex"
            );


        const b =
            Buffer.from(
                hash,
                "hex"
            );


        if (
            a.length !==
            b.length
        ) {
            return false;
        }


        return crypto
            .timingSafeEqual(
                a,
                b
            );

    } catch {

        return false;

    }

}


/*
===========================================================
ENCRYPTION KEY
===========================================================
*/

function getEncryptionKey() {

    if (!ENCRYPTION_KEY) {

        throw new Error(
            "ENCRYPTION_KEY NOT CONFIGURED"
        );

    }


    return crypto
        .createHash("sha256")
        .update(
            String(
                ENCRYPTION_KEY
            ),
            "utf8"
        )
        .digest();

}


/*
===========================================================
ENCRYPT USERS
===========================================================
*/

function encryptUsers(data) {

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
        JSON.stringify(data);


    const encrypted =
        Buffer.concat([
            cipher.update(
                json,
                "utf8"
            ),

            cipher.final()
        ]);


    const tag =
        cipher.getAuthTag();


    return [
        "DR1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url")
    ].join(":");

}


/*
===========================================================
DECRYPT USERS
===========================================================
*/

function decryptUsers(text) {

    const key =
        getEncryptionKey();


    const parts =
        String(text)
            .trim()
            .split(":");


    if (
        parts.length !== 4 ||
        parts[0] !== "DR1"
    ) {

        throw new Error(
            "INVALID USERS ENC FORMAT"
        );

    }


    const iv =
        Buffer.from(
            parts[1],
            "base64url"
        );


    const tag =
        Buffer.from(
            parts[2],
            "base64url"
        );


    const encrypted =
        Buffer.from(
            parts[3],
            "base64url"
        );


    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );


    decipher.setAuthTag(tag);


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

}


/*
===========================================================
GITHUB GET
===========================================================
*/

async function githubGet(path) {

    const response =
        await fetch(
            `${GITHUB_API}/${path}?ref=${encodeURIComponent(
                GITHUB_BRANCH
            )}`,
            {
                headers:
                    githubHeaders
            }
        );


    if (
        response.status === 404
    ) {

        return null;

    }


    if (
        !response.ok
    ) {

        const text =
            await response.text();


        throw new Error(
            `GITHUB GET ${response.status}: ${text}`
        );

    }


    return await response.json();

}


/*
===========================================================
GITHUB READ TEXT
===========================================================
*/

async function githubReadText(
    path
) {

    const file =
        await githubGet(path);


    if (!file) {
        return null;
    }


    if (!file.content) {

        throw new Error(
            "GITHUB FILE HAS NO CONTENT"
        );

    }


    return Buffer.from(
        file.content.replace(
            /\n/g,
            ""
        ),
        "base64"
    ).toString(
        "utf8"
    );

}


/*
===========================================================
GITHUB WRITE TEXT
===========================================================
*/

async function githubWriteText(
    path,
    content,
    message
) {

    const existing =
        await githubGet(path);


    const body = {

        message,

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
        existing &&
        existing.sha
    ) {

        body.sha =
            existing.sha;

    }


    const response =
        await fetch(
            `${GITHUB_API}/${path}`,
            {
                method:
                    "PUT",

                headers: {
                    ...githubHeaders,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        body
                    )
            }
        );


    if (
        !response.ok
    ) {

        const text =
            await response.text();


        throw new Error(
            `GITHUB WRITE ${response.status}: ${text}`
        );

    }


    return await response.json();

}


/*
===========================================================
GITHUB WRITE BUFFER
===========================================================
*/

async function githubWriteBuffer(
    path,
    buffer,
    message
) {

    const existing =
        await githubGet(path);


    const body = {

        message,

        content:
            buffer.toString(
                "base64"
            ),

        branch:
            GITHUB_BRANCH

    };


    if (
        existing &&
        existing.sha
    ) {

        body.sha =
            existing.sha;

    }


    const response =
        await fetch(
            `${GITHUB_API}/${path}`,
            {
                method:
                    "PUT",

                headers: {
                    ...githubHeaders,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(
                        body
                    )
            }
        );


    if (
        !response.ok
    ) {

        const text =
            await response.text();


        throw new Error(
            `GITHUB WRITE ${response.status}: ${text}`
        );

    }


    return await response.json();

}


/*
===========================================================
ACCOUNTS DATABASE
===========================================================
*/

async function loadAccounts() {

    const text =
        await githubReadText(
            ACCOUNTS_FILE
        );


    if (!text) {

        return {
            users: []
        };

    }


    let data;


    try {

        data =
            JSON.parse(text);

    } catch {

        throw new Error(
            "ACCOUNTS DATABASE CORRUPTED"
        );

    }


    if (
        !Array.isArray(
            data.users
        )
    ) {

        data.users = [];

    }


    return data;

}


/*
===========================================================
SAVE ACCOUNTS
===========================================================
*/

async function saveAccounts(
    accounts
) {

    await githubWriteText(

        ACCOUNTS_FILE,

        JSON.stringify(
            accounts,
            null,
            2
        ),

        "Update accounts.json"

    );

}


/*
===========================================================
LOAD USERS
===========================================================
*/

async function loadEncryptedUsers() {

    const text =
        await githubReadText(
            USERS_FILE
        );


    if (!text) {

        return {
            users: []
        };

    }


    try {

        const data =
            decryptUsers(
                text
            );


        if (
            !Array.isArray(
                data.users
            )
        ) {

            data.users = [];

        }


        return data;

    } catch (error) {

        console.error(
            "[USERS] Decryption error:",
            error.message
        );


        throw new Error(
            "USERS DATABASE CORRUPTED OR ENCRYPTION KEY INVALID"
        );

    }

}


/*
===========================================================
SAVE USERS
===========================================================
*/

async function saveEncryptedUsers(
    data
) {

    const encrypted =
        encryptUsers(
            data
        );


    await githubWriteText(

        USERS_FILE,

        encrypted,

        "Update encrypted users database"

    );

}


/*
===========================================================
TOKEN SYSTEM
===========================================================

IMPORTANT :

Le token n'est plus seulement stocké dans :

    const sessions = new Map();

Il est maintenant signé.

Format :

base64(payload).signature

Payload :

{
    v: 1,
    uid: "...",
    exp: 123456789
}

Donc Render peut redémarrer et le token
reste vérifiable.
===========================================================
*/

const SESSION_DURATION =
    30 * 24 * 60 * 60 * 1000;


/*
===========================================================
TOKEN SIGNATURE
===========================================================
*/

function signTokenPayload(
    encodedPayload
) {

    const key =
        getEncryptionKey();


    return crypto
        .createHmac(
            "sha256",
            key
        )
        .update(
            encodedPayload
        )
        .digest(
            "base64url"
        );

}


/*
===========================================================
CREATE TOKEN
===========================================================
*/

function createToken(
    userId
) {

    const payload = {

        v: 1,

        uid:
            userId,

        exp:
            Date.now() +
            SESSION_DURATION

    };


    const encodedPayload =
        Buffer
            .from(
                JSON.stringify(
                    payload
                ),
                "utf8"
            )
            .toString(
                "base64url"
            );


    const signature =
        signTokenPayload(
            encodedPayload
        );


    return (
        encodedPayload +
        "." +
        signature
    );

}


/*
===========================================================
 VERIFY TOKEN
===========================================================
*/

function verifyPersistentToken(
    token
) {

    try {

        if (
            !token ||
            typeof token !==
            "string"
        ) {

            return null;

        }


        const parts =
            token.split(".");


        if (
            parts.length !== 2
        ) {

            return null;

        }


        const [
            encodedPayload,
            signature
        ] = parts;


        const expected =
            signTokenPayload(
                encodedPayload
            );


        const a =
            Buffer.from(
                signature
            );


        const b =
            Buffer.from(
                expected
            );


        if (
            a.length !==
            b.length
        ) {

            return null;

        }


        if (
            !crypto.timingSafeEqual(
                a,
                b
            )
        ) {

            return null;

        }


        const payload =
            JSON.parse(
                Buffer
                    .from(
                        encodedPayload,
                        "base64url"
                    )
                    .toString(
                        "utf8"
                    )
            );


        if (
            payload.v !== 1
        ) {

            return null;

        }


        if (
            !payload.uid ||
            !payload.exp
        ) {

            return null;

        }


        if (
            Date.now() >
            Number(
                payload.exp
            )
        ) {

            return null;

        }


        return payload;

    } catch {

        return null;

    }

}


/*
===========================================================
GET TOKEN
===========================================================
*/

function getTokenFromRequest(
    req
) {

    const auth =
        req.headers.authorization ||
        "";


    if (
        !auth.startsWith(
            "Bearer "
        )
    ) {

        return null;

    }


    return auth
        .substring(7)
        .trim() ||
        null;

}


/*
===========================================================
AUTHENTICATE REQUEST
===========================================================
*/

async function authenticateRequest(
    req
) {

    const token =
        getTokenFromRequest(
            req
        );


    if (!token) {

        return null;

    }


    /*
    -------------------------------------------------------
    1. Nouveau token persistant
    -------------------------------------------------------
    */

    const persistent =
        verifyPersistentToken(
            token
        );


    let userId = null;


    if (persistent) {

        userId =
            persistent.uid;

    }


    /*
    -------------------------------------------------------
    2. Ancien token en RAM
    -------------------------------------------------------
    */

    if (!userId) {

        const oldSession =
            sessions.get(
                token
            );


        if (
            oldSession
        ) {

            userId =
                oldSession.userId;

        }

    }


    if (!userId) {

        return null;

    }


    const accounts =
        await loadAccounts();


    const user =
        accounts.users.find(
            u =>
                u.id ===
                userId
        );


    if (!user) {

        sessions.delete(
            token
        );

        return null;

    }


    return {

        token,

        user

    };

}


/*
===========================================================
DATABASE INIT
===========================================================
*/

async function ensureDatabase() {

    if (
        !GITHUB_TOKEN ||
        !GITHUB_OWNER ||
        !GITHUB_REPO ||
        !ENCRYPTION_KEY
    ) {

        console.warn(
            "[DATABASE] Configuration GitHub incomplète."
        );

        return;

    }


    try {

        const accounts =
            await loadAccounts();


        const accountsFile =
            await githubGet(
                ACCOUNTS_FILE
            );


        if (!accountsFile) {

            await saveAccounts(
                accounts
            );

            console.log(
                "[DATABASE] Created accounts.json"
            );

        }


        const usersFile =
            await githubGet(
                USERS_FILE
            );


        if (!usersFile) {

            await saveEncryptedUsers({
                users: []
            });


            console.log(
                "[DATABASE] Created users.enc"
            );

        }


        console.log(
            "[DATABASE] GitHub database ready."
        );

    } catch (error) {

        console.error(
            "[DATABASE] INITIALIZATION ERROR:",
            error
        );

    }

}


/*
===========================================================
STATUS
===========================================================
*/

app.get(
    "/api/status",
    async (
        req,
        res
    ) => {

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

                service:
                    "DAVID RANDOM V2",

                users,

                github:
                    Boolean(
                        GITHUB_TOKEN &&
                        GITHUB_OWNER &&
                        GITHUB_REPO
                    ),

                websocket: true,

                persistentSessions:
                    true

            });

        } catch (error) {

            console.error(
                "[STATUS]",
                error
            );


            res.status(500).json({

                online: false,

                error:
                    error.message

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
    async (
        req,
        res
    ) => {

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

                return res.status(
                    400
                ).json({

                    error:
                        "USERNAME MUST BE 3-24 CHARACTERS"

                });

            }


            if (
                !/^[a-zA-Z0-9_-]+$/.test(
                    username
                )
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "USERNAME CAN ONLY CONTAIN LETTERS, NUMBERS, _ AND -"

                });

            }


            if (
                password.length < 8 ||
                password.length > 128
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "PASSWORD MUST BE 8-128 CHARACTERS"

                });

            }


            if (
                profilePicture &&
                profilePicture.length >
                2000
            ) {

                return res.status(
                    400
                ).json({

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

                return res.status(
                    400
                ).json({

                    error:
                        "PROFILE PICTURE MUST BE A HTTP/HTTPS URL"

                });

            }


            const accounts =
                await loadAccounts();


            const normalized =
                normalizeUsername(
                    username
                );


            const exists =
                accounts.users.some(
                    u =>
                        normalizeUsername(
                            u.username
                        ) ===
                        normalized
                );


            if (exists) {

                return res.status(
                    409
                ).json({

                    error:
                        "USERNAME ALREADY EXISTS"

                });

            }


            const {
                salt,
                hash
            } =
                createPasswordHash(
                    password
                );


            const user = {

                id:
                    randomId(12),

                username,

                username_normalized:
                    normalized,

                password_hash:
                    hash,

                password_salt:
                    salt,

                profile_picture:
                    profilePicture ||
                    null,

                created_at:
                    new Date()
                        .toISOString()

            };


            accounts.users.push({

                id:
                    user.id,

                username:
                    user.username,

                username_normalized:
                    user.username_normalized,

                profile_picture:
                    user.profile_picture,

                created_at:
                    user.created_at

            });


            const encryptedUsers =
                await loadEncryptedUsers();


            encryptedUsers.users.push({

                id:
                    user.id,

                username_normalized:
                    user.username_normalized,

                password_hash:
                    user.password_hash,

                password_salt:
                    user.password_salt

            });


            await saveAccounts(
                accounts
            );


            await saveEncryptedUsers(
                encryptedUsers
            );


            const token =
                createToken(
                    user.id
                );


            /*
            Garder aussi le token en RAM
            */

            sessions.set(
                token,
                {
                    userId:
                        user.id,

                    createdAt:
                        Date.now()
                }
            );


            console.log(
                `[AUTH] Account created: ${username}`
            );


            res.status(201).json({

                success: true,

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


            res.status(500).json({

                error:
                    error.message

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
    async (
        req,
        res
    ) => {

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


            if (
                !username ||
                !password
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "USERNAME AND PASSWORD REQUIRED"

                });

            }


            const normalized =
                normalizeUsername(
                    username
                );


            const accounts =
                await loadAccounts();


            const publicAccount =
                accounts.users.find(
                    u =>
                        normalizeUsername(
                            u.username
                        ) ===
                        normalized
                );


            if (!publicAccount) {

                return res.status(
                    401
                ).json({

                    error:
                        "INVALID USERNAME OR PASSWORD"

                });

            }


            const encryptedUsers =
                await loadEncryptedUsers();


            const secureUser =
                encryptedUsers.users.find(
                    u =>
                        u.id ===
                        publicAccount.id
                );


            if (!secureUser) {

                return res.status(
                    401
                ).json({

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

                return res.status(
                    401
                ).json({

                    error:
                        "INVALID USERNAME OR PASSWORD"

                });

            }


            /*
            NOUVEAU TOKEN PERSISTANT
            */

            const token =
                createToken(
                    publicAccount.id
                );


            sessions.set(
                token,
                {
                    userId:
                        publicAccount.id,

                    createdAt:
                        Date.now()
                }
            );


            console.log(
                `[AUTH] Login: ${publicAccount.username}`
            );


            res.json({

                success: true,

                token,

                user:
                    publicUser(
                        publicAccount
                    )

            });

        } catch (error) {

            console.error(
                "[LOGIN]",
                error
            );


            res.status(500).json({

                error:
                    error.message

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
    async (
        req,
        res
    ) => {

        const token =
            getTokenFromRequest(
                req
            );


        if (token) {

            sessions.delete(
                token
            );

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
    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            res.json({

                success: true,

                user:
                    publicUser(
                        auth.user
                    )

            });

        } catch (error) {

            console.error(
                "[ME]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
PROFILE PICTURE URL
===========================================================
*/

app.post(
    "/api/account/profile-picture",
    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            let profilePicture =
                req.body.profile_picture;


            if (
                profilePicture ===
                undefined ||
                profilePicture ===
                null
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "PROFILE PICTURE REQUIRED"

                });

            }


            profilePicture =
                String(
                    profilePicture
                ).trim();


            if (
                profilePicture.length >
                2000
            ) {

                return res.status(
                    400
                ).json({

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

                return res.status(
                    400
                ).json({

                    error:
                        "PROFILE PICTURE MUST BE A HTTP/HTTPS URL"

                });

            }


            const accounts =
                await loadAccounts();


            const user =
                accounts.users.find(
                    u =>
                        u.id ===
                        auth.user.id
                );


            if (!user) {

                return res.status(
                    404
                ).json({

                    error:
                        "USER NOT FOUND"

                });

            }


            user.profile_picture =
                profilePicture ||
                null;


            await saveAccounts(
                accounts
            );


            broadcastUserUpdate(
                user
            );


            res.json({

                success: true,

                user:
                    publicUser(
                        user
                    )

            });

        } catch (error) {

            console.error(
                "[PROFILE PICTURE]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
PROFILE PICTURE UPLOAD
===========================================================
*/

app.post(
    "/api/account/profile-picture/upload",

    upload.single("file"),

    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            if (!req.file) {

                return res.status(
                    400
                ).json({

                    error:
                        "NO IMAGE PROVIDED"

                });

            }


            if (
                !req.file.mimetype.startsWith(
                    "image/"
                )
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "PROFILE PICTURE MUST BE AN IMAGE"

                });

            }


            let extension =
                ".png";


            const extensions = {

                "image/jpeg":
                    ".jpg",

                "image/jpg":
                    ".jpg",

                "image/png":
                    ".png",

                "image/gif":
                    ".gif",

                "image/webp":
                    ".webp",

                "image/bmp":
                    ".bmp"

            };


            if (
                extensions[
                    req.file.mimetype
                ]
            ) {

                extension =
                    extensions[
                        req.file.mimetype
                    ];

            }


            const filename =
                `profile_${auth.user.id}_${Date.now()}_${crypto
                    .randomBytes(4)
                    .toString("hex")}${extension}`;


            const path =
                `profile-pictures/${filename}`;


            await githubWriteBuffer(

                path,

                req.file.buffer,

                `Update profile picture for ${auth.user.username}`

            );


            const profilePicture =
                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;


            const accounts =
                await loadAccounts();


            const user =
                accounts.users.find(
                    u =>
                        u.id ===
                        auth.user.id
                );


            if (!user) {

                return res.status(
                    404
                ).json({

                    error:
                        "USER NOT FOUND"

                });

            }


            user.profile_picture =
                profilePicture;


            await saveAccounts(
                accounts
            );


            broadcastUserUpdate(
                user
            );


            res.json({

                success: true,

                user:
                    publicUser(
                        user
                    ),

                profile_picture:
                    profilePicture

            });

        } catch (error) {

            console.error(
                "[PROFILE UPLOAD]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
MEDIA FILE LIST
===========================================================
*/

app.get(
    "/api/files/:folder",
    async (
        req,
        res
    ) => {

        try {

            const folder =
                req.params.folder;


            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(
                    folder
                )
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "INVALID FOLDER"

                });

            }


            const data =
                await githubGet(
                    folder
                );


            if (!data) {

                return res.json({

                    files: []

                });

            }


            const files =
                Array.isArray(data)
                    ? data
                    : [data];


            const result =
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

                            size:
                                file.size,

                            download:
                                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file.path}`

                        })
                    );


            res.json({

                files:
                    result

            });

        } catch (error) {

            console.error(
                "[FILES]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
MEDIA UPLOAD
===========================================================
*/

app.post(
    "/api/upload",

    upload.single("file"),

    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            if (!req.file) {

                return res.status(
                    400
                ).json({

                    error:
                        "NO FILE PROVIDED"

                });

            }


            const folder =
                String(
                    req.body.folder ||
                    ""
                ).trim();


            if (
                ![
                    "image",
                    "music",
                    "video"
                ].includes(
                    folder
                )
            ) {

                return res.status(
                    400
                ).json({

                    error:
                        "INVALID FOLDER"

                });

            }


            if (
                req.file.size >
                MAX_UPLOAD_SIZE
            ) {

                return res.status(
                    413
                ).json({

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


            const filename =
                `${Date.now()}_${crypto
                    .randomBytes(4)
                    .toString("hex")}_${originalName}`;


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


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
CHAT LOGS
===========================================================
*/

async function getChatLogs() {

    const data =
        await githubGet(
            CHAT_FOLDER
        );


    if (!data) {

        return [];

    }


    const files =
        Array.isArray(data)
            ? data
            : [data];


    return files
        .filter(
            file =>
                file.type ===
                "file" &&
                /\.json$/i.test(
                    file.name
                )
        )
        .sort(
            (a, b) =>
                a.name.localeCompare(
                    b.name
                )
        );

}


/*
===========================================================
CHAT LOG LIST
===========================================================
*/

app.get(
    "/api/chat/logs",
    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            const logs =
                await getChatLogs();


            res.json({

                logs:
                    logs.map(
                        file => ({

                            name:
                                file.name,

                            path:
                                file.path

                        })
                    )

            });

        } catch (error) {

            console.error(
                "[CHAT LOGS]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
CHAT LOG READ
===========================================================
*/

app.get(
    "/api/chat/log/:number",
    async (
        req,
        res
    ) => {

        try {

            const auth =
                await authenticateRequest(
                    req
                );


            if (!auth) {

                return res.status(
                    401
                ).json({

                    error:
                        "LOGIN REQUIRED"

                });

            }


            const number =
                String(
                    req.params.number
                ).replace(
                    /[^0-9]/g,
                    ""
                );


            if (!number) {

                return res.status(
                    400
                ).json({

                    error:
                        "INVALID LOG NUMBER"

                });

            }


            const path =
                `chat-log/chat-${number}.json`;


            const text =
                await githubReadText(
                    path
                );


            if (!text) {

                return res.status(
                    404
                ).json({

                    error:
                        "CHAT LOG NOT FOUND"

                });

            }


            const data =
                JSON.parse(
                    text
                );


            res.json(
                data
            );

        } catch (error) {

            console.error(
                "[CHAT LOG READ]",
                error
            );


            res.status(500).json({

                error:
                    error.message

            });

        }

    }
);


/*
===========================================================
APPEND CHAT MESSAGE
===========================================================
*/

async function appendChatMessage(
    message
) {

    try {

        const logs =
            await getChatLogs();


        let target =
            null;


        if (
            logs.length
        ) {

            target =
                logs[
                    logs.length - 1
                ];

        }


        let messages =
            [];


        if (target) {

            try {

                const text =
                    await githubReadText(
                        target.path
                    );


                const data =
                    JSON.parse(
                        text
                    );


                if (
                    Array.isArray(
                        data.messages
                    )
                ) {

                    messages =
                        data.messages;

                }

            } catch {

                messages = [];

            }

        }


        messages.push(
            message
        );


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
            ) >
            MAX_CHAT_LOG_SIZE
        ) {

            let nextNumber =
                1;


            if (
                logs.length
            ) {

                const numbers =
                    logs.map(
                        file =>
                            Number(
                                (
                                    file.name.match(
                                        /(\d+)/
                                    ) || []
                                )[1]
                            ) || 0
                    );


                nextNumber =
                    Math.max(
                        ...numbers
                    ) + 1;

            }


            const path =
                `chat-log/chat-${nextNumber}.json`;


            await githubWriteText(

                path,

                JSON.stringify(
                    {
                        messages: [
                            message
                        ]
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
            "[CHAT LOG WRITE]",
            error
        );

    }

}


/*
===========================================================
WEBSOCKET
===========================================================
*/

const wss =
    new WebSocket.Server({

        server,

        path:
            "/ws"

    });


/*
===========================================================
AUTHENTICATE SOCKET
===========================================================
*/

async function authenticateSocket(
    token
) {

    if (!token) {

        return null;

    }


    let userId =
        null;


    /*
    Nouveau token persistant
    */

    const persistent =
        verifyPersistentToken(
            token
        );


    if (persistent) {

        userId =
            persistent.uid;

    }


    /*
    Ancien token
    */

    if (!userId) {

        const session =
            sessions.get(
                token
            );


        if (session) {

            userId =
                session.userId;

        }

    }


    if (!userId) {

        return null;

    }


    try {

        const accounts =
            await loadAccounts();


        return (
            accounts.users.find(
                user =>
                    user.id ===
                    userId
            ) || null
        );

    } catch {

        return null;

    }

}


/*
===========================================================
WSS CONNECTION
===========================================================
*/

wss.on(
    "connection",
    async (
        ws,
        req
    ) => {

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
                    token
                );


            if (!user) {

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


            ws.user =
                user;


            ws.authenticated =
                true;


            connectedSockets.add(
                ws
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
                        user.profile_picture

                })
            );


            broadcastUsers();


            /*
            MESSAGE
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
                            500
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


                        /*
                        Envoi immédiat aux clients
                        */

                        broadcast({

                            type:
                                "message",

                            data:
                                chatMessage

                        });


                        /*
                        Sauvegarde GitHub
                        */

                        await appendChatMessage(
                            chatMessage
                        );

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
                "[WSS CONNECTION]",
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
BROADCAST
===========================================================
*/

function broadcast(
    data
) {

    const text =
        JSON.stringify(
            data
        );


    for (
        const ws of
        connectedSockets
    ) {

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            try {

                ws.send(
                    text
                );

            } catch {}

        }

    }

}


/*
===========================================================
BROADCAST USERS
===========================================================
*/

function broadcastUsers() {

    broadcast({

        type:
            "users",

        count:
            connectedSockets.size

    });

}


/*
===========================================================
PROFILE UPDATE
===========================================================
*/

function broadcastUserUpdate(
    user
) {

    for (
        const ws of
        connectedSockets
    ) {

        if (
            ws.user &&
            ws.user.id ===
            user.id &&
            ws.readyState ===
            WebSocket.OPEN
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
    (
        req,
        res
    ) => {

        res.json({

            name:
                "DAVID RANDOM V2 API",

            status:
                "ONLINE",

            github:
                "STORAGE ACTIVE",

            websocket:
                "/ws",

            persistent_sessions:
                true,

            status_endpoint:
                "/api/status"

        });

    }
);


/*
===========================================================
404
===========================================================
*/

app.use(
    (
        req,
        res
    ) => {

        res.status(
            404
        ).json({

            error:
                "ENDPOINT NOT FOUND",

            path:
                req.originalUrl

        });

    }
);


/*
===========================================================
ERROR HANDLER
===========================================================
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "[EXPRESS ERROR]",
            error
        );


        if (
            error instanceof
            multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(
                    413
                ).json({

                    error:
                        "FILE TOO LARGE. MAXIMUM 25 MB"

                });

            }


            return res.status(
                400
            ).json({

                error:
                    error.message

            });

        }


        res.status(
            500
        ).json({

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
            "GITHUB:",
            GITHUB_OWNER &&
            GITHUB_REPO
                ? `${GITHUB_OWNER}/${GITHUB_REPO}`
                : "NOT CONFIGURED"
        );

        console.log(
            "HTTP: /"
        );

        console.log(
            "STATUS: /api/status"
        );

        console.log(
            "WEBSOCKET: /ws"
        );

        console.log(
            "REGISTER: /api/account/register"
        );

        console.log(
            "LOGIN: /api/account/login"
        );

        console.log(
            "ME: /api/account/me"
        );

        console.log(
            "PROFILE: /api/account/profile-picture"
        );

        console.log(
            "MEDIA: /api/upload"
        );

        console.log(
            "CHAT: /api/chat/logs"
        );

        console.log(
            "PERSISTENT SESSIONS: ENABLED"
        );

        console.log(
            "========================================"
        );


        await ensureDatabase();

    }
);
