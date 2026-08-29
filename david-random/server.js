```js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

/*
=========================================================
CONFIGURATION
=========================================================
*/

const GITHUB_OWNER =
    process.env.GITHUB_OWNER ||
    "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO ||
    "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH ||
    "main";

const GITHUB_TOKEN =
    process.env.GITHUB_TOKEN || null;

const CHAT_FOLDER =
    "chat-log";

const CHAT_MAX_SIZE =
    20 * 1024 * 1024;

const MAX_MESSAGE_LENGTH =
    500;

const MAX_USERNAME_LENGTH =
    24;


/*
=========================================================
EXPRESS
=========================================================
*/

app.use(
    express.json({
        limit: "1mb"
    })
);


/*
=========================================================
CORS
=========================================================
*/

app.use(function(req, res, next) {

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,OPTIONS"
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
STATUS
=========================================================
*/

app.get(
    "/api/status",
    function(req, res) {

        res.json({

            success: true,

            online: true,

            server:
                "Render",

            websocket:
                true,

            github:
                Boolean(GITHUB_TOKEN),

            chat:
                true,

            chatFolder:
                CHAT_FOLDER,

            chatMaxSize:
                CHAT_MAX_SIZE

        });

    }
);


/*
=========================================================
ROOT
=========================================================
*/

app.get(
    "/",
    function(req, res) {

        res.json({

            success: true,

            name:
                "DAVID RANDOM V2",

            server:
                "Render",

            websocket:
                true,

            chat:
                true

        });

    }
);


/*
=========================================================
MEDIA ROUTES
=========================================================

Ces routes évitent les erreurs 404 de ton ancien HTML.

Les médias peuvent être stockés dans :

media/image
media/music
media/video

Le serveur renvoie simplement la liste des fichiers.
=========================================================
*/

const MEDIA_ROOT =
    path.join(
        __dirname,
        "media"
    );


const MEDIA_TYPES = [
    "image",
    "music",
    "video"
];


for (const type of MEDIA_TYPES) {

    app.get(
        `/api/${type}`,
        function(req, res) {

            const folder =
                path.join(
                    MEDIA_ROOT,
                    type
                );

            try {

                if (!fs.existsSync(folder)) {

                    fs.mkdirSync(
                        folder,
                        {
                            recursive: true
                        }
                    );

                    return res.json({
                        success: true,
                        files: []
                    });

                }


                const files =
                    fs.readdirSync(
                        folder,
                        {
                            withFileTypes: true
                        }
                    )
                    .filter(
                        entry =>
                            entry.isFile()
                    )
                    .map(
                        entry =>
                            entry.name
                    );


                res.json({

                    success: true,

                    type:
                        type,

                    files:
                        files

                });

            }

            catch(error) {

                console.error(
                    `[MEDIA ${type}]`,
                    error
                );

                res.status(500).json({

                    success:
                        false,

                    error:
                        "Impossible de lire le dossier."

                });

            }

        }
    );

}


/*
=========================================================
WEBSOCKET
=========================================================
*/

const wss =
    new WebSocket.Server({
        server: server
    });


const clients =
    new Set();


wss.on(
    "connection",
    function(ws, req) {

        console.log(
            "[WSS] Nouvelle connexion"
        );


        const client = {

            ws:
                ws,

            token:
                null,

            username:
                null,

            authenticated:
                false

        };


        clients.add(client);


        sendSystem(
            ws,
            "Connexion au serveur réussie."
        );


        /*
        =================================================
        MESSAGE
        =================================================
        */

        ws.on(
            "message",
            async function(raw) {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    /*
                    =====================================
                    AUTH
                    =====================================
                    */

                    if (
                        data.type ===
                        "auth"
                    ) {

                        await authenticateClient(
                            client,
                            data.token
                        );

                        return;

                    }


                    /*
                    =====================================
                    CHAT
                    =====================================
                    */

                    if (
                        data.type ===
                        "chat"
                    ) {

                        await handleChatMessage(
                            client,
                            data
                        );

                        return;

                    }


                    /*
                    =====================================
                    PING
                    =====================================
                    */

                    if (
                        data.type ===
                        "ping"
                    ) {

                        safeSend(
                            ws,
                            {

                                type:
                                    "pong",

                                time:
                                    new Date()
                                        .toISOString()

                            }
                        );

                        return;

                    }


                    sendError(
                        ws,
                        "Type de message inconnu."
                    );

                }

                catch(error) {

                    console.error(
                        "[WSS] Erreur:",
                        error
                    );

                    sendError(
                        ws,
                        "Message invalide."
                    );

                }

            }
        );


        /*
        =================================================
        CLOSE
        =================================================
        */

        ws.on(
            "close",
            function() {

                clients.delete(
                    client
                );

                console.log(
                    "[WSS] Connexion fermée"
                );

            }
        );


        /*
        =================================================
        ERROR
        =================================================
        */

        ws.on(
            "error",
            function(error) {

                console.error(
                    "[WSS] Socket error:",
                    error
                );

                clients.delete(
                    client
                );

            }
        );

    }
);


/*
=========================================================
AUTHENTIFICATION
=========================================================
*/

async function authenticateClient(
    client,
    token
) {

    if (
        typeof token !==
        "string"
    ) {

        sendError(
            client.ws,
            "Token invalide."
        );

        return;

    }


    token =
        token.trim();


    if (
        token.length < 10 ||
        token.length > 10000
    ) {

        sendError(
            client.ws,
            "Token invalide."
        );

        return;

    }


    const user =
        await findUserByToken(
            token
        );


    if (!user) {

        sendError(
            client.ws,
            "Session invalide. Connecte-toi à ton compte."
        );

        return;

    }


    if (
        typeof user.username !==
        "string"
    ) {

        sendError(
            client.ws,
            "Compte invalide."
        );

        return;

    }


    const username =
        user.username.trim();


    if (
        !username ||
        username.length >
        MAX_USERNAME_LENGTH
    ) {

        sendError(
            client.ws,
            "Pseudo invalide."
        );

        return;

    }


    client.token =
        token;

    client.username =
        username;

    client.authenticated =
        true;


    safeSend(
        client.ws,
        {

            type:
                "auth",

            success:
                true,

            username:
                username

        }
    );


    sendSystem(
        client.ws,
        "Authentifié en tant que " +
        username
    );


    console.log(
        "[WSS] Auth:",
        username
    );

}


/*
=========================================================
CHAT
=========================================================
*/

async function handleChatMessage(
    client,
    data
) {

    /*
    -----------------------------------------------------
    UTILISATEUR NON CONNECTÉ
    -----------------------------------------------------
    */

    if (
        !client.authenticated
    ) {

        sendError(
            client.ws,
            "Tu dois être connecté pour utiliser le chat."
        );

        return;

    }


    /*
    -----------------------------------------------------
    MESSAGE
    -----------------------------------------------------
    */

    if (
        typeof data.message !==
        "string"
    ) {

        sendError(
            client.ws,
            "Message invalide."
        );

        return;

    }


    const message =
        data.message.trim();


    if (!message) {

        sendError(
            client.ws,
            "Message vide."
        );

        return;

    }


    if (
        message.length >
        MAX_MESSAGE_LENGTH
    ) {

        sendError(
            client.ws,
            "Message trop long. Maximum 500 caractères."
        );

        return;

    }


    /*
    -----------------------------------------------------
    LE PSEUDO DU CLIENT EST IGNORÉ
    -----------------------------------------------------

    Le navigateur ne peut PAS choisir le pseudo.

    Le serveur utilise le pseudo lié au token.
    -----------------------------------------------------
    */

    const username =
        client.username;


    if (!username) {

        sendError(
            client.ws,
            "Utilisateur introuvable."
        );

        return;

    }


    const chatMessage = {

        type:
            "chat",

        username:
            username,

        message:
            message,

        time:
            new Date()
                .toISOString()

    };


    /*
    -----------------------------------------------------
    GITHUB
    -----------------------------------------------------
    */

    try {

        await saveChatMessage(
            chatMessage
        );

    }

    catch(error) {

        console.error(
            "[CHAT] Erreur GitHub:",
            error
        );

        sendError(
            client.ws,
            "Impossible d'enregistrer le message."
        );

        return;

    }


    /*
    -----------------------------------------------------
    DIFFUSION
    -----------------------------------------------------
    */

    broadcast(
        chatMessage
    );


    console.log(
        `[CHAT] ${username}: ${message}`
    );

}


/*
=========================================================
GITHUB
=========================================================
*/

function githubHeaders() {

    return {

        "Authorization":
            `Bearer ${GITHUB_TOKEN}`,

        "Accept":
            "application/vnd.github+json",

        "X-GitHub-Api-Version":
            "2022-11-28",

        "User-Agent":
            "David-Random-Server"

    };

}


function githubURL(
    filePath
) {

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/contents/" +
        filePath
            .split("/")
            .map(
                encodeURIComponent
            )
            .join("/")
    );

}


/*
=========================================================
GITHUB REQUEST
=========================================================
*/

async function githubRequest(
    url,
    options = {}
) {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN manquant."
        );

    }


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


    let data =
        null;


    try {

        data =
            await response.json();

    }

    catch {

        data =
            null;

    }


    if (!response.ok) {

        const error =
            new Error(
                data &&
                data.message
                    ? data.message
                    : `GitHub HTTP ${response.status}`
            );


        error.status =
            response.status;


        error.data =
            data;


        throw error;

    }


    return data;

}


/*
=========================================================
LIST CHAT FILES
=========================================================
*/

async function listChatFiles() {

    const url =
        githubURL(
            CHAT_FOLDER
        );


    try {

        const data =
            await githubRequest(
                url
            );


        if (
            !Array.isArray(data)
        ) {

            return [];

        }


        return data
            .filter(
                file =>
                    file.type === "file"
            )
            .filter(
                file =>
                    /^chat(?:-\d+)?\.txt$/i
                        .test(file.name)
            );

    }

    catch(error) {

        if (
            error.status ===
            404
        ) {

            return [];

        }

        throw error;

    }

}


/*
=========================================================
FILE NUMBER
=========================================================
*/

function getChatFileNumber(
    filename
) {

    const match =
        filename.match(
            /^chat(?:-(\d+))?\.txt$/i
        );


    if (!match) {
        return 0;
    }


    if (!match[1]) {
        return 1;
    }


    return Number(
        match[1]
    );

}


/*
=========================================================
LATEST CHAT FILE
=========================================================
*/

async function getLatestChatFile() {

    const files =
        await listChatFiles();


    if (
        files.length ===
        0
    ) {

        return null;

    }


    files.sort(
        function(a, b) {

            return (
                getChatFileNumber(b.name) -
                getChatFileNumber(a.name)
            );

        }
    );


    return files[0];

}


/*
=========================================================
READ GITHUB FILE
=========================================================
*/

async function readGithubFile(
    file
) {

    const data =
        await githubRequest(
            githubURL(
                file.path
            )
        );


    if (
        !data.content
    ) {

        throw new Error(
            "Contenu GitHub absent."
        );

    }


    const content =
        data.content
            .replace(/\n/g, "");


    const buffer =
        Buffer.from(
            content,
            "base64"
        );


    return {

        content:
            buffer.toString(
                "utf8"
            ),

        size:
            buffer.length,

        sha:
            data.sha

    };

}


/*
=========================================================
CREATE GITHUB FILE
=========================================================
*/

async function createGithubFile(
    filePath,
    content
) {

    const encoded =
        Buffer.from(
            content,
            "utf8"
        ).toString(
            "base64"
        );


    return await githubRequest(
        githubURL(
            filePath
        ),
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
                        `Add ${filePath}`,

                    content:
                        encoded,

                    branch:
                        GITHUB_BRANCH

                })

        }
    );

}


/*
=========================================================
UPDATE GITHUB FILE
=========================================================
*/

async function updateGithubFile(
    filePath,
    content,
    sha
) {

    const encoded =
        Buffer.from(
            content,
            "utf8"
        ).toString(
            "base64"
        );


    return await githubRequest(
        githubURL(
            filePath
        ),
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
                        `Update ${filePath}`,

                    content:
                        encoded,

                    sha:
                        sha,

                    branch:
                        GITHUB_BRANCH

                })

        }
    );

}


/*
=========================================================
CHAT SAVE QUEUE
=========================================================

Empêche plusieurs messages simultanés
de modifier le même fichier GitHub.
=========================================================
*/

let chatSaveQueue =
    Promise.resolve();


function queueChatSave(
    task
) {

    const next =
        chatSaveQueue.then(
            task,
            task
        );


    chatSaveQueue =
        next.catch(
            function() {}
        );


    return next;

}


/*
=========================================================
SAVE CHAT MESSAGE
=========================================================
*/

function saveChatMessage(
    chatMessage
) {

    return queueChatSave(
        async function() {

            const line =
                formatChatLine(
                    chatMessage
                );


            const lineSize =
                Buffer.byteLength(
                    line,
                    "utf8"
                );


            let latest =
                await getLatestChatFile();


            /*
            =============================================
            PREMIER FICHIER
            =============================================
            */

            if (!latest) {

                const filePath =
                    `${CHAT_FOLDER}/chat.txt`;


                await createGithubFile(
                    filePath,
                    line
                );


                console.log(
                    "[CHAT LOG] Créé:",
                    filePath
                );


                return;

            }


            /*
            =============================================
            LIRE LE DERNIER
            =============================================
            */

            const file =
                await readGithubFile(
                    latest
                );


            /*
            =============================================
            ROTATION 20 MO
            =============================================
            */

            if (
                file.size +
                lineSize >
                CHAT_MAX_SIZE
            ) {

                const currentNumber =
                    getChatFileNumber(
                        latest.name
                    );


                const nextNumber =
                    currentNumber + 1;


                const nextFilename =
                    `chat-${nextNumber}.txt`;


                const nextPath =
                    `${CHAT_FOLDER}/${nextFilename}`;


                await createGithubFile(
                    nextPath,
                    line
                );


                console.log(
                    "[CHAT LOG] Nouveau fichier:",
                    nextPath
                );


                return;

            }


            /*
            =============================================
            AJOUT
            =============================================
            */

            const newContent =
                file.content +
                line;


            await updateGithubFile(
                latest.path,
                newContent,
                file.sha
            );


            console.log(
                "[CHAT LOG] Ajouté:",
                latest.path
            );

        }
    );

}


/*
=========================================================
FORMAT CHAT
=========================================================
*/

function formatChatLine(
    data
) {

    const time =
        data.time ||
        new Date()
            .toISOString();


    return (
        `[${time}] ` +
        `${data.username}: ` +
        `${data.message}\n`
    );

}


/*
=========================================================
BROADCAST
=========================================================
*/

function broadcast(
    data
) {

    const payload =
        JSON.stringify(
            data
        );


    for (
        const client of clients
    ) {

        if (
            client.ws.readyState ===
            WebSocket.OPEN
        ) {

            safeSendRaw(
                client.ws,
                payload
            );

        }

    }

}


/*
=========================================================
SYSTEM MESSAGE
=========================================================
*/

function sendSystem(
    ws,
    message
) {

    safeSend(
        ws,
        {

            type:
                "system",

            message:
                message

        }
    );

}


/*
=========================================================
ERROR
=========================================================
*/

function sendError(
    ws,
    message
) {

    safeSend(
        ws,
        {

            type:
                "error",

            error:
                message

        }
    );

}


/*
=========================================================
SAFE SEND
=========================================================
*/

function safeSend(
    ws,
    data
) {

    try {

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            ws.send(
                JSON.stringify(
                    data
                )
            );

        }

    }

    catch(error) {

        console.error(
            "[WSS] Send error:",
            error
        );

    }

}


function safeSendRaw(
    ws,
    data
) {

    try {

        if (
            ws.readyState ===
            WebSocket.OPEN
        ) {

            ws.send(
                data
            );

        }

    }

    catch(error) {

        console.error(
            "[WSS] Send error:",
            error
        );

    }

}


/*
=========================================================
ACCOUNT / TOKEN
=========================================================

Cette fonction recherche le token dans users.json.

Format attendu :

[
    {
        "username": "David",
        "token": "TOKEN_ICI"
    }
]

ou :

{
    "users": [
        {
            "username": "David",
            "token": "TOKEN_ICI"
        }
    ]
}

=========================================================
*/

async function findUserByToken(
    token
) {

    /*
    -----------------------------------------------------
    1. Variable d'environnement
    -----------------------------------------------------
    */

    if (
        process.env.USERS_JSON
    ) {

        try {

            const database =
                JSON.parse(
                    process.env.USERS_JSON
                );


            return findUserInDatabase(
                database,
                token
            );

        }

        catch(error) {

            console.error(
                "[AUTH] USERS_JSON invalide:",
                error
            );

        }

    }


    /*
    -----------------------------------------------------
    2. users.json local
    -----------------------------------------------------
    */

    const possibleFiles = [

        path.join(
            __dirname,
            "users.json"
        ),

        path.join(
            __dirname,
            "accounts",
            "users.json"
        )

    ];


    for (
        const filename of possibleFiles
    ) {

        if (
            !fs.existsSync(
                filename
            )
        ) {

            continue;

        }


        try {

            const raw =
                fs.readFileSync(
                    filename,
                    "utf8"
                );


            const database =
                JSON.parse(
                    raw
                );


            const user =
                findUserInDatabase(
                    database,
                    token
                );


            if (user) {
                return user;
            }

        }

        catch(error) {

            console.error(
                "[AUTH] Erreur users.json:",
                error
            );

        }

    }


    return null;

}


/*
=========================================================
SEARCH USER
=========================================================
*/

function findUserInDatabase(
    database,
    token
) {

    let users =
        database;


    if (
        database &&
        Array.isArray(
            database.users
        )
    ) {

        users =
            database.users;

    }


    if (
        !Array.isArray(users)
    ) {

        return null;

    }


    for (
        const user of users
    ) {

        if (
            !user ||
            typeof user !==
                "object"
        ) {

            continue;

        }


        if (
            typeof user.token !==
            "string"
        ) {

            continue;

        }


        /*
        Comparaison sécurisée
        */

        if (
            user.token.length !==
            token.length
        ) {

            continue;

        }


        try {

            const a =
                Buffer.from(
                    user.token
                );

            const b =
                Buffer.from(
                    token
                );


            if (
                crypto.timingSafeEqual(
                    a,
                    b
                )
            ) {

                if (
                    typeof user.username ===
                    "string"
                ) {

                    return {

                        username:
                            user.username.trim()

                    };

                }

            }

        }

        catch {

            continue;

        }

    }


    return null;

}


/*
=========================================================
404
=========================================================
*/

app.use(
    function(req, res) {

        res.status(404).json({

            success:
                false,

            error:
                "Route introuvable."

        });

    }
);


/*
=========================================================
START
=========================================================
*/

server.listen(
    PORT,
    function() {

        console.log(
            "========================================"
        );

        console.log(
            "DAVID RANDOM SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            "PORT:",
            PORT
        );

        console.log(
            "HTTP: ONLINE"
        );

        console.log(
            "WSS: ONLINE"
        );

        console.log(
            "GitHub:",
            GITHUB_TOKEN
                ? "CONFIGURED"
                : "MISSING"
        );

        console.log(
            "Chat logs:",
            `${CHAT_FOLDER}/`
        );

        console.log(
            "Chat limit:",
            "20 MB"
        );

        console.log(
            "Authentication:",
            "ENABLED"
        );

        console.log(
            "========================================"
        );

    }
);
```
