const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();

const PORT = process.env.PORT || 10000;

/* =========================================================
   EXPRESS
========================================================= */

app.use(express.json({ limit: "30mb" }));


/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer(app);


/* =========================================================
   WEBSOCKET SERVER
========================================================= */

const wss = new WebSocket.Server({
    server: server
});


/* =========================================================
   WEB SOCKET CONNECTION
========================================================= */

wss.on("connection", (socket, request) => {

    console.log(
        "[WSS] Nouveau client connecté"
    );


    socket.send(
        JSON.stringify({
            type: "system",
            message: "Connexion à David Random réussie."
        })
    );


    socket.on("message", (rawMessage) => {

        try {

            const data =
                JSON.parse(
                    rawMessage.toString()
                );


            console.log(
                "[WSS] Message reçu :",
                data
            );


            /* -----------------------------------------
               CHAT
            ----------------------------------------- */

            if (
                data.type === "chat"
            ) {

                const username =
                    String(
                        data.username || "Anonymous"
                    )
                    .substring(0, 24);


                const message =
                    String(
                        data.message || ""
                    )
                    .substring(0, 500);


                if (!message.trim()) {

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
                        new Date().toISOString()

                };


                /* -----------------------------------------
                   ENVOYER À TOUS
                ----------------------------------------- */

                broadcast(
                    chatMessage
                );

            }

        }

        catch (error) {

            console.error(
                "[WSS] Message invalide :",
                error
            );


            socket.send(
                JSON.stringify({
                    type: "system",
                    message: "Message invalide."
                })
            );

        }

    });


    socket.on("close", () => {

        console.log(
            "[WSS] Client déconnecté"
        );

    });


    socket.on("error", (error) => {

        console.error(
            "[WSS] Erreur socket :",
            error
        );

    });

});


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(data) {

    const message =
        JSON.stringify(data);


    wss.clients.forEach(
        client => {

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
   API STATUS
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            online:
                true,

            name:
                "David Random",

            server:
                "Render",

            websocket:
                true,

            github:
                Boolean(
                    process.env.GITHUB_TOKEN
                ),

            repository:
                "davidtytytutu-lgtm/ramdom",

            branch:
                "main",

            time:
                new Date().toISOString()

        });

    }
);


/* =========================================================
   TEST HTTP
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(`
            <!DOCTYPE html>

            <html>

            <head>

                <meta charset="UTF-8">

                <title>David Random Server</title>

                <style>

                    body {
                        background: #050505;
                        color: #00ff66;
                        font-family: monospace;
                        padding: 30px;
                    }

                    h1 {
                        color: #00ffff;
                    }

                </style>

            </head>

            <body>

                <h1>DAVID RANDOM SERVER</h1>

                <p>Render : ONLINE</p>

                <p>WebSocket : ONLINE</p>

                <p>
                    WebSocket endpoint :
                    <code>wss://david-random.onrender.com</code>
                </p>

                <p>
                    API :
                    <a href="/api/status">
                        /api/status
                    </a>
                </p>

            </body>

            </html>
        `);

    }
);


/* =========================================================
   START SERVER
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
            "HTTP server running on port " +
            PORT
        );

        console.log(
            "WebSocket server enabled"
        );

        console.log(
            "WSS endpoint:"
        );

        console.log(
            "wss://david-random.onrender.com"
        );

    }
);
