const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const GITHUB_OWNER =
    process.env.GITHUB_OWNER || "davidtytytutu-lgtm";

const GITHUB_REPO =
    process.env.GITHUB_REPO || "ramdom";

const GITHUB_BRANCH =
    process.env.GITHUB_BRANCH || "main";

const GITHUB_TOKEN =
    process.env.GITHUB_TOKEN;


/* =========================================================
   CONFIG
========================================================= */

const ALLOWED_FOLDERS = [
    "image",
    "music",
    "video",
    "chat-log"
];


/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({
    limit: "35mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "35mb"
}));


app.use(express.static(
    path.join(__dirname)
));


/* =========================================================
   GITHUB HELPER
========================================================= */

function githubHeaders() {

    return {

        "Authorization":
            `Bearer ${GITHUB_TOKEN}`,

        "Accept":
            "application/vnd.github+json",

        "X-GitHub-Api-Version":
            "2022-11-28",

        "User-Agent":
            "David-Random"

    };

}


/* =========================================================
   STATUS
========================================================= */

app.get(
    "/api/status",
    async (req, res) => {

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

            time:
                new Date().toISOString()

        });

    }
);


/* =========================================================
   GITHUB TEST
========================================================= */

app.get(
    "/api/github-test",
    async (req, res) => {

        try {

            if (!GITHUB_TOKEN) {

                return res.status(500).json({

                    success: false,

                    error:
                        "GITHUB_TOKEN manquant"

                });

            }


            const url =
                `https://api.github.com/repos/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}`;


            const response =
                await fetch(
                    url,
                    {

                        headers:
                            githubHeaders()

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    success: false,

                    error:
                        `GitHub API ${response.status}: ${data.message || "Erreur"}`

                });

            }


            res.json({

                success: true,

                message:
                    "Connexion GitHub OK",

                repository: {

                    name:
                        data.name,

                    owner:
                        data.owner.login,

                    private:
                        data.private,

                    default_branch:
                        data.default_branch

                }

            });

        }

        catch (error) {

            console.error(
                "GitHub test:",
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


/* =========================================================
   LIST FILES
========================================================= */

app.get(
    "/api/files/:folder",
    async (req, res) => {

        try {

            const folder =
                req.params.folder;


            console.log(
                `[FILES] Requested folder: ${folder}`
            );


            /*
               Sécurité
            */

            if (
                !ALLOWED_FOLDERS.includes(
                    folder
                )
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Dossier interdit",

                    allowed:
                        ALLOWED_FOLDERS

                });

            }


            const url =
                `https://api.github.com/repos/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/contents/` +
                `${folder}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;


            console.log(
                `[GITHUB] GET ${url}`
            );


            const response =
                await fetch(
                    url,
                    {

                        headers:
                            githubHeaders()

                    }
                );


            /*
               GitHub retourne 404 lorsqu'un dossier
               n'existe pas encore.

               On transforme donc le 404 en dossier vide.
            */

            if (
                response.status === 404
            ) {

                console.log(
                    `[GITHUB] Folder ${folder} does not exist yet`
                );


                return res.json({

                    success: true,

                    folder:

                        folder,

                    files: []

                });

            }


            const data =
                await response.json();


            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    success: false,

                    error:
                        `GitHub API ${response.status}: ${data.message || "Not Found"}`,

                    details:
                        "Vérifie le dépôt, la branche et le token Render."

                });

            }


            if (!Array.isArray(data)) {

                return res.json({

                    success: true,

                    folder:

                        folder,

                    files: []

                });

            }


            const files =
                data

                    .filter(
                        file =>
                            file.type === "file"
                    )

                    .filter(
                        file =>
                            !file.name
                                .toLowerCase()
                                .endsWith(".gitkeep")
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
                                file.download_url,

                            github:
                                file.html_url

                        })
                    );


            res.json({

                success: true,

                folder:

                    folder,

                files:

                    files

            });

        }

        catch (error) {

            console.error(
                "[FILES ERROR]",
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


/* =========================================================
   UPLOAD
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


            console.log(
                `[UPLOAD] ${folder}/${filename}`
            );


            /*
               Vérifications
            */

            if (
                !ALLOWED_FOLDERS.includes(
                    folder
                )
            ) {

                return res.status(403).json({

                    success: false,

                    error:
                        "Dossier interdit"

                });

            }


            if (!filename) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Nom de fichier manquant"

                });

            }


            if (!content) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Fichier manquant"

                });

            }


            /*
               Empêche les chemins dangereux.
            */

            const cleanFilename =
                path.basename(
                    filename
                );


            /*
               Convertit le Data URL Base64
               envoyé par le HTML.
            */

            let base64;


            if (
                content.startsWith(
                    "data:"
                )
            ) {

                const comma =
                    content.indexOf(",");


                if (comma === -1) {

                    return res.status(400).json({

                        success: false,

                        error:
                            "Format Base64 invalide"

                    });

                }


                base64 =
                    content.substring(
                        comma + 1
                    );

            }

            else {

                base64 =
                    content;

            }


            const githubPath =
                `${folder}/${cleanFilename}`;


            const url =
                `https://api.github.com/repos/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/contents/` +
                `${githubPath}`;


            /*
               Vérifie si le fichier existe déjà.
               Si oui, GitHub demande son SHA pour
               pouvoir le remplacer.
            */

            let sha =
                undefined;


            const existing =
                await fetch(
                    `${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
                    {

                        headers:
                            githubHeaders()

                    }
                );


            if (existing.ok) {

                const existingData =
                    await existing.json();


                sha =
                    existingData.sha;

            }


            /*
               Création / modification GitHub
            */

            const body = {

                message:
                    `Upload ${githubPath}`,

                content:
                    base64,

                branch:
                    GITHUB_BRANCH

            };


            if (sha) {

                body.sha =
                    sha;

            }


            const response =
                await fetch(
                    url,
                    {

                        method:
                            "PUT",

                        headers: {

                            ...githubHeaders(),

                            "Content-Type":
                                "application/json"

                        },

                        body:
                            JSON.stringify(
                                body
                            )

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                console.error(
                    "[GITHUB UPLOAD ERROR]",
                    data
                );


                return res.status(
                    response.status
                ).json({

                    success: false,

                    error:
                        `GitHub API ${response.status}: ${data.message || "Upload impossible"}`,

                    details:
                        data

                });

            }


            console.log(
                `[UPLOAD OK] ${githubPath}`
            );


            res.json({

                success: true,

                message:
                    "Fichier envoyé sur GitHub",

                folder:
                    folder,

                filename:
                    cleanFilename,

                path:
                    githubPath,

                download:
                    data.content.download_url,

                github:
                    data.content.html_url

            });

        }

        catch (error) {

            console.error(
                "[UPLOAD ERROR]",
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


/* =========================================================
   CHAT
========================================================= */

app.post(
    "/api/chat",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body.username || ""
                ).trim();


            const message =
                String(
                    req.body.message || ""
                ).trim();


            if (!username) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Pseudo manquant"

                });

            }


            if (!message) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Message manquant"

                });

            }


            const timestamp =
                new Date().toISOString();


            const safeUsername =
                username
                    .replace(
                        /[^a-zA-Z0-9_-]/g,
                        "_"
                    )
                    .substring(
                        0,
                        24
                    );


            const line =
                `[${timestamp}] ` +
                `${safeUsername}: ` +
                `${message}\n`;


            const filename =
                `${new Date()
                    .toISOString()
                    .slice(0, 10)}.txt`;


            const githubPath =
                `chat-log/${filename}`;


            const url =
                `https://api.github.com/repos/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/contents/` +
                `${githubPath}`;


            /*
               Cherche le log actuel.
            */

            let oldContent =
                "";


            let sha =
                undefined;


            const existing =
                await fetch(
                    `${url}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
                    {

                        headers:
                            githubHeaders()

                    }
                );


            if (existing.ok) {

                const data =
                    await existing.json();


                sha =
                    data.sha;


                if (data.content) {

                    oldContent =
                        Buffer
                            .from(
                                data.content,
                                "base64"
                            )
                            .toString(
                                "utf8"
                            );

                }

            }


            const newContent =
                oldContent +
                line;


            const body = {

                message:
                    `Chat log ${filename}`,

                content:
                    Buffer
                        .from(
                            newContent,
                            "utf8"
                        )
                        .toString(
                            "base64"
                        ),

                branch:
                    GITHUB_BRANCH

            };


            if (sha) {

                body.sha =
                    sha;

            }


            const response =
                await fetch(
                    url,
                    {

                        method:
                            "PUT",

                        headers: {

                            ...githubHeaders(),

                            "Content-Type":
                                "application/json"

                        },

                        body:
                            JSON.stringify(
                                body
                            )

                    }
                );


            const data =
                await response.json();


            if (!response.ok) {

                return res.status(
                    response.status
                ).json({

                    success: false,

                    error:
                        `GitHub API ${response.status}: ${data.message || "Erreur chat"}`

                });

            }


            res.json({

                success: true,

                message:
                    "Message enregistré",

                log:
                    githubPath

            });

        }

        catch (error) {

            console.error(
                "[CHAT ERROR]",
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


/* =========================================================
   404 API
========================================================= */

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            success: false,

            error:
                "API endpoint introuvable",

            path:
                req.originalUrl

        });

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
            `Server running on port ${PORT}`
        );

        console.log(
            `GitHub repository: ${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            `GitHub branch: ${GITHUB_BRANCH}`
        );

        console.log(
            `GitHub token: ${
                GITHUB_TOKEN
                    ? "OK"
                    : "MISSING"
            }`
        );

        console.log(
            "Folders:"
        );

        console.log(
            ALLOWED_FOLDERS.join(
                ", "
            )
        );

    }
);
