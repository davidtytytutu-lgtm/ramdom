const express = require("express");
const http = require("http");
const WebSocket = require("ws");

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
DOSSIERS MEDIA
=========================================================
*/

const MEDIA_FOLDERS = {
    image: "image",
    music: "music",
    video: "video"
};


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
GITHUB URL
=========================================================
*/

function githubURL(path) {

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
                data && data.message
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
                true,

            media:
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

            success:
                true,

            online:
                true,

            server:
                "Render",

            websocket:
                true,

            github:
                Boolean(
                    GITHUB_TOKEN
                ),

            chat:
                true,

            chatFolder:
                CHAT_FOLDER,

            chatMaxSize:
                CHAT_MAX_SIZE,

            media:
                true,

            mediaFolders:
                Object.keys(
                    MEDIA_FOLDERS
                )

        });

    }
);


/*
=========================================================
MEDIA
=========================================================
*/

/*
URL :

/api/media/image
/api/media/music
/api/media/video
*/

app.get(
    "/api/media/:folder",
    async function(req, res) {

        const folderName =
            String(
                req.params.folder || ""
            ).toLowerCase();


        /*
        -------------------------------------------------
        Vérifier le dossier
        -------------------------------------------------
        */

        if (
            !MEDIA_FOLDERS[
                folderName
            ]
        ) {

            return res.status(400).json({

                success:
                    false,

                error:
                    "Dossier média invalide.",

                allowed:
                    Object.keys(
                        MEDIA_FOLDERS
                    )

            });

        }


        const folder =
            MEDIA_FOLDERS[
                folderName
            ];


        console.log(
            `[MEDIA ${folderName}] Chargement de ${folder}/`
        );


        try {

            const files =
                await githubRequest(
                    githubURL(
                        folder
                    )
                );


            if (
                !Array.isArray(files)
            ) {

                return res.json({

                    success:
                        true,

                    folder:
                        folder,

                    files:
                        []

                });

            }


            const result =
                files
                    .filter(function(file) {

                        return (
                            file.type ===
                            "file"
                        );

                    })
                    .map(function(file) {

                        return {

                            name:
                                file.name,

                            path:
                                file.path,

                            size:
                                file.size,

                            download_url:
                                file.download_url,

                            html_url:
                                file.html_url,

                            sha:
                                file.sha

                        };

                    });


            console.log(
                `[MEDIA ${folderName}] ${result.length} fichier(s)`
            );


            return res.json({

                success:
                    true,

                folder:
                    folder,

                files:
                    result

            });

        }

        catch(error) {

            console.error(
                `[MEDIA ${folderName}] Erreur:`,
                error
            );


            /*
            -------------------------------------------------
            Dossier inexistant
            -------------------------------------------------
            */

            if (
                error.status ===
                404
            ) {

                return res.json({

                    success:
                        true,

                    folder:
                        folder,

                    files:
                        []

                });

            }


            return res.status(500).json({

                success:
                    false,

                error:
                    "Impossible de charger le dossier média.",

                details:
                    error.message

            });

        }

    }
);


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
                    .test(
                        file.name
                    );

            });

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
NUMÉRO DU CHAT
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
                getChatFileNumber(
                    b.name
                ) -
                getChatFileNumber(
                    a.name
                )
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
            .replace(
                /\n/g,
                ""
            );


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


    return await githubRequest(
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

}


/*
=========================================================
MODIFIER FICHIER GITHUB
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


    return await githubRequest(
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

}


/*
=========================================================
QUEUE CHAT
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
SAUVEGARDER CHAT
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
            -------------------------------------------------
            Aucun fichier
            -------------------------------------------------
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
            -------------------------------------------------
            Lire le dernier fichier
            -------------------------------------------------
            */

            const file =
                await readGithubFile(
                    latest
                );


            /*
            -------------------------------------------------
            Vérifier les 20 Mo
            -------------------------------------------------
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
            -------------------------------------------------
            Ajouter au fichier
            -------------------------------------------------
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
WEBSOCKET
=========================================================
*/

const wss =
    new WebSocket.Server({
        server:
            server
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


        clients.add(
            client
        );


        /*
        -------------------------------------------------
        CONNEXION
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
    -------------------------------------------------
    COMPTE OBLIGATOIRE
    -------------------------------------------------
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
    -------------------------------------------------
    MESSAGE
    -------------------------------------------------
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
    -------------------------------------------------
    PSEUDO SERVEUR
    -------------------------------------------------
    
    Le pseudo envoyé par le navigateur
    est complètement ignoré.
    -------------------------------------------------
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
    -------------------------------------------------
    GITHUB
    -------------------------------------------------
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
    -------------------------------------------------
    DIFFUSION
    -------------------------------------------------
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
TROUVER UTILISATEUR PAR TOKEN
=========================================================

IMPORTANT :

Cette fonction doit être reliée à ton système
de comptes actuel.

Le reste du serveur est déjà prêt.

=========================================================
*/

async function findUserByToken(
    token
) {

    /*
    =====================================================
    IMPORTANT
    =====================================================

    Pour l'instant cette fonction ne peut pas savoir
    quel utilisateur possède le token sans ton système
    users.enc / accounts.

    Donc elle retourne null.

    Il faudra remplacer cette partie par le même
    système de déchiffrement que ton serveur Account.
    =====================================================
    */


    return null;

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


/*
=========================================================
SAFE SEND RAW
=========================================================
*/

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
404
=========================================================
*/

app.use(
    function(req, res) {

        res.status(404).json({

            success:
                false,

            error:
                "Route introuvable.",

            path:
                req.path

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
            "Repository:",
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Chat:",
            `${CHAT_FOLDER}/`
        );

        console.log(
            "Chat limit:",
            "20 MB"
        );

        console.log(
            "Media:",
            "image/ music/ video/"
        );

        console.log(
            "========================================"
        );

    }
);
