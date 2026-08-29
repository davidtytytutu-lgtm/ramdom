const express = require("express");
const http = require("http");
const WebSocket = require("ws");
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
    process.env.GITHUB_TOKEN;

const CHAT_FOLDER =
    "chat-log";

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

app.use(express.json({
    limit: "1mb"
}));


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

            server: "Render",

            websocket: true,

            github: Boolean(
                GITHUB_TOKEN
            ),

            chat: true,

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

            ws: ws,

            token: null,

            username: null,

            authenticated: false

        };


        clients.add(client);


        /*
        -------------------------------------------------
        Message système
        -------------------------------------------------
        */

        sendSystem(
            ws,
            "Connexion au serveur réussie."
        );


        /*
        -------------------------------------------------
        MESSAGE
        -------------------------------------------------
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
                    =========================================
                    AUTH
                    =========================================
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
                    =========================================
                    CHAT
                    =========================================
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
                    =========================================
                    PING
                    =========================================
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
        -------------------------------------------------
        CLOSE
        -------------------------------------------------
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
        -------------------------------------------------
        ERROR
        -------------------------------------------------
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
        "string" ||
        token.length < 10
    ) {

        sendError(
            client.ws,
            "Token invalide."
        );

        return;

    }


    /*
    Ici on vérifie le token
    avec le système de comptes.
    
    Cette fonction devra utiliser
    ton système users.enc existant.
    */

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


    client.token =
        token;

    client.username =
        user.username;

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
                user.username

        }
    );


    sendSystem(
        client.ws,
        "Authentifié en tant que " +
        user.username
    );


    console.log(
        "[WSS] Auth:",
        user.username
    );

}


/*
=========================================================
CHAT MESSAGE
=========================================================
*/

async function handleChatMessage(
    client,
    data
) {

    /*
    -----------------------------------------------------
    PAS CONNECTÉ
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
    IMPORTANT
    -----------------------------------------------------

    Le pseudo envoyé par le navigateur
    est IGNORÉ.

    On utilise celui associé au token.
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
    SAUVEGARDE GITHUB
    -----------------------------------------------------
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
    -----------------------------------------------------
    DIFFUSION À TOUS
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
GITHUB API
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
    path
) {

    return (
        "https://api.github.com/repos/" +
        encodeURIComponent(GITHUB_OWNER) +
        "/" +
        encodeURIComponent(GITHUB_REPO) +
        "/contents/" +
        path
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
            .filter(function(file) {

                return (
                    file.type ===
                    "file"
                );

            })
            .filter(function(file) {

                return /^chat(?:-\d+)?\.txt$/i
                    .test(file.name);

            });

    }

    catch(error) {

        /*
        Le dossier peut ne pas encore
        exister.
        */

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
NUMÉRO DU FICHIER
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
TROUVER LE DERNIER CHAT
=========================================================
*/

async function getLatestChatFile() {

    const files =
        await listChatFiles();


    if (
        files.length === 0
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
LIRE UN FICHIER GITHUB
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
CRÉER UN NOUVEAU FICHIER
=========================================================
*/

async function createGithubFile(
    path,
    content
) {

    const encoded =
        Buffer.from(
            content,
            "utf8"
        ).toString(
            "base64"
        );


    const data =
        await githubRequest(
            githubURL(
                path
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
                            "Add chat log",

                        content:
                            encoded,

                        branch:
                            GITHUB_BRANCH

                    })

            }
        );


    return data;

}


/*
=========================================================
MODIFIER UN FICHIER
=========================================================
*/

async function updateGithubFile(
    path,
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


    const data =
        await githubRequest(
            githubURL(
                path
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
                            "Update chat log",

                        content:
                            encoded,

                        sha:
                            sha,

                        branch:
                            GITHUB_BRANCH

                    })

            }
        );


    return data;

}


/*
=========================================================
LOCK CHAT
=========================================================

Empêche deux messages simultanés
de modifier le même fichier GitHub
en même temps.
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
SAUVEGARDER MESSAGE
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
            Aucun fichier
            =============================================
            */

            if (!latest) {

                const path =
                    `${CHAT_FOLDER}/chat.txt`;


                await createGithubFile(
                    path,
                    line
                );


                console.log(
                    "[CHAT LOG] Créé:",
                    path
                );


                return;

            }


            /*
            =============================================
            Lire dernier fichier
            =============================================
            */

            const file =
                await readGithubFile(
                    latest
                );


            /*
            =============================================
            Vérifier limite 20 Mo
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
            Ajouter au fichier actuel
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
SEND SYSTEM
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
SEND ERROR
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
TOKEN / ACCOUNT
=========================================================

IMPORTANT :

Cette fonction est volontairement séparée.

Elle doit utiliser ton système
accounts/users.enc + AES-256-GCM
que nous avons déjà configuré.

Pour l'instant elle vérifie le format
du token et sera remplacée par la vraie
lecture de users.enc.
=========================================================
*/

async function findUserByToken(
    token
) {

    /*
    -----------------------------------------------------
    TODO :
    lire accounts/users.enc
    déchiffrer avec le secret serveur
    rechercher le token
    retourner l'utilisateur
    -----------------------------------------------------
    */

    /*
    Pour éviter qu'un token soit accepté
    sans vérification réelle, on retourne null.

    On branchera ici ton système de comptes.
    */

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
            "========================================"
        );

    }
);
