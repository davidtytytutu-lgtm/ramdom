const express = require("express");
const path = require("path");

const app = express();

/* =========================================================
   CONFIGURATION
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

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

/*
    Si tes dossiers sont :

    david-random/image
    david-random/music
    david-random/video
    david-random/chat-log

    mets dans Render :

    GITHUB_MEDIA_ROOT=david-random

    Si tes dossiers sont directement :

    image
    music
    video
    chat-log

    mets :

    GITHUB_MEDIA_ROOT=

*/

const GITHUB_MEDIA_ROOT =
    process.env.GITHUB_MEDIA_ROOT || "";


/* =========================================================
   EXPRESS
========================================================= */

app.use(
    express.json({
        limit: "30mb"
    })
);


/* =========================================================
   FICHIERS STATIQUES
========================================================= */

/*
    Permet :

    https://david-random.onrender.com/

    de charger index.html.
*/

app.use(
    express.static(__dirname)
);


/* =========================================================
   GITHUB CONFIG
========================================================= */

const githubHeaders = {

    "Accept":
        "application/vnd.github+json",

    "Authorization":
        `Bearer ${GITHUB_TOKEN}`,

    "X-GitHub-Api-Version":
        "2022-11-28",

    "User-Agent":
        "David-Random-Server"

};


/* =========================================================
   UTILITAIRES
========================================================= */

function githubPath(...parts) {

    return parts
        .filter(
            part =>
                part !== undefined &&
                part !== null &&
                String(part).trim() !== ""
        )
        .map(
            part =>
                String(part)
                    .replace(/^\/+/, "")
                    .replace(/\/+$/, "")
        )
        .join("/");

}


function mediaPath(folder) {

    return githubPath(
        GITHUB_MEDIA_ROOT,
        folder
    );

}


function safeFilename(filename) {

    if (!filename) {

        return "file";

    }

    /*
        On empêche les chemins du genre :

        ../../server.js

        ou :

        folder/file.txt
    */

    return String(filename)
        .replace(/\\/g, "_")
        .replace(/\//g, "_")
        .replace(/\.\./g, "_")
        .replace(/[<>:"|?*\x00-\x1F]/g, "_")
        .trim()
        .substring(0, 180) || "file";

}


async function githubRequest(
    url,
    options = {}
) {

    if (!GITHUB_TOKEN) {

        throw new Error(
            "GITHUB_TOKEN n'est pas configuré dans Render."
        );

    }


    const response =
        await fetch(
            url,
            {
                ...options,

                headers: {
                    ...githubHeaders,
                    ...(options.headers || {})
                }
            }
        );


    const text =
        await response.text();


    let data = null;


    try {

        data =
            text
                ? JSON.parse(text)
                : null;

    }

    catch {

        data = {
            message: text
        };

    }


    if (!response.ok) {

        const error =
            new Error(
                `GitHub API ${response.status}: ` +
                `${data?.message || "Erreur inconnue"}`
            );


        error.status =
            response.status;


        error.github =
            data;


        throw error;

    }


    return data;

}


/* =========================================================
   ROOT
========================================================= */

app.get(
    "/",
    (req, res) => {

        const indexPath =
            path.join(
                __dirname,
                "index.html"
            );


        res.sendFile(
            indexPath,
            error => {

                if (error) {

                    console.error(
                        "Impossible de servir index.html :",
                        error
                    );


                    res
                        .status(500)
                        .send(
                            "index.html introuvable sur le serveur."
                        );

                }

            }
        );

    }
);


/* =========================================================
   API STATUS
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            online: true,

            name:
                "David Random",

            server:
                "Render",

            github:
                Boolean(GITHUB_TOKEN),

            repository:
                `${GITHUB_OWNER}/${GITHUB_REPO}`,

            branch:
                GITHUB_BRANCH,

            mediaRoot:
                GITHUB_MEDIA_ROOT || "(racine)",

            time:
                new Date().toISOString()

        });

    }
);


/* =========================================================
   API GITHUB TEST
========================================================= */

app.get(
    "/api/github",
    async (req, res) => {

        try {

            const data =
                await githubRequest(
                    `https://api.github.com/repos/` +
                    `${encodeURIComponent(GITHUB_OWNER)}/` +
                    `${encodeURIComponent(GITHUB_REPO)}`
                );


            res.json({

                success: true,

                message:
                    "Connexion GitHub OK",

                repository: {

                    name:
                        data.name,

                    owner:
                        data.owner?.login ||
                        GITHUB_OWNER,

                    private:
                        data.private,

                    default_branch:
                        data.default_branch

                }

            });

        }

        catch (error) {

            console.error(
                "GitHub test error:",
                error
            );


            res.status(
                error.status || 500
            ).json({

                success: false,

                error:
                    error.message,

                details:
                    "Regarde également les logs Render."

            });

        }

    }
);


/* =========================================================
   LISTE DES FICHIERS
========================================================= */

app.get(
    "/api/files/:folder",
    async (req, res) => {

        const folder =
            String(
                req.params.folder || ""
            ).toLowerCase();


        const allowedFolders = [
            "image",
            "music",
            "video",
            "chat-log"
        ];


        if (
            !allowedFolders.includes(folder)
        ) {

            return res
                .status(400)
                .json({

                    success: false,

                    error:
                        "Dossier interdit"

                });

        }


        const folderPath =
            mediaPath(folder);


        try {

            const url =
                `https://api.github.com/repos/` +
                `${encodeURIComponent(GITHUB_OWNER)}/` +
                `${encodeURIComponent(GITHUB_REPO)}/` +
                `contents/${folderPath}?ref=` +
                `${encodeURIComponent(GITHUB_BRANCH)}`;


            const data =
                await githubRequest(
                    url
                );


            /*
                GitHub renvoie un tableau
                lorsqu'on demande un dossier.
            */

            const files =
                Array.isArray(data)
                    ? data
                    : [];


            const result =
                files
                    .filter(
                        file =>
                            file.type === "file"
                    )
                    .map(
                        file => ({

                            name:
                                file.name,

                            path:
                                file.path,

                            size:
                                file.size,

                            sha:
                                file.sha,

                            download:
                                file.download_url ||
                                `https://raw.githubusercontent.com/` +
                                `${GITHUB_OWNER}/` +
                                `${GITHUB_REPO}/` +
                                `${encodeURIComponent(file.path)}` +
                                `?raw=1`

                        })
                    );


            return res.json({

                success: true,

                folder,

                githubPath:
                    folderPath,

                files:
                    result

            });

        }

        catch (error) {

            /*
                Un dossier GitHub qui n'existe pas
                donne 404.

                Pour notre site, on considère
                simplement qu'il est vide.
            */

            if (
                error.status === 404
            ) {

                return res.json({

                    success: true,

                    folder,

                    githubPath:
                        folderPath,

                    files: []

                });

            }


            console.error(
                `Erreur lecture /${folderPath}/ :`,
                error
            );


            return res
                .status(
                    error.status || 500
                )
                .json({

                    success: false,

                    error:
                        error.message,

                    details:
                        error.github || null

                });

        }

    }
);


/* =========================================================
   RÉCUPÉRER UN FICHIER
========================================================= */

app.get(
    "/api/file/:folder/:filename",
    async (req, res) => {

        const folder =
            String(
                req.params.folder || ""
            ).toLowerCase();


        const filename =
            safeFilename(
                req.params.filename
            );


        const allowedFolders = [
            "image",
            "music",
            "video",
            "chat-log"
        ];


        if (
            !allowedFolders.includes(folder)
        ) {

            return res
                .status(400)
                .json({

                    success: false,

                    error:
                        "Dossier interdit"

                });

        }


        try {

            const filePath =
                githubPath(
                    mediaPath(folder),
                    filename
                );


            const url =
                `https://api.github.com/repos/` +
                `${encodeURIComponent(GITHUB_OWNER)}/` +
                `${encodeURIComponent(GITHUB_REPO)}/` +
                `contents/${filePath}?ref=` +
                `${encodeURIComponent(GITHUB_BRANCH)}`;


            const data =
                await githubRequest(
                    url
                );


            res.json({

                success: true,

                name:
                    data.name,

                path:
                    data.path,

                sha:
                    data.sha,

                download:
                    data.download_url,

                content:
                    data.content
                        ? Buffer
                            .from(
                                data.content.replace(
                                    /\n/g,
                                    ""
                                ),
                                "base64"
                            )
                            .toString(
                                "utf8"
                            )
                        : null

            });

        }

        catch (error) {

            console.error(
                "File error:",
                error
            );


            res
                .status(
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
   UPLOAD GITHUB
========================================================= */

app.post(
    "/api/upload",
    async (req, res) => {

        try {

            const {
                filename,
                content,
                folder
            } = req.body;


            const allowedFolders = [
                "image",
                "music",
                "video"
            ];


            if (
                !allowedFolders.includes(
                    folder
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Dossier interdit"

                    });

            }


            if (!filename) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Nom de fichier manquant"

                    });

            }


            if (!content) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Contenu du fichier manquant"

                    });

            }


            /*
                Le HTML envoie un Data URL :

                data:image/png;base64,AAAA...

                On récupère seulement le Base64.
            */

            let base64 =
                String(content);


            if (
                base64.includes(",")
            ) {

                base64 =
                    base64.split(",")[1];

            }


            base64 =
                base64.replace(
                   (/\s/g),
                    ""
                );


            if (!base64) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Contenu Base64 vide"

                    });

            }


            /*
                Limite de sécurité :
                environ 25 MB décodés.
            */

            const estimatedSize =
                Math.floor(
                    base64.length * 0.75
                );


            const MAX_SIZE =
                25 * 1024 * 1024;


            if (
                estimatedSize >
                MAX_SIZE
            ) {

                return res
                    .status(413)
                    .json({

                        success: false,

                        error:
                            "Fichier trop gros. Maximum 25 MB."

                    });

            }


            const cleanFilename =
                safeFilename(
                    filename
                );


            const filePath =
                githubPath(
                    mediaPath(folder),
                    cleanFilename
                );


            /*
                On vérifie si le fichier existe
                déjà afin de récupérer son SHA.
            */

            let existingSha =
                null;


            try {

                const existing =
                    await githubRequest(
                        `https://api.github.com/repos/` +
                        `${encodeURIComponent(GITHUB_OWNER)}/` +
                        `${encodeURIComponent(GITHUB_REPO)}/` +
                        `contents/${filePath}?ref=` +
                        `${encodeURIComponent(GITHUB_BRANCH)}`
                    );


                existingSha =
                    existing.sha || null;

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
                        ? `Update ${filePath}`
                        : `Upload ${filePath}`,

                content:
                    base64,

                branch:
                    GITHUB_BRANCH

            };


            if (existingSha) {

                body.sha =
                    existingSha;

            }


            const result =
                await githubRequest(
                    `https://api.github.com/repos/` +
                    `${encodeURIComponent(GITHUB_OWNER)}/` +
                    `${encodeURIComponent(GITHUB_REPO)}/` +
                    `contents/${filePath}`,
                    {

                        method:
                            "PUT",

                        body:
                            JSON.stringify(body)

                    }
                );


            const download =
                result.content?.download_url ||
                `https://raw.githubusercontent.com/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/` +
                `${filePath}`;


            console.log(
                "UPLOAD OK:",
                filePath
            );


            res.json({

                success: true,

                message:
                    "Fichier envoyé sur GitHub",

                folder,

                path:
                    filePath,

                name:
                    cleanFilename,

                sha:
                    result.content?.sha ||
                    null,

                download

            });

        }

        catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );


            res
                .status(
                    error.status || 500
                )
                .json({

                    success: false,

                    error:
                        error.message,

                    details:
                        error.github || null

                });

        }

    }
);


/* =========================================================
   CHAT
========================================================= */

app.get(
    "/api/chat",
    async (req, res) => {

        const folder =
            mediaPath(
                "chat-log"
            );


        try {

            const url =
                `https://api.github.com/repos/` +
                `${encodeURIComponent(GITHUB_OWNER)}/` +
                `${encodeURIComponent(GITHUB_REPO)}/` +
                `contents/${folder}?ref=` +
                `${encodeURIComponent(GITHUB_BRANCH)}`;


            const data =
                await githubRequest(
                    url
                );


            const files =
                Array.isArray(data)
                    ? data
                    : [];


            const logs =
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

                            download:
                                file.download_url

                        })
                    );


            res.json({

                success: true,

                files:
                    logs

            });

        }

        catch (error) {

            if (
                error.status === 404
            ) {

                return res.json({

                    success: true,

                    files: []

                });

            }


            console.error(
                "CHAT GET ERROR:",
                error
            );


            res
                .status(
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
   ENVOI CHAT
========================================================= */

app.post(
    "/api/chat",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body.username || ""
                )
                .trim()
                .substring(
                    0,
                    24
                );


            const message =
                String(
                    req.body.message || ""
                )
                .trim()
                .substring(
                    0,
                    500
                );


            if (!username) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Pseudo manquant"

                    });

            }


            if (!message) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Message manquant"

                    });

            }


            const now =
                new Date();


            const timestamp =
                now.toISOString();


            /*
                Nom unique du log.

                Exemple :

                2026-08-29T15-40-12-123Z.txt
            */

            const filename =
                timestamp
                    .replace(
                        /[:.]/g,
                        "-"
                    ) +
                "-" +
                Math.random()
                    .toString(36)
                    .substring(
                        2,
                        8
                    ) +
                ".txt";


            const filePath =
                githubPath(
                    mediaPath(
                        "chat-log"
                    ),
                    filename
                );


            const text =
`[${timestamp}]
USER: ${username}
MESSAGE: ${message}
----------------------------------------
`;


            const base64 =
                Buffer
                    .from(
                        text,
                        "utf8"
                    )
                    .toString(
                        "base64"
                    );


            const result =
                await githubRequest(
                    `https://api.github.com/repos/` +
                    `${encodeURIComponent(GITHUB_OWNER)}/` +
                    `${encodeURIComponent(GITHUB_REPO)}/` +
                    `contents/${filePath}`,
                    {

                        method:
                            "PUT",

                        body:
                            JSON.stringify({

                                message:
                                    `Chat message ${username}`,

                                content:
                                    base64,

                                branch:
                                    GITHUB_BRANCH

                            })

                    }
                );


            res.json({

                success: true,

                message:
                    "Message enregistré",

                path:
                    filePath,

                sha:
                    result.content?.sha ||
                    null

            });

        }

        catch (error) {

            console.error(
                "CHAT POST ERROR:",
                error
            );


            res
                .status(
                    error.status || 500
                )
                .json({

                    success: false,

                    error:
                        error.message,

                    details:
                        error.github || null

                });

        }

    }
);


/* =========================================================
   ROUTE API 404
========================================================= */

/*
    IMPORTANT :

    Les routes /api/... doivent renvoyer
    du JSON et PAS index.html.

    Cela empêche l'erreur :

    Unexpected token '<'
*/

app.use(
    "/api",
    (req, res) => {

        res
            .status(404)
            .json({

                success: false,

                error:
                    "API route introuvable",

                path:
                    req.originalUrl

            });

    }
);


/* =========================================================
   ERREUR GÉNÉRALE
========================================================= */

app.use(
    (err, req, res, next) => {

        console.error(
            "SERVER ERROR:",
            err
        );


        if (
            req.originalUrl.startsWith(
                "/api/"
            )
        ) {

            return res
                .status(500)
                .json({

                    success: false,

                    error:
                        err.message ||
                        "Erreur serveur"

                });

        }


        res
            .status(500)
            .send(
                "Erreur serveur."
            );

    }
);


/* =========================================================
   START
========================================================= */

app.listen(
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
            "Server running on port " +
            PORT
        );

        console.log(
            "Repository: " +
            `${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            "Branch: " +
            GITHUB_BRANCH
        );

        console.log(
            "Media root: " +
            (GITHUB_MEDIA_ROOT || "(racine)")
        );

        console.log(
            "GitHub token: " +
            (GITHUB_TOKEN
                ? "CONFIGURED"
                : "MISSING")
        );

    }
);
