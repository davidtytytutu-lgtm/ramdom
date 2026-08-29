const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

/* =========================================================
   CONFIG
========================================================= */

const app = express();

const PORT = process.env.PORT || 10000;

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

const MAX_FILE_SIZE =
    25 * 1024 * 1024;


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

app.use(
    (req, res, next) => {

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
            "Content-Type"
        );

        if (req.method === "OPTIONS") {

            return res.sendStatus(204);

        }

        next();

    }
);


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


wss.on(
    "connection",
    (socket) => {

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


        socket.on(
            "message",
            (rawMessage) => {

                try {

                    const data =
                        JSON.parse(
                            rawMessage.toString()
                        );


                    if (
                        data.type !==
                        "chat"
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

            }
        );


        socket.on(
            "close",
            () => {

                console.log(
                    "[WSS] Client déconnecté"
                );

            }
        );


        socket.on(
            "error",
            (error) => {

                console.error(
                    "[WSS] Socket error:",
                    error
                );

            }
        );

    }
);


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
   TEST GITHUB CONFIG
========================================================= */

function githubConfigured() {

    return Boolean(
        GITHUB_TOKEN &&
        GITHUB_OWNER &&
        GITHUB_REPO
    );

}


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

        name =
            "file";

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
                    ),
                    {
                        method: "GET"
                    }
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
            ).toLowerCase();


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
                error.status ===
                404
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


            /* -----------------------------------------
               DATA URL
            ----------------------------------------- */

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


            /* -----------------------------------------
               Vérifier si le fichier existe
            ----------------------------------------- */

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
                    error.status !==
                    404
                ) {

                    throw error;

                }

            }


            /* -----------------------------------------
               Upload
            ----------------------------------------- */

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

<p>
Repository :
${GITHUB_OWNER}/${GITHUB_REPO}
</p>

<p>
<a href="/api/status">
API STATUS
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
            "Repository :",
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Branch :",
            GITHUB_BRANCH
        );

        console.log(
            "================================="
        );

    }
);
