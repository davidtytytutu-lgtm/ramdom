const express = require("express");
const path = require("path");

const app = express();

// Render fournit automatiquement le port.
// En local, on utilisera 3000.
const PORT = process.env.PORT || 3000;

// Permet de recevoir du JSON
app.use(express.json({ limit: "10mb" }));

// Sert les fichiers du site
app.use(express.static(path.join(__dirname)));

// Petite API de test
app.get("/api/status", (req, res) => {
    res.json({
        online: true,
        name: "David Random",
        server: "Render",
        time: new Date().toISOString()
    });
});

// Page 404
app.use((req, res) => {
    res.status(404).send(`
        <html>
        <head>
            <title>404 - David Random</title>
            <style>
                body {
                    background:#050805;
                    color:#35ff5a;
                    font-family:monospace;
                    padding:40px;
                }
            </style>
        </head>
        <body>
            <h1>404 - FILE NOT FOUND</h1>
            <p>Cette page n'existe pas.</p>
            <a href="/">Retour à David Random</a>
        </body>
        </html>
    `);
});

// Démarrage du serveur
app.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log(" DAVID RANDOM SERVER");
    console.log("=================================");
    console.log(`Server running on port ${PORT}`);
});
