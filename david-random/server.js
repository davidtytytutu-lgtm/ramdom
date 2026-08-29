const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION GITHUB
// ============================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.error("ERREUR : variables GitHub manquantes !");
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

app.use(express.static(__dirname));

// ============================================================
// GITHUB API
// ============================================================

async function githubRequest(url, options = {}) {

    const response = await fetch(url, {
        ...options,

        headers: {
            "Authorization": `Bearer ${GITHUB_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",

            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {

        console.error("GitHub API error:", response.status, data);

        throw new Error(
            `GitHub API ${response.status}`
        );
    }

    return data;
}

// ============================================================
// TEST SERVER
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({
        online: true,
        name: "David Random",
        server: "Render",
        github: !!GITHUB_TOKEN,
        time: new Date().toISOString()
    });

});

// ============================================================
// UPLOAD FILE → GITHUB
// ============================================================

app.post("/api/upload", async (req, res) => {

    try {

        const {
            filename,
            content,
            folder
        } = req.body;

        if (!filename || !content || !folder) {

            return res.status(400).json({
                success: false,
                error: "filename, content et folder sont requis"
            });

        }

        // Dossiers autorisés
        const allowedFolders = [
            "images",
            "music",
            "videos"
        ];

        if (!allowedFolders.includes(folder)) {

            return res.status(400).json({
                success: false,
                error: "Dossier interdit"
            });

        }

        // Nettoyage du nom de fichier
        const safeFilename =
            path.basename(filename)
                .replace(/[^a-zA-Z0-9._-]/g, "_");

        const githubPath =
            `${folder}/${safeFilename}`;

        // Conversion Base64
        let base64Content = content;

        // Si le navigateur envoie :
        // data:image/png;base64,XXXX
        // on retire la partie "data:..."
        if (content.includes(",")) {

            base64Content =
                content.split(",")[1];
        }

        // Vérifie si le fichier existe déjà
        let sha = undefined;

        try {

            const existing =
                await githubRequest(
                    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(githubPath)}?ref=${GITHUB_BRANCH}`
                );

            sha = existing.sha;

        } catch {
            // Le fichier n'existe pas : normal
        }

        const body = {

            message:
                `${sha ? "Update" : "Add"} ${githubPath}`,

            content: base64Content,

            branch: GITHUB_BRANCH
        };

        if (sha) {
            body.sha = sha;
        }

        const result =
            await githubRequest(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}`,
                {
                    method: "PUT",
                    body: JSON.stringify(body)
                }
            );

        res.json({

            success: true,

            path: githubPath,

            url:
                result.content?.html_url || null,

            download:
                `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${githubPath}`

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error:
                "Impossible d'envoyer le fichier sur GitHub"

        });

    }

});

// ============================================================
// LISTE DES FICHIERS
// ============================================================

app.get("/api/files/:folder", async (req, res) => {

    try {

        const folder = req.params.folder;

        const allowedFolders = [
            "images",
            "music",
            "videos"
        ];

        if (!allowedFolders.includes(folder)) {

            return res.status(400).json({
                success: false,
                error: "Dossier interdit"
            });

        }

        const files =
            await githubRequest(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${folder}?ref=${GITHUB_BRANCH}`
            );

        const result =
            files
                .filter(file => file.type === "file")
                .map(file => ({

                    name: file.name,

                    path: file.path,

                    size: file.size,

                    download:
                        `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file.path}`

                }));

        res.json({

            success: true,

            folder,

            files: result

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error:
                "Impossible de récupérer les fichiers"

        });

    }

});

// ============================================================
// CHAT / LOG
// ============================================================

app.post("/api/chat", async (req, res) => {

    try {

        const {
            username,
            message
        } = req.body;

        if (!username || !message) {

            return res.status(400).json({

                success: false,

                error:
                    "username et message sont requis"

            });

        }

        const now = new Date();

        const date =
            now.toISOString().slice(0, 10);

        const time =
            now.toISOString().slice(11, 19);

        const filename =
            `${date}.log`;

        const githubPath =
            `chat-log/${filename}`;

        const newLine =
            `[${time}] ${username}: ${message}\n`;

        let oldContent = "";
        let sha = undefined;

        // Récupérer le log existant
        try {

            const existing =
                await githubRequest(
                    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}?ref=${GITHUB_BRANCH}`
                );

            sha = existing.sha;

            oldContent =
                Buffer.from(
                    existing.content.replace(/\n/g, ""),
                    "base64"
                ).toString("utf8");

        } catch {
            // Nouveau fichier
        }

        const finalContent =
            oldContent + newLine;

        const base64 =
            Buffer.from(finalContent)
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

            body.sha = sha;

        }

        const result =
            await githubRequest(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}`,
                {
                    method: "PUT",

                    body:
                        JSON.stringify(body)
                }
            );

        res.json({

            success: true,

            file:
                githubPath

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            error:
                "Impossible d'enregistrer le message"

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
Cette page n'existe pas.
</p>

<a href="/">
Retour à David Random
</a>

</body>

</html>
`);

});

// ============================================================
// START
// ============================================================

app.listen(PORT, "0.0.0.0", () => {

    console.log("=================================");
    console.log(" DAVID RANDOM SERVER");
    console.log("=================================");

    console.log(
        `Server running on port ${PORT}`
    );

    console.log(
        `GitHub repository: ${GITHUB_OWNER}/${GITHUB_REPO}`
    );

});
