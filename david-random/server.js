const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

/*
=========================================================
DAVID RANDOM V2
SERVER
=========================================================
*/

/*
=========================================================
CONFIGURATION GITHUB
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


/*
=========================================================
DOSSIERS GITHUB
=========================================================
*/

const IMAGE_FOLDER =
    "image";

const MUSIC_FOLDER =
    "music";

const VIDEO_FOLDER =
    "video";

const CHAT_FOLDER =
    "chat-log";


/*
=========================================================
LIMITES
=========================================================
*/

const CHAT_MAX_SIZE =
    20 * 1024 * 1024; // 20 Mo

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

app.use(
    function(req, res, next) {

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

        if (
            req.method === "OPTIONS"
        ) {

            return res.sendStatus(204);

        }

        next();

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

            github:
                Boolean(GITHUB_TOKEN),

            chat:
                true

        });

    }
);


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
                CHAT_MAX_SIZE,

            folders: {

                image:
                    IMAGE_FOLDER,

                music:
                    MUSIC_FOLDER,

                video:
                    VIDEO_FOLDER,

                chat:
                    CHAT_FOLDER

            }

        });

    }
);


/*
=========================================================
GITHUB URL
=========================================================
*/

function githubURL(
    filePath
) {

    const encodedPath =
        filePath
            .split("/")
            .map(
                function(part) {
                    return encodeURIComponent(part);
                }
            )
            .join("/");


    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/contents/" +
        encodedPath
    );

}


/*
=========================================================
GITHUB HEADERS
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


/*
=========================================================
GITHUB REQUEST
=========================================================
*/

async function githubRequest(
    url,
    options = {}
) {

    if (
        !GITHUB_TOKEN
    ) {

        throw new Error(
            "GITHUB_TOKEN manquant dans Render."
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


    if (
        !response.ok
    ) {

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
LISTE D'UN DOSSIER GITHUB
=========================================================
*/

async function listGithubFolder(
    folder
) {

    try {

        const data =
            await githubRequest(
                githubURL(folder)
            );


        if (
            !Array.isArray(data)
        ) {

            return [];

        }


        return data.filter(
            function(file) {

                return (
                    file.type === "file"
                );

            }
        );

    }

    catch(error) {

        if (
            error.status === 404
        ) {

            return [];

        }

        throw error;

    }

}


/*
=========================================================
MEDIA
=========================================================

GET :

/api/media/image
/api/media/music
/api/media/video

Les fichiers viennent directement du dépôt GitHub.
=========================================================
*/

async function sendMediaFolder(
    res,
    folder,
    type
) {

    try {

        const files =
            await listGithubFolder(
                folder
            );


        const result =
            files.map(
                function(file) {

                    return {

                        name:
                            file.name,

                        path:
                            file.path,

                        url:
                            `https://raw.githubusercontent.com/` +
                            `${GITHUB_OWNER}/` +
                            `${GITHUB_REPO}/` +
                            `${GITHUB_BRANCH}/` +
                            `${file.path}`,

                        size:
                            file.size || 0

                    };

                }
            );


        res.json({

            success:
                true,

            type:
                type,

            folder:
                folder,

            files:
                result

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
                "Impossible de récupérer les médias."

        });

    }

}


/*
=========================================================
IMAGE
=========================================================
*/

app.get(
    "/api/media/image",
    function(req, res) {

        sendMediaFolder(
            res,
            IMAGE_FOLDER,
            "image"
        );

    }
);


/*
=========================================================
MUSIC
=========================================================
*/

app.get(
    "/api/media/music",
    function(req, res) {

        sendMediaFolder(
            res,
            MUSIC_FOLDER,
            "music"
        );

    }
);


/*
=========================================================
VIDEO
=========================================================
*/

app.get(
    "/api/media/video",
    function(req, res) {

        sendMediaFolder(
            res,
            VIDEO_FOLDER,
            "video"
        );

    }
);


/*
=========================================================
ANCIENNES ROUTES MEDIA
=========================================================

Compatibilité avec d'éventuelles anciennes versions
du HTML.
=========================================================
*/

app.get(
    "/api/image",
    function(req, res) {

        sendMediaFolder(
            res,
            IMAGE_FOLDER,
            "image"
        );

    }
);


app.get(
    "/api/music",
    function(req, res) {

        sendMediaFolder(
            res,
            MUSIC_FOLDER,
            "music"
        );

    }
);


app.get(
    "/api/video",
    function(req, res) {

        sendMediaFolder(
            res,
            VIDEO_FOLDER,
            "video"
        );

    }
);


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


        /*
        -----------------------------------------------
        CONNEXION
        -----------------------------------------------
        */

        sendSystem(
            ws,
            "Connexion au serveur réussie."
        );


        /*
        -----------------------------------------------
        MESSAGE
        -----------------------------------------------
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
                    AUTHENTIFICATION
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
                        "[WSS] Erreur message:",
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
        -----------------------------------------------
        FERMETURE
        -----------------------------------------------
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
        -----------------------------------------------
        ERREUR
        -----------------------------------------------
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


    /*
    -----------------------------------------------
    RECHERCHE DU COMPTE
    -----------------------------------------------
    */

    const user =
        await findUserByToken(
            token
        );


    if (
        !user
    ) {

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


    /*
    -----------------------------------------------
    AUTHENTIFICATION VALIDÉE
    -----------------------------------------------
    */

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
    -----------------------------------------------
    NON CONNECTÉ
    -----------------------------------------------
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
    -----------------------------------------------
    MESSAGE
    -----------------------------------------------
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


    if (
        !message
    ) {

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
    -----------------------------------------------
    IMPORTANT
    -----------------------------------------------

    Le pseudo envoyé par le navigateur est IGNORÉ.

    Le serveur utilise uniquement le pseudo lié
    au token authentifié.
    -----------------------------------------------
    */

    const username =
        client.username;


    if (
        !username
    ) {

        sendError(
            client.ws,
            "Utilisateur introuvable."
        );

        return;

    }


    /*
    -----------------------------------------------
    MESSAGE FINAL
    -----------------------------------------------
    */

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
    -----------------------------------------------
    SAUVEGARDE
    -----------------------------------------------
    */

    try {

        await saveChatMessage(
            chatMessage
        );

    }

    catch(error) {

        console.error(
            "[CHAT] Sauvegarde GitHub:",
            error
        );


        sendError(
            client.ws,
            "Impossible d'enregistrer le message."
        );


        return;

    }


    /*
    -----------------------------------------------
    DIFFUSION
    -----------------------------------------------
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
LISTE FICHIERS CHAT
=========================================================
*/

async function listChatFiles() {

    const files =
        await listGithubFolder(
            CHAT_FOLDER
        );


    return files
        .filter(
            function(file) {

                return /^chat(?:-\d+)?\.txt$/i
                    .test(file.name);

            }
        );

}


/*
=========================================================
NUMÉRO FICHIER CHAT
=========================================================
*/

function getChatFileNumber(
    filename
) {

    const match =
        filename.match(
            /^chat(?:-(\d+))?\.txt$/i
        );


    if (
        !match
    ) {

        return 0;

    }


    if (
        !match[1]
    ) {

        return 1;

    }


    return Number(
        match[1]
    );

}


/*
=========================================================
DERNIER FICHIER CHAT
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
LIRE FICHIER GITHUB
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
CRÉER FICHIER GITHUB
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
        )
        .toString(
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
                        `Create ${filePath}`,

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
MODIFIER FICHIER GITHUB
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
        )
        .toString(
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
FILE D'ATTENTE CHAT
=========================================================

Évite que deux messages modifient simultanément
le même fichier GitHub.
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
SAUVEGARDE CHAT
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


            /*
            =============================================
            CHERCHER LE DERNIER FICHIER
            =============================================
            */

            let latest =
                await getLatestChatFile();


            /*
            =============================================
            AUCUN FICHIER
            =============================================
            */

            if (
                !latest
            ) {

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
            LIRE LE DERNIER FICHIER
            =============================================
            */

            const file =
                await readGithubFile(
                    latest
                );


            /*
            =============================================
            LIMITE 20 MO
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
                    "[CHAT LOG] Limite atteinte."
                );


                console.log(
                    "[CHAT LOG] Nouveau fichier:",
                    nextPath
                );


                return;

            }


            /*
            =============================================
            AJOUTER LE MESSAGE
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
                "[CHAT LOG] Message enregistré:",
                latest.path
            );

        }
    );

}


/*
=========================================================
FORMAT MESSAGE
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
ERROR MESSAGE
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
AUTHENTIFICATION DES COMPTES
=========================================================

IMPORTANT :

Ton système actuel utilise users.enc + AES-256-GCM.

Cette fonction est l'endroit où ton système de comptes
doit être branché.

Pour l'instant, on accepte également un système
simple USERS_JSON pour permettre de tester le serveur.

Render peut recevoir USERS_JSON comme variable
d'environnement.

Format :

{
    "users": [
        {
            "username": "David",
            "token": "TOKEN"
        }
    ]
}

OU :

[
    {
        "username": "David",
        "token": "TOKEN"
    }
]

=========================================================
*/

async function findUserByToken(
    token
) {

    /*
    -----------------------------------------------
    USERS_JSON
    -----------------------------------------------
    */

    if (
        process.env.USERS_JSON
    ) {

        try {

            const database =
                JSON.parse(
                    process.env.USERS_JSON
                );


            const user =
                findUserInDatabase(
                    database,
                    token
                );


            if (
                user
            ) {

                return user;

            }

        }

        catch(error) {

            console.error(
                "[AUTH] USERS_JSON invalide:",
                error
            );

        }

    }


    /*
    -----------------------------------------------
    IMPORTANT
    -----------------------------------------------

    Ici il faudra brancher users.enc.

    Tant que cette partie n'est pas branchée,
    un token inconnu est refusé.

    -----------------------------------------------
    */

    return null;

}


/*
=========================================================
RECHERCHE UTILISATEUR
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
            typeof user !== "object"
        ) {

            continue;

        }


        if (
            typeof user.token !== "string"
        ) {

            continue;

        }


        if (
            user.token.length !==
            token.length
        ) {

            continue;

        }


        try {

            const tokenA =
                Buffer.from(
                    user.token,
                    "utf8"
                );


            const tokenB =
                Buffer.from(
                    token,
                    "utf8"
                );


            if (
                crypto.timingSafeEqual(
                    tokenA,
                    tokenB
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
            "DAVID RANDOM V2 SERVER"
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
            "Repository:",
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Image:",
            IMAGE_FOLDER
        );

        console.log(
            "Music:",
            MUSIC_FOLDER
        );

        console.log(
            "Video:",
            VIDEO_FOLDER
        );

        console.log(
            "Chat:",
            CHAT_FOLDER
        );

        console.log(
            "Chat limit:",
            "20 MB"
        );

        console.log(
            "========================================"
        );

    }
);

