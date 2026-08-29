const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION
// ============================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

console.log("=================================");
console.log(" DAVID RANDOM SERVER");
console.log("=================================");
console.log("GitHub owner :", GITHUB_OWNER || "MISSING");
console.log("GitHub repo  :", GITHUB_REPO || "MISSING");
console.log("GitHub branch:", GITHUB_BRANCH);
console.log(
    "GitHub token :",
    GITHUB_TOKEN ? "OK" : "MISSING"
);

if (!GITHUB_TOKEN) {
    console.error("ERREUR : GITHUB_TOKEN manquant !");
}

if (!GITHUB_OWNER) {
    console.error("ERREUR : GITHUB_OWNER manquant !");
}

if (!GITHUB_REPO) {
    console.error("ERREUR : GITHUB_REPO manquant !");
}

// ============================================================
// EXPRESS
// ============================================================

app.use(express.json({
    limit: "30mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "30mb"
}));

// Sert index.html et les autres fichiers
app.use(express.static(__dirname));

// ============================================================
// GITHUB REQUEST
// ============================================================

async function githubRequest(url, options = {}) {

    if (!GITHUB_TOKEN) {
        throw new Error(
            "GITHUB_TOKEN est manquant dans Render"
        );
    }

    const response = await fetch(url, {

        ...options,

        headers: {

            "Authorization":
                `Bearer ${GITHUB_TOKEN}`,

            "Accept":
                "application/vnd.github+json",

            "X-GitHub-Api-Version":
                "2022-11-28",

            "Content-Type":
                "application/json",

            ...(options.headers || {})
        }

    });

    const text =
        await response.text();

    let data;

    try {

        data =
            JSON.parse(text);

    } catch {

        data =
            text;

    }

    if (!response.ok) {

        console.error(
            "================================="
        );

        console.error(
            "GITHUB API ERROR"
        );

        console.error(
            "Status:",
            response.status
        );

        console.error(
            "Response:",
            data
        );

        console.error(
            "URL:",
            url
        );

        console.error(
            "================================="
        );

        throw new Error(
            `GitHub API ${response.status}: ${
                data?.message || "Unknown error"
            }`
        );

    }

    return data;
}

// ============================================================
// STATUS
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({

        online: true,

        name:
            "David Random",

        server:
            "Render",

        github:
            !!GITHUB_TOKEN,

        repository:
            GITHUB_OWNER && GITHUB_REPO
                ? `${GITHUB_OWNER}/${GITHUB_REPO}`
                : null,

        branch:
            GITHUB_BRANCH,

        time:
            new Date().toISOString()

    });

});

// ============================================================
// TEST GITHUB
// ============================================================

app.get("/api/github-test", async (req, res) => {

    try {

        const repository =
            await githubRequest(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`
            );

        res.json({

            success: true,

            message:
                "Connexion GitHub OK",

            repository: {

                name:
                    repository.name,

                owner:
                    repository.owner.login,

                private:
                    repository.private,

                default_branch:
                    repository.default_branch

            }

        });

    } catch (error) {

        console.error(
            "GitHub test error:",
            error
        );

        res.status(500).json({

            success: false,

            error:
                error.message

        });

    }

});

// ============================================================
// LIST FILES
// ============================================================

app.get("/api/files/:folder", async (req, res) => {

    try {

        const folder =
            req.params.folder;

        const allowedFolders = [

            "images",
            "music",
            "videos"

        ];

        if (
            !allowedFolders.includes(folder)
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Dossier interdit"

            });

        }

        const url =
            `https://api.github.com/repos/` +
            `${GITHUB_OWNER}/${GITHUB_REPO}/contents/` +
            `${folder}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

        console.log(
            "GitHub files request:",
            url
        );

        const files =
            await githubRequest(url);

        const result =
            Array.isArray(files)

                ? files

                    .filter(
                        file =>
                            file.type === "file"
                    )

                    .map(file => ({

                        name:
                            file.name,

                        path:
                            file.path,

                        size:
                            file.size,

                        download:
                            `https://raw.githubusercontent.com/` +
                            `${GITHUB_OWNER}/` +
                            `${GITHUB_REPO}/` +
                            `${GITHUB_BRANCH}/` +
                            `${file.path}`

                    }))

                : [];

        res.json({

            success:
                true,

            folder:
                folder,

            files:
                result

        });

    } catch (error) {

        console.error(
            "================================="
        );

        console.error(
            "ERREUR /api/files/"
        );

        console.error(
            error
        );

        console.error(
            "================================="
        );

        res.status(500).json({

            success:
                false,

            error:
                error.message,

            details:
                "Regarde également les logs Render."

        });

    }

});

// ============================================================
// UPLOAD
// ============================================================

app.post("/api/upload", async (req, res) => {

    try {

        const {
            filename,
            content,
            folder
        } = req.body;

        if (
            !filename ||
            !content ||
            !folder
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "filename, content et folder sont requis"

            });

        }

const allowedFolders = [
    "image",
    "music",
    "video"
       ];

        if (
            !allowedFolders.includes(folder)
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Dossier interdit"

            });

        }

        const safeFilename =
            path
                .basename(filename)
                .replace(
                    /[^a-zA-Z0-9._-]/g,
                    "_"
                );

        const githubPath =
            `${folder}/${safeFilename}`;

        let base64Content =
            content;

        if (
            content.includes(",")
        ) {

            base64Content =
                content.split(",")[1];

        }

        let sha;

        // =====================================================
        // CHERCHE SI LE FICHIER EXISTE
        // =====================================================

        try {

            const existing =
                await githubRequest(

                    `https://api.github.com/repos/` +
                    `${GITHUB_OWNER}/${GITHUB_REPO}/contents/` +
                    `${githubPath}?ref=` +
                    `${encodeURIComponent(GITHUB_BRANCH)}`

                );

            sha =
                existing.sha;

        } catch (error) {

            // 404 = fichier inexistant
            // donc on peut le créer

            if (
                !error.message.includes(
                    "GitHub API 404"
                )
            ) {

                throw error;

            }

        }

        // =====================================================
        // UPLOAD GITHUB
        // =====================================================

        const body = {

            message:
                `${sha ? "Update" : "Add"} ${githubPath}`,

            content:
                base64Content,

            branch:
                GITHUB_BRANCH

        };

        if (sha) {

            body.sha =
                sha;

        }

        const result =
            await githubRequest(

                `https://api.github.com/repos/` +
                `${GITHUB_OWNER}/${GITHUB_REPO}/contents/` +
                `${githubPath}`,

                {

                    method:
                        "PUT",

                    body:
                        JSON.stringify(body)

                }

            );

        res.json({

            success:
                true,

            path:
                githubPath,

            url:
                result.content?.html_url ||
                null,

            download:
                `https://raw.githubusercontent.com/` +
                `${GITHUB_OWNER}/` +
                `${GITHUB_REPO}/` +
                `${GITHUB_BRANCH}/` +
                `${githubPath}`

        });

    } catch (error) {

        console.error(
            "================================="
        );

        console.error(
            "UPLOAD ERROR"
        );

        console.error(
            error
        );

        console.error(
            "================================="
        );

        res.status(500).json({

            success:
                false,

            error:
                error.message

        });

    }

});

// ============================================================
// CHAT LOG
// ============================================================

app.post("/api/chat", async (req, res) => {

    try {

        const {
            username,
            message
        } = req.body;

        if (
            !username ||
            !message
        ) {

            return res.status(400).json({

                success:
                    false,

                error:
                    "username et message sont requis"

            });

        }

        const cleanUsername =
            String(username)
                .slice(0, 24)
                .replace(
                    /[\r\n]/g,
                    ""
                );

        const cleanMessage =
            String(message)
                .slice(0, 500)
                .replace(
                    /\r/g,
                    ""
                );

        const now =
            new Date();

        const date =
            now.toISOString()
                .slice(0, 10);

        const time =
            now.toISOString()
                .slice(11, 19);

        const filename =
            `${date}.log`;

        const githubPath =
            `chat-log/${filename}`;

        const newLine =
            `[${time}] ${cleanUsername}: ${cleanMessage}\n`;

        let oldContent = "";
        let sha;

        // =====================================================
        // RÉCUPÉRER LE LOG
        // =====================================================

        try {

            const existing =
                await githubRequest(

                    `https://api.github.com/repos/` +
                    `${GITHUB_OWNER}/${GITHUB_REPO}/contents/` +
                    `${githubPath}?ref=` +
                    `${encodeURIComponent(GITHUB_BRANCH)}`

                );

            sha =
                existing.sha;

            oldContent =
                Buffer
                    .from(
                        existing.content
                            .replace(/\n/g, ""),
                        "base64"
                    )
                    .toString("utf8");

        } catch (error) {

            if (
                !error.message.includes(
                    "GitHub API 404"
                )
            ) {

                throw error;

            }

        }

        const finalContent =
            oldContent +
            newLine;

        const base64 =
            Buffer
                .from(finalContent)
                .toString("base64");

        const body = {

            message:
                `Chat log ${date}`,

            content:
                base64,

            branch:
                GITHUB_BRANCH

        };

        if (sha) {

            body.sha =
                sha;

        }

        await githubRequest(

            `https://api.github.com/repos/` +
            `${GITHUB_OWNER}/${GITHUB_REPO}/contents/` +
            `${githubPath}`,

            {

                method:
                    "PUT",

                body:
                    JSON.stringify(body)

            }

        );

        res.json({

            success:
                true,

            file:
                githubPath

        });

    } catch (error) {

        console.error(
            "CHAT ERROR:",
            error
        );

        res.status(500).json({

            success:
                false,

            error:
                error.message

        });

    }

});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {

    res.status(404).send(`

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>404 - DAVID RANDOM</title>

<style>

body {

    background:#050805;

    color:#35ff5a;

    font-family:monospace;

    padding:40px;

}

a {

    color:#35ff5a;

}

</style>

</head>

<body>

<h1>404 - FILE NOT FOUND</h1>

<p>

${req.method} ${req.originalUrl}

</p>

<a href="/">

RETURN TO DAVID RANDOM

</a>

</body>

</html>

`);

});

// ============================================================
// START SERVER
// ============================================================

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
            `GitHub: ${GITHUB_OWNER}/${GITHUB_REPO}`
        );

        console.log(
            `Branch: ${GITHUB_BRANCH}`
        );

    }
);
