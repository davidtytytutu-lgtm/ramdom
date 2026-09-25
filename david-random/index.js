"use strict";


/* =========================================================
   CONFIG
========================================================= */

const API =
"https://david-random.onrender.com";

const SOCKET_URL =
"wss://david-random.onrender.com/ws";

const TOKEN_KEY =
"david_random_token";

const USER_KEY =
"david_random_user";

const MAX_FILE_SIZE =
25 * 1024 * 1024;


/* =========================================================
   EMOTES
========================================================= */

const EMOTES = {

    /* =====================================================
       EMOTES DE BASE
    ===================================================== */

    nyan_cat:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/nyan-cat.gif",

    pepe_banger:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-banger.gif",

    pepe_chair:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-chair.gif",

    pepe_cross:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-cross.png",

    pepe_hacker:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-hacker.gif",

    pepe_rain:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-rain.gif",

    pepe_rich:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-rich.gif",

    pepe_uwu:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-uwu.gif",

    pepe_welcome:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-welcome.gif",

    wojak_cry:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-cry.png",

    wojak_dark:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-dark.png",

    wojak_devil:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-devil.png",

    wojak_pokerface:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-pokerface.png",

    wojak_tired:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-tired.png",

    wojak:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak.png",

    happy_face:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/happy-face-smiley-face.gif",


    /* =====================================================
       EMOTES DU SHOP
    ===================================================== */

    pepe_angry:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_angry.gif",

    pepe_cheer:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_cheer.gif",

    pepe_clap:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_clap.gif",

    pepe_dance:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_dance.gif",

    pepe_pug:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_pug.gif",

    pepe_song:
        "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/pepe_song.gif"

};


/* =========================================================
   AUTH
========================================================= */

let token =
localStorage.getItem(TOKEN_KEY) || null;

let currentUser = null;

let socket = null;

let socketConnected = false;

let socketReconnectTimer = null;


/* =========================================================
   EMOTE PICKER
========================================================= */

function initEmotePicker(){

    const grid =
        document.getElementById("emoteGrid");

    if(!grid) return;

    grid.innerHTML = "";


    /*
     * EMOTES DE BASE
     * Toujours disponibles
     */
    const baseEmotes = [

        "nyan_cat",
        "pepe_banger",
        "pepe_chair",
        "pepe_cross",
        "pepe_hacker",
        "pepe_rain",
        "pepe_rich",
        "pepe_uwu",
        "pepe_welcome",
        "wojak_cry",
        "wojak_dark",
        "wojak_devil",
        "wojak_pokerface",
        "wojak_tired",
        "wojak",
        "happy_face"

    ];


    /*
     * EMOTES POSSÉDÉES DU SHOP
     */
    const ownedShopEmotes =
        (
            typeof currentUser !== "undefined" &&
            currentUser &&
            Array.isArray(currentUser.owned_emotes)
        )
        ? currentUser.owned_emotes
        : [];


    const emotesToShow = [];


    /*
     * Ajouter les emotes normales
     */
    baseEmotes.forEach(name => {

        if(EMOTES[name]){

            emotesToShow.push({
                name: name,
                url: EMOTES[name]
            });

        }

    });


    /*
     * Ajouter les emotes achetées
     *
     * Exemple :
     * emote_pepe_dance
     *
     * devient :
     * pepe_dance
     */
    ownedShopEmotes.forEach(itemId => {

        if(typeof itemId !== "string"){
            return;
        }


        if(!itemId.startsWith("emote_")){
            return;
        }


        const name =
            itemId.substring(6);


        if(!EMOTES[name]){
            return;
        }


        /*
         * Éviter les doublons
         */
        if(
            emotesToShow.some(
                emote => emote.name === name
            )
        ){
            return;
        }


        emotesToShow.push({
            name: name,
            url: EMOTES[name]
        });

    });


    /*
     * Créer les éléments du picker
     */
    emotesToShow.forEach(
        ({name,url}) => {

            const item =
                document.createElement("div");

            item.className =
                "emote-item";

            item.title =
                ":" + name + ":";


            item.innerHTML = `
                <img
                    src="${url}"
                    alt="${name}"
                    loading="lazy"
                >

                <div class="emote-name">
                    :${name}:
                </div>
            `;


            item.addEventListener(
                "click",
                () => {

                    insertEmote(name);

                }
            );


            grid.appendChild(item);

        }
    );

}


/*
 * OUVRIR / FERMER LE PICKER
 *
 * On met explicitement les fonctions
 * sur window pour que :
 *
 * onclick="toggleEmotePicker()"
 *
 * puisse les trouver.
 */
window.toggleEmotePicker = function(){

    const picker =
        document.getElementById("emotePicker");

    const button =
        document.getElementById("emoteButton");

    if(!picker) return;


    /*
     * Reconstruire le picker à chaque ouverture
     */
    initEmotePicker();


    const open =
        picker.classList.toggle("open");


    if(button){

        button.classList.toggle(
            "active",
            open
        );

    }

};


/*
 * FERMER LE PICKER
 */
window.closeEmotePicker = function(){

    const picker =
        document.getElementById(
            "emotePicker"
        );

    const button =
        document.getElementById(
            "emoteButton"
        );


    if(picker){

        picker.classList.remove(
            "open"
        );

    }


    if(button){

        button.classList.remove(
            "active"
        );

    }

};


/*
 * INSÉRER UNE EMOTE
 */
window.insertEmote = function(name){

    const input =
        document.getElementById(
            "chatMessage"
        );


    if(!input) return;


    const code =
        ":" + name + ":";


    const start =
        input.selectionStart ??
        input.value.length;


    const end =
        input.selectionEnd ??
        input.value.length;


    input.value =
        input.value.slice(
            0,
            start
        ) +
        code +
        input.value.slice(
            end
        );


    const cursor =
        start +
        code.length;


    input.focus();


    input.setSelectionRange(
        cursor,
        cursor
    );


    window.closeEmotePicker();

};


/* =========================================================
   EMOTE RENDER
========================================================= */

function renderEmotes(text){

    const fragment =
        document.createDocumentFragment();


    const regex =
        /:([a-zA-Z0-9_-]+):/g;


    let lastIndex = 0;

    let match;


    while(
        (match =
            regex.exec(text))
        !== null
    ){

        const before =
            text.slice(
                lastIndex,
                match.index
            );


        if(before){

            fragment.appendChild(
                document.createTextNode(
                    before
                )
            );

        }


        const name =
            match[1];


        const url =
            EMOTES[name];


        if(url){

            const img =
                document.createElement(
                    "img"
                );

            img.className =
                "chat-emote";

            img.src =
                url;

            img.alt =
                ":" + name + ":";

            img.title =
                ":" + name + ":";

            img.loading =
                "lazy";

            fragment.appendChild(
                img
            );

        }else{

            fragment.appendChild(
                document.createTextNode(
                    match[0]
                )
            );

        }


        lastIndex =
            regex.lastIndex;

    }


    const remaining =
        text.slice(
            lastIndex
        );


    if(remaining){

        fragment.appendChild(
            document.createTextNode(
                remaining
            )
        );

    }


    return fragment;

}


/* =========================================================
   RESTORE USER
========================================================= */

function restoreSavedUser(){

    try{

        const saved =
            localStorage.getItem(
                USER_KEY
            );

        if(!saved){

            currentUser = null;

            return;

        }

        currentUser =
            JSON.parse(saved);

    }catch(error){

        console.error(
            "[AUTH]",
            error
        );

        localStorage.removeItem(
            USER_KEY
        );

        currentUser = null;

    }

}


/* =========================================================
   RESTORE SESSION
========================================================= */

async function restoreSession(){

    token =
        localStorage.getItem(
            TOKEN_KEY
        ) ||
        null;


    if(!token){

        currentUser =
            null;

        updateAccountUI();

        updateCoinsUI();

        return false;
    }


    try{

        const data =
            await apiRequest(
                "/api/account/me",
                {
                    method:"GET"
                }
            );


        if(
            !data ||
            !data.user
        ){

            throw new Error(
                "INVALID SESSION RESPONSE"
            );
        }


        currentUser =
            data.user;


        localStorage.setItem(
            USER_KEY,
            JSON.stringify(
                currentUser
            )
        );


        updateAccountUI();

        updateCoinsUI();


        return true;


    }catch(error){

        console.error(
            "[AUTH] Session invalide :",
            error
        );


        token =
            null;

        currentUser =
            null;


        localStorage.removeItem(
            TOKEN_KEY
        );

        localStorage.removeItem(
            USER_KEY
        );


        updateAccountUI();

        updateCoinsUI();


        console.log(
            "[AUTH] Déconnecté automatiquement"
        );


        return false;
    }

}

/* =========================================================
   EVENT PAGE
========================================================= */

function updateEventCoins(){

    const element =
        document.getElementById(
            "eventDavidCoins"
        );

    if(!element){
        return;
    }

    const coins =
        currentUser &&
        Number.isFinite(
            Number(currentUser.coins)
        )
        ? Math.max(
            0,
            Math.floor(
                Number(currentUser.coins)
            )
        )
        : 0;

    element.textContent =
        `◈ ${coins}`;
}


/* =========================================================
   EVENT BUY
========================================================= */

async function buyGlobalEvent(eventId){

    if(
        !currentUser ||
        !token
    ){

        alert(
            "Tu dois être connecté pour utiliser un événement."
        );

        return;
    }


    const PRICE = 100;


    const coins =
        Number(currentUser.coins);


    if(
        !Number.isFinite(coins) ||
        coins < PRICE
    ){

        const error =
            document.getElementById(
                "eventNotEnough"
            );

        if(error){

            error.style.display =
                "block";

            error.textContent =
                `NOT ENOUGH ◈ — ${PRICE} ◈ REQUIRED`;

            setTimeout(
                () => {
                    error.style.display =
                        "none";
                },
                2500
            );

        }else{

            alert(
                `Pas assez de DAVID COINS.\n\nPrix : ${PRICE} ◈\nSolde : ${coins || 0} ◈`
            );

        }

        return;
    }


    try{

        /*
         * Appel de l'API d'événement.
         *
         * Si ton serveur possède cette route,
         * l'achat sera traité côté serveur.
         */

        const response =
            await apiRequest(
                "/api/event/buy",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:JSON.stringify({
                        event:eventId
                    })
                }
            );


        if(
            !response ||
            !response.success
        ){

            throw new Error(
                response?.error ||
                "EVENT PURCHASE FAILED"
            );

        }


        /*
         * Synchroniser le nouveau solde
         */

        if(
            typeof response.coins === "number"
        ){

            currentUser.coins =
                response.coins;

        }else{

            currentUser.coins =
                coins - PRICE;

        }


        localStorage.setItem(
            USER_KEY,
            JSON.stringify(
                currentUser
            )
        );


        updateCoinsUI();
        updateEventCoins();


        console.log(
            "[EVENT] Achat réussi:",
            eventId
        );


    }catch(error){

        console.error(
            "[EVENT BUY]",
            error
        );


        alert(
            "Erreur événement : " +
            error.message
        );

    }

}


/* =========================================================
   EVENT BUTTONS
========================================================= */

function initEventButtons(){

    document
        .querySelectorAll(
            "[data-event]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const eventId =
                            button.dataset.event;

                        if(!eventId){
                            return;
                        }

                        buyGlobalEvent(
                            eventId
                        );

                    }
                );

            }
        );

}


/* =========================================================
   EVENT COINS SYNC
========================================================= */

function syncEventCoins(){

    updateEventCoins();

}


/* =========================================================
   INIT EVENT
========================================================= */

initEventButtons();
syncEventCoins();

/* =========================================================
   DAVID COINS // VIDEO AD
========================================================= */

const DAVID_AD_VIDEO =
    "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/Pub%20Beans%20-%20Un%20monstre%20attaque%20des%20astronautes%20sur%20la%20lune.mp4";

let davidAdPlaying = false;


async function watchDavidAd(){

    if(
        davidAdPlaying
    ){
        return;
    }

    if(
        !currentUser ||
        !token
    ){

        alert(
            "Tu dois être connecté pour gagner des DAVID COINS."
        );

        return;
    }

    davidAdPlaying = true;

    const button =
        document.getElementById(
            "watchAdButton"
        );

    const status =
        document.getElementById(
            "adStatus"
        );

    if(button){
        button.disabled = true;
        button.textContent =
            "[ PUBLICITÉ EN COURS... ]";
    }

    if(status){
        status.textContent =
            "Publicité en cours...";
    }


    const video =
        document.createElement(
            "video"
        );

    video.src =
        DAVID_AD_VIDEO;

    video.autoplay =
        true;

    video.playsInline =
        true;

    video.controls =
        false;

    video.preload =
        "auto";

    video.style.position =
        "fixed";

    video.style.inset =
        "0";

    video.style.width =
        "100vw";

    video.style.height =
        "100vh";

    video.style.objectFit =
        "contain";

    video.style.background =
        "#000";

    video.style.zIndex =
        "100000";

    video.style.cursor =
        "default";

    document.body.appendChild(
        video
    );


    let rewarded =
        false;


    video.addEventListener(
        "ended",
        async () => {

            if(rewarded){
                return;
            }

            rewarded = true;

            console.log(
                "[COINS AD] Vidéo terminée"
            );


            try{

                const data =
                    await apiRequest(
                        "/api/coins/reward",
                        {
                            method:
                                "POST"
                        }
                    );


                if(
                    !data ||
                    !data.success
                ){

                    throw new Error(
                        "REWARD FAILED"
                    );

                }


                currentUser.coins =
                    data.coins;


                localStorage.setItem(
                    USER_KEY,
                    JSON.stringify(
                        currentUser
                    )
                );


                updateCoinsUI();


                if(status){

                    status.textContent =
                        `Publicité terminée ! +${data.reward} ◈`;

                }


                console.log(
                    "[COINS AD]",
                    `+${data.reward} ◈`,
                    `Balance : ${data.coins} ◈`
                );


            }catch(error){

                console.error(
                    "[COINS AD]",
                    error
                );

                if(status){

                    status.textContent =
                        "Erreur lors de la récompense.";

                }

            }


            await closeDavidAd(
                video
            );

        }
    );


    video.addEventListener(
        "error",
        async () => {

            console.error(
                "[COINS AD] Erreur vidéo"
            );

            if(status){

                status.textContent =
                    "Impossible de charger la publicité.";

            }

            await closeDavidAd(
                video
            );

        }
    );


    try{

        /*
         * Le clic sur le bouton fournit
         * l'activation utilisateur nécessaire
         * pour demander le plein écran.
         */

        if(
            video.requestFullscreen
        ){

            await video.requestFullscreen();

        }

    }catch(error){

        console.warn(
            "[COINS AD] Fullscreen refusé :",
            error
        );

    }


    try{

        await video.play();

    }catch(error){

        console.error(
            "[COINS AD] Lecture impossible :",
            error
        );

        if(status){

            status.textContent =
                "La lecture automatique a été bloquée.";

        }

        await closeDavidAd(
            video
        );

    }

}


async function closeDavidAd(
    video
){

    try{

        if(
            document.fullscreenElement
        ){

            await document.exitFullscreen();

        }

    }catch(error){

        console.warn(
            "[COINS AD] Sortie fullscreen :",
            error
        );

    }


    video.pause();

    video.removeAttribute(
        "src"
    );

    video.load();

    video.remove();


    const button =
        document.getElementById(
            "watchAdButton"
        );

    if(button){

        button.disabled =
            false;

        button.textContent =
            "[ ▶ REGARDER UNE PUB ]";

    }


    davidAdPlaying =
        false;

}


/* =========================================================
   SAVE ACCOUNT
========================================================= */

function saveAccount(
    newToken,
    newUser
){

    token =
        newToken || null;

    currentUser =
        newUser || null;


    if(token){

        localStorage.setItem(
            TOKEN_KEY,
            token
        );

    }else{

        localStorage.removeItem(
            TOKEN_KEY
        );

    }


    if(currentUser){

        localStorage.setItem(
            USER_KEY,
            JSON.stringify(
                currentUser
            )
        );

    }else{

        localStorage.removeItem(
            USER_KEY
        );

    }

}


/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value){

    const div =
        document.createElement(
            "div"
        );

    div.textContent =
        String(value ?? "");

    return div.innerHTML;

}


function createDefaultAvatar(
    username
){

    return (
        "https://ui-avatars.com/api/?" +
        "name=" +
        encodeURIComponent(username) +
        "&background=020502" +
        "&color=35ff5a" +
        "&bold=true"
    );

}


/* =========================================================
   API
========================================================= */

async function apiRequest(
    endpoint,
    options={}
){

    const headers = {
        ...(options.headers || {})
    };


    if(token){

        headers.Authorization =
            "Bearer " + token;

    }


    const response =
        await fetch(
            API + endpoint,
            {
                ...options,
                headers
            }
        );


    let data = null;


    try{

        data =
            await response.json();

    }catch{

        throw new Error(
            "SERVER RETURNED INVALID JSON (" +
            response.status +
            ")"
        );

    }


    if(!response.ok){

        throw new Error(
            data?.error ||
            data?.message ||
            "HTTP " +
            response.status
        );

    }


    return data;

}


/* =========================================================
   ACCOUNT UI
========================================================= */

function updateAccountUI(){

    const out =
        document.getElementById(
            "loggedOutAccount"
        );

    const inn =
        document.getElementById(
            "loggedInAccount"
        );

    const head =
        document.getElementById(
            "headerAccountStatus"
        );

    const side =
        document.getElementById(
            "sidebarAccount"
        );

    const who =
        document.getElementById(
            "homeWhoami"
        );

    const chatUsername =
        document.getElementById(
            "chatUsername"
        );


    if(
        currentUser &&
        token
    ){

        out.style.display =
            "none";

        inn.style.display =
            "block";


        const username =
            currentUser.username ||
            "USER";


        const profile =
            currentUser.profile_picture ||
            currentUser.profilePicture ||
            "";


        const avatar =
            profile ||
            createDefaultAvatar(
                username
            );


        document.getElementById(
            "accountUsername"
        ).textContent =
            username;


        document.getElementById(
            "accountId"
        ).textContent =
            currentUser.id
            ?
            "ID: " +
            currentUser.id
            :
            "ACCOUNT ACTIVE";


        document.getElementById(
            "accountAvatar"
        ).src =
            avatar;


        document.getElementById(
            "avatarPreview"
        ).src =
            avatar;


        document.getElementById(
            "avatarPreviewText"
        ).textContent =
            profile ||
            "Avatar automatique";


        document.getElementById(
            "newProfilePicture"
        ).value =
            profile;


        head.textContent =
            username;

        head.className =
            "online";


        who.textContent =
            username;


        side.innerHTML = `
            <div class="account-mini">

                <img
                    src="${escapeHTML(avatar)}"
                    alt="Avatar"
                >

                <div class="account-mini-name">
                    ${escapeHTML(username)}
                </div>

                <br>

                <span class="online">
                    CONNECTED
                </span>

            </div>
        `;


        chatUsername.value =
            username;

        chatUsername.disabled =
            true;

    }else{

        out.style.display =
            "block";

        inn.style.display =
            "none";


        head.textContent =
            "GUEST";

        head.className =
            "offline";


        side.textContent =
            "GUEST";


        who.textContent =
            "visitor";


        chatUsername.value =
            "";

        chatUsername.disabled =
            true;

    }

}


/* =========================================================
   AUTH STATUS
========================================================= */

function setAuthStatus(
    text,
    error=false
){

    const status =
        document.getElementById(
            "authStatus"
        );


    status.textContent =
        "STATUS: " + text;


    status.className =
        error
        ?
        "auth-status error"
        :
        "auth-status success";

}


/* =========================================================
   AVATAR STATUS
========================================================= */

function setAvatarStatus(
    text,
    error=false
){

    const status =
        document.getElementById(
            "avatarStatus"
        );


    status.textContent =
        "STATUS: " + text;


    status.className =
        error
        ?
        "auth-status error"
        :
        "auth-status success";

}


/* =========================================================
   REGISTER
========================================================= */

async function registerAccount(){

    const username =
        document.getElementById(
            "registerUsername"
        ).value.trim();


    const password =
        document.getElementById(
            "registerPassword"
        ).value;


    const profile =
        document.getElementById(
            "profilePicture"
        ).value.trim() ||
        null;


    if(
        username.length < 3 ||
        username.length > 24
    ){

        return setAuthStatus(
            "USERNAME MUST BE 3-24 CHARACTERS",
            true
        );

    }


    if(
        password.length < 8 ||
        password.length > 128
    ){

        return setAuthStatus(
            "PASSWORD MUST BE 8-128 CHARACTERS",
            true
        );

    }


    setAuthStatus(
        "CREATING ACCOUNT..."
    );


    try{

        const data =
            await apiRequest(
                "/api/account/register",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:JSON.stringify({
                        username,
                        password,
                        profile_picture:
                            profile
                    })
                }
            );


        if(!data.token){

            throw new Error(
                "SERVER DID NOT RETURN A TOKEN"
            );

        }


        saveAccount(
            data.token,
            data.user
        );


        document.getElementById(
            "registerPassword"
        ).value = "";


        updateAccountUI();


        setAuthStatus(
            "ACCOUNT CREATED ✓"
        );


        connectSocket();


    }catch(error){

        console.error(
            "[REGISTER]",
            error
        );


        setAuthStatus(
            error.message,
            true
        );

    }

}


/* =========================================================
   LOGIN
========================================================= */

async function loginAccount(){

    const username =
        document.getElementById(
            "loginUsername"
        ).value.trim();


    const password =
        document.getElementById(
            "loginPassword"
        ).value;


    if(
        !username ||
        !password
    ){

        return setAuthStatus(
            "USERNAME AND PASSWORD REQUIRED",
            true
        );

    }


    setAuthStatus(
        "AUTHENTICATING..."
    );


    try{

        const data =
            await apiRequest(
                "/api/account/login",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:JSON.stringify({
                        username,
                        password
                    })
                }
            );


        if(!data.token){

            throw new Error(
                "LOGIN RESPONSE DOES NOT CONTAIN TOKEN"
            );

        }


        saveAccount(
            data.token,
            data.user
        );


        document.getElementById(
            "loginPassword"
        ).value = "";


        updateAccountUI();


        setAuthStatus(
            "LOGIN SUCCESSFUL ✓"
        );


        connectSocket();


    }catch(error){

        console.error(
            "[LOGIN]",
            error
        );


        setAuthStatus(
            error.message,
            true
        );

    }

}


/* =========================================================
   RESTORE SESSION
========================================================= */

async function restoreSession(){

    token = localStorage.getItem(TOKEN_KEY) || null;

    if(!token){

        currentUser = null;

        localStorage.removeItem(USER_KEY);

        updateAccountUI();

        return false;
    }

    try{

        const data = await apiRequest(
            "/api/account/me",
            {
                method: "GET"
            }
        );

        if(
            !data ||
            !data.user
        ){

            throw new Error(
                "INVALID SESSION RESPONSE"
            );
        }

        currentUser = data.user;

localStorage.setItem(
    USER_KEY,
    JSON.stringify(currentUser)
);

updateAccountUI();
updateCoinsUI();

console.log(
    "[AUTH] Session valide",
    currentUser
);

        return true;

    }catch(error){

        console.error(
            "[AUTH] Session invalide :",
            error
        );

        /*
         * Si /api/account/me échoue,
         * la session est considérée comme invalide.
         */

        token = null;

        currentUser = null;

        localStorage.removeItem(
            TOKEN_KEY
        );

        localStorage.removeItem(
            USER_KEY
        );

        updateAccountUI();

        console.log(
            "[AUTH] Déconnecté automatiquement"
        );

        return false;
    }
}


/* =========================================================
   AVATAR
========================================================= */

function previewAvatar(){

    if(
        !currentUser ||
        !token
    ){

        return setAvatarStatus(
            "LOGIN REQUIRED",
            true
        );

    }


    const url =
        document.getElementById(
            "newProfilePicture"
        ).value.trim();


    if(!url){

        return setAvatarStatus(
            "ENTER A PROFILE PICTURE URL",
            true
        );

    }


    if(!/^https?:\/\/.+/i.test(url)){

        return setAvatarStatus(
            "INVALID IMAGE URL",
            true
        );

    }


    const preview =
        document.getElementById(
            "avatarPreview"
        );


    preview.onerror = () => {

        setAvatarStatus(
            "IMAGE URL INVALID OR IMAGE CANNOT BE LOADED",
            true
        );

    };


    preview.onload = () => {

        setAvatarStatus(
            "PREVIEW READY ✓"
        );

    };


    preview.src =
        url;


    document.getElementById(
        "avatarPreviewText"
    ).textContent =
        url;

}


async function changeProfilePicture(){

    if(
        !currentUser ||
        !token
    ){

        return setAvatarStatus(
            "LOGIN REQUIRED",
            true
        );

    }


    const input =
        document.getElementById(
            "newProfilePicture"
        );


    const url =
        input.value.trim();


    if(!url){

        return setAvatarStatus(
            "ENTER A PROFILE PICTURE URL",
            true
        );

    }


    if(!/^https?:\/\/.+/i.test(url)){

        return setAvatarStatus(
            "INVALID IMAGE URL",
            true
        );

    }


    setAvatarStatus(
        "UPDATING PROFILE PICTURE..."
    );


    try{

        const data =
            await apiRequest(
                "/api/account/profile-picture",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:JSON.stringify({
                        profile_picture:url
                    })
                }
            );


        currentUser =
            data.user ||
            {
                ...currentUser,
                profile_picture:url
            };


        localStorage.setItem(
            USER_KEY,
            JSON.stringify(
                currentUser
            )
        );


        updateAccountUI();


        setAvatarStatus(
            "PROFILE PICTURE UPDATED ✓"
        );


    }catch(error){

        console.error(
            "[PROFILE]",
            error
        );


        setAvatarStatus(
            error.message,
            true
        );

    }

}


/* =========================================================
   LOGOUT
========================================================= */

async function logoutAccount(){

    try{

        if(token){

            await apiRequest(
                "/api/account/logout",
                {
                    method:"POST"
                }
            );

        }

    }catch(error){

        console.warn(
            "[LOGOUT]",
            error
        );

    }


    token = null;

    currentUser = null;


    localStorage.removeItem(
        TOKEN_KEY
    );

    localStorage.removeItem(
        USER_KEY
    );


    if(socket){

        try{
            socket.close();
        }catch{}

    }


    socket = null;

    socketConnected = false;


    if(socketReconnectTimer){

        clearTimeout(
            socketReconnectTimer
        );

        socketReconnectTimer = null;

    }


    updateSocketUI();

    updateAccountUI();


    setAuthStatus(
        "LOGGED OUT ✓"
    );


    updateChatStatus(
        "WSS déconnecté."
    );

}


/* =========================================================
   SERVER
========================================================= */

async function checkServer(){

    const serverStatus =
        document.getElementById("serverStatus");

    const renderSide =
        document.getElementById("renderSide");

    const apiSide =
        document.getElementById("apiSide");

    try{

        serverStatus.textContent =
            "CHECKING SERVER...";

        renderSide.textContent =
            "CHECKING";

        apiSide.textContent =
            "CHECKING";

        const response =
            await fetch(
                API + "/api/status",
                {
                    cache:"no-store"
                }
            );

        const data =
            await response.json();

        console.log(
            "[SERVER STATUS]",
            response.status,
            data
        );

        if(!response.ok){
            throw new Error(
                data?.error ||
                `HTTP ${response.status}`
            );
        }

        serverStatus.textContent =
            "SYSTEM ONLINE";

        serverStatus.className =
            "online";

        renderSide.textContent =
            "ONLINE";

        renderSide.className =
            "online";

        apiSide.textContent =
            "ONLINE";

        apiSide.className =
            "online";

        document.getElementById(
            "visitors"
        ).textContent =
            data.users ?? 0;

    }catch(error){

        console.error(
            "[SERVER]",
            error
        );

        serverStatus.textContent =
            "API OFFLINE";

        serverStatus.className =
            "offline";

        renderSide.textContent =
            "ERROR";

        renderSide.className =
            "offline";

        apiSide.textContent =
            "ERROR";

        apiSide.className =
            "offline";
    }
}


/* =========================================================
   SOCKET UI
========================================================= */

function updateSocketUI(){

    const status =
        document.getElementById(
            "sidebarSocket"
        );


    status.textContent =
        socketConnected
        ?
        "ONLINE"
        :
        "OFFLINE";


    status.className =
        socketConnected
        ?
        "online"
        :
        "offline";

}


function scheduleSocketReconnect(){

    if(
        socketReconnectTimer ||
        !token
    ){

        return;

    }


    socketReconnectTimer =
        setTimeout(
            () => {

                socketReconnectTimer =
                    null;

                connectSocket();

            },
            3000
        );

}


/* =========================================================
   SOCKET
========================================================= */

function connectSocket(){

    if(!token){

        return;

    }


    if(
        socket &&
        (
            socket.readyState ===
            WebSocket.OPEN ||

            socket.readyState ===
            WebSocket.CONNECTING
        )
    ){

        return;

    }


    try{

        socket =
            new WebSocket(
                SOCKET_URL +
                "?token=" +
                encodeURIComponent(token)
            );

    }catch(error){

        console.error(
            "[WSS]",
            error
        );

        scheduleSocketReconnect();

        return;

    }


    socket.onopen = () => {

        socketConnected =
            true;


        updateSocketUI();


        updateChatStatus(
            "WSS connecté ✓"
        );

    };


    socket.onmessage = event => {

        try{

            const data =
                JSON.parse(
                    event.data
                );


            if(
                data.type ===
                "welcome"
            ){

                if(
                    data.authenticated &&
                    data.username
                ){

                    currentUser = {
                        ...currentUser,

                        username:
                            data.username,

                        id:
                            data.user_id ??
                            currentUser?.id,

                        profile_picture:
                            data.profile_picture ??
                            currentUser?.profile_picture
                    };


                    localStorage.setItem(
                        USER_KEY,
                        JSON.stringify(
                            currentUser
                        )
                    );


                    updateAccountUI();

                }

            }


            else if(
                data.type ===
                "users"
            ){

                document.getElementById(
                    "visitors"
                ).textContent =
                    data.count ?? 0;

            }


            else if(
                data.type === "message" ||
                data.type === "chat"
            ){

                displayChatMessage(
                    data.data ||
                    data
                );

            }


            else if(
                data.type === "error"
            ){

                updateChatStatus(
                    "ERREUR : " +
                    (
                        data.message ||
                        "Erreur serveur"
                    )
                );

            }


        }catch(error){

            console.error(
                "[WSS JSON]",
                error
            );

        }

    };


    socket.onclose = event => {

        socketConnected =
            false;


        updateSocketUI();


        if(token){

            scheduleSocketReconnect();

        }

    };


    socket.onerror = error => {

        socketConnected =
            false;


        updateSocketUI();


        updateChatStatus(
            "ERREUR WSS"
        );

        console.error(
            "[WSS]",
            error
        );

    };

}


/* =========================================================
   CHAT
========================================================= */

function updateChatStatus(text){

    const element =
        document.getElementById(
            "chatStatus"
        );


    if(element){

        element.textContent =
            text;

    }

}


function showChatLoginRequired(){

    document.getElementById(
        "chatBox"
    ).innerHTML = `
        <div class="chat-message">

            <span class="chat-user">
                SYSTEM
            </span>

            <br><br>

            ⚠ ACCÈS REFUSÉ

            <br><br>

            Tu dois être connecté pour utiliser le chat.

        </div>
    `;


    updateChatStatus(
        "Connexion requise."
    );

}


/* =========================================================
   DISPLAY CHAT MESSAGE
========================================================= */

function displayChatMessage(data){

    const box =
        document.getElementById(
            "chatBox"
        );


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "chat-message";


    const time =
        data.timestamp ||
        data.time;


    let formattedTime = "";


    if(time){

        const date =
            new Date(time);


        if(
            !isNaN(
                date.getTime()
            )
        ){

            formattedTime =
                date.toLocaleTimeString(
                    "fr-FR"
                );

        }

    }


    element.innerHTML = `
        <span
    class="
        chat-user
        ${
            data.name_effect === "name_rgb"
                ? "name-rgb"
                : ""
        }
    "
>
    ${escapeHTML(
        data.username ||
        "USER"
    )}
</span>
            ${
                formattedTime
                ? `
                    <span class="chat-time">
                        ${formattedTime}
                    </span>
                `
                : ""
            }

        <br>
    `;


    /*
       IMPORTANT :
       Le message n'est PAS injecté directement
       en HTML.

       On utilise renderEmotes() pour convertir
       uniquement les codes connus.
    */

    const message =
        String(
            data.message ||
            ""
        );


    const content =
        document.createElement(
            "span"
        );


    content.className =
        "chat-text";


    content.appendChild(
        renderEmotes(message)
    );


    element.appendChild(
        content
    );


    box.appendChild(
        element
    );


    box.scrollTop =
        box.scrollHeight;

}


function clearChat(){

    document.getElementById(
        "chatBox"
    ).innerHTML =
        "";

}


function addSystemMessage(
    message
){

    const box =
        document.getElementById(
            "chatBox"
        );


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "chat-message";


    element.innerHTML = `
        <span class="chat-user">
            SYSTEM
        </span>

        <br>
    `;


    const text =
        document.createElement(
            "span"
        );


    text.className =
        "chat-text";


    text.appendChild(
        renderEmotes(
            message
        )
    );


    element.appendChild(
        text
    );


    box.appendChild(
        element
    );


    box.scrollTop =
        box.scrollHeight;

}


/* =========================================================
   CHAT HISTORY
========================================================= */

async function loadChatHistory(){

    if(
        !currentUser ||
        !token
    ){

        showChatLoginRequired();

        return;

    }


    clearChat();


    addSystemMessage(
        "Chargement de chat-log/..."
    );


    try{

        const list =
            await apiRequest(
                "/api/chat/logs"
            );


        const logs =
            Array.isArray(
                list.logs
            )
            ?
            list.logs
            :
            [];


        if(!logs.length){

            clearChat();

            addSystemMessage(
                "Aucun historique dans chat-log."
            );

            updateChatStatus(
                "Historique vide ✓"
            );

            return;

        }


        let loadedMessages = 0;


        for(
            const log of logs
        ){

            const match =
                String(
                    log.name ||
                    ""
                ).match(
                    /(\d+)/
                );


            const number =
                match &&
                match[1];


            if(!number){

                continue;

            }


            try{

                const data =
                    await apiRequest(
                        "/api/chat/log/" +
                        number
                    );


                const messages =
                    Array.isArray(
                        data.messages
                    )
                    ?
                    data.messages
                    :
                    [];


                for(
                    const message
                    of messages
                ){

                    displayChatMessage(
                        message
                    );

                    loadedMessages++;

                }


            }catch(error){

                console.warn(
                    "[CHAT LOG]",
                    error.message
                );

            }

        }


        if(
            loadedMessages === 0
        ){

            clearChat();

            addSystemMessage(
                "Aucun message dans chat-log."
            );

        }


        updateChatStatus(
            "Historique chargé ✓"
        );


    }catch(error){

        console.error(
            "[CHAT LOG]",
            error
        );


        clearChat();


        addSystemMessage(
            "Impossible de charger chat-log : " +
            error.message
        );


        updateChatStatus(
            "Erreur historique"
        );

    }

}


/* =========================================================
   SEND CHAT
========================================================= */

function sendChat(){

    if(
        !currentUser ||
        !token
    ){

        showPage(
            "account"
        );

        return;

    }


    const input =
        document.getElementById(
            "chatMessage"
        );


    const message =
        input.value.trim();


    if(!message){

        updateChatStatus(
            "Entre un message."
        );

        return;

    }


    if(
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ){

        updateChatStatus(
            "WSS non connecté. Connexion..."
        );


        connectSocket();

        return;

    }


    socket.send(
        JSON.stringify({
            type:"message",
            message
        })
    );


    input.value =
        "";


    updateChatStatus(
        "Message envoyé ✓"
    );

}


/* =========================================================
   MEDIA UPLOAD
========================================================= */

async function uploadFile(type){

    const ids = {

        image:[
            "imageFile",
            "imageUploadStatus"
        ],

        music:[
            "musicFile",
            "musicUploadStatus"
        ],

        video:[
            "videoFile",
            "videoUploadStatus"
        ]

    };


    const [
        inputId,
        statusId
    ] =
        ids[type];


    const input =
        document.getElementById(
            inputId
        );


    const status =
        document.getElementById(
            statusId
        );


    const file =
        input.files[0];


    if(!file){

        status.textContent =
            "Aucun fichier sélectionné.";

        return;

    }


    if(
        file.size >
        MAX_FILE_SIZE
    ){

        status.textContent =
            "Fichier trop gros. Maximum : 25 MB.";

        return;

    }


    if(!token){

        status.textContent =
            "Connecte-toi pour uploader.";

        return;

    }


    status.textContent =
        "Upload vers GitHub...";


    try{

        const form =
            new FormData();


        form.append(
            "file",
            file
        );


        form.append(
            "folder",
            type
        );


        const response =
            await fetch(
                API +
                "/api/upload",
                {
                    method:"POST",

                    headers:{
                        Authorization:
                            "Bearer " +
                            token
                    },

                    body:form
                }
            );


        const data =
            await response
            .json()
            .catch(
                () => ({})
            );


        if(!response.ok){

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }


        status.innerHTML = `
            UPLOAD OK ✓
            <br>
            <a
                href="${escapeHTML(
                    data.download || ""
                )}"
                target="_blank"
                rel="noopener"
            >
                Ouvrir le fichier
            </a>
        `;


        input.value = "";


        loadMedia();


    }catch(error){

        console.error(
            "[UPLOAD]",
            error
        );


        status.textContent =
            "ERREUR : " +
            error.message;

    }

}


/* =========================================================
   MEDIA
========================================================= */

async function loadMedia(){

    await Promise.all([

        loadFolder(
            "image",
            "imageList",
            "image"
        ),

        loadFolder(
            "music",
            "musicList",
            "music"
        ),

        loadFolder(
            "video",
            "videoList",
            "video"
        )

    ]);

}


async function loadFolder(
    folder,
    id,
    type
){

    const container =
        document.getElementById(
            id
        );


    container.innerHTML =
        "Chargement...";


    try{

        const data =
            await apiRequest(
                "/api/files/" +
                encodeURIComponent(
                    folder
                )
            );


        const files =
            (data.files || [])
            .filter(
                file =>
                    file.name &&
                    !file.name.endsWith(
                        ".gitkeep"
                    )
            );


        if(!files.length){

            container.textContent =
                "Aucun fichier.";

            return;

        }


        container.innerHTML =
            "";


        files.forEach(
            file => {

                const item =
                    document.createElement(
                        "div"
                    );


                item.className =
                    "media-item";


                const name =
                    escapeHTML(
                        file.name
                    );


                const url =
                    escapeHTML(
                        file.download
                    );


                if(type === "image"){

                    item.innerHTML = `
                        <img
                            src="${url}"
                            alt="${name}"
                            loading="lazy"
                        >

                        <br><br>

                        <b>${name}</b>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }

                else if(
                    type === "music"
                ){

                    item.innerHTML = `
                        <b>${name}</b>

                        <br><br>

                        <audio
                            controls
                            preload="metadata"
                            src="${url}"
                        ></audio>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }

                else{

                    item.innerHTML = `
                        <video
                            controls
                            preload="metadata"
                            src="${url}"
                        ></video>

                        <br><br>

                        <b>${name}</b>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }


                container.appendChild(
                    item
                );

            }
        );


    }catch(error){

        console.error(
            "[MEDIA]",
            error
        );


        container.innerHTML = `
            <span class="offline">
                ERREUR :
                ${escapeHTML(
                    error.message
                )}
            </span>
        `;

    }

}

/* =========================================================
   MEDIA
========================================================= */

async function loadMedia(){

    await Promise.all([

        loadFolder(
            "image",
            "imageList",
            "image"
        ),

        loadFolder(
            "music",
            "musicList",
            "music"
        ),

        loadFolder(
            "video",
            "videoList",
            "video"
        )

    ]);

}


async function loadFolder(
    folder,
    id,
    type
){

    const container =
        document.getElementById(
            id
        );


    container.innerHTML =
        "Chargement...";


    try{

        const data =
            await apiRequest(
                "/api/files/" +
                encodeURIComponent(
                    folder
                )
            );


        const files =
            (data.files || [])
            .filter(
                file =>
                    file.name &&
                    !file.name.endsWith(
                        ".gitkeep"
                    )
            );


        if(!files.length){

            container.textContent =
                "Aucun fichier.";

            return;

        }


        container.innerHTML =
            "";


        files.forEach(
            file => {

                const item =
                    document.createElement(
                        "div"
                    );


                item.className =
                    "media-item";


                const name =
                    escapeHTML(
                        file.name
                    );


                const url =
                    escapeHTML(
                        file.download
                    );


                if(type === "image"){

                    item.innerHTML = `
                        <img
                            src="${url}"
                            alt="${name}"
                            loading="lazy"
                        >

                        <br><br>

                        <b>${name}</b>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }

                else if(
                    type === "music"
                ){

                    item.innerHTML = `
                        <b>${name}</b>

                        <br><br>

                        <audio
                            controls
                            preload="metadata"
                            src="${url}"
                        ></audio>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }

                else{

                    item.innerHTML = `
                        <video
                            controls
                            preload="metadata"
                            src="${url}"
                        ></video>

                        <br><br>

                        <b>${name}</b>

                        <br><br>

                        <a
                            href="${url}"
                            target="_blank"
                            rel="noopener"
                        >
                            OPEN
                        </a>
                    `;

                }


                container.appendChild(
                    item
                );

            }
        );


    }catch(error){

        console.error(
            "[MEDIA]",
            error
        );


        container.innerHTML = `
            <span class="offline">
                ERREUR :
                ${escapeHTML(
                    error.message
                )}
            </span>
        `;

    }

}


/* =========================================================
   NAVIGATION
========================================================= */

function showPage(name){

    document
        .querySelectorAll(
            ".page"
        )
        .forEach(
            page =>
                page.classList.remove(
                    "active"
                )
        );


    document
        .getElementById(name)
        ?.classList.add(
            "active"
        );


    document
        .querySelectorAll(
            "nav button"
        )
        .forEach(
            button =>
                button.classList.toggle(
                    "active",
                    button.dataset.page ===
                    name
                )
        );


    if(name === "chat"){

        if(
            !currentUser ||
            !token
        ){

            showChatLoginRequired();

        }else{

            loadChatHistory();

            if(!socketConnected){

                connectSocket();

            }

        }

    }


    if(name === "media"){

        loadMedia();

    }


    if(name === "account"){

        updateAccountUI();

    }


    if(name === "random"){

        loadRandomGallery();

    }


    /* =========================
       SHOP
    ========================= */

    if(name === "shop"){

        console.log(
            "[SHOP] Ouverture du Shop"
        );

        console.log(
            "[SHOP] loadShop existe :",
            typeof loadShop
        );

        loadShop();

    }


    window.scrollTo({

        top:0,

        behavior:"smooth"

    });

}


document
    .querySelectorAll(
        "nav button,.side-link"
    )
    .forEach(
        element =>
            element.addEventListener(
                "click",
                () =>
                    showPage(
                        element.dataset.page
                    )
            )
    );


/* =========================================================
   TERMINAL
========================================================= */

function terminalPrint(text){

    document.getElementById(
        "terminalOutput"
    ).textContent +=
        "\n" + text;

}


function terminalCommand(raw){

    const command =
        raw.trim().toLowerCase();


    if(!command){

        return;

    }


    terminalPrint(
        "\nguest@david:~$ " +
        raw
    );


    if(command === "clear"){

        document.getElementById(
            "terminalOutput"
        ).textContent =
            "";

        return;

    }


    if(
        command === "account" ||
        command === "login"
    ){

        showPage("account");

        return;

    }


    if(command === "logout"){

        logoutAccount();

        return;

    }


    if(command === "media"){

        showPage("media");

        return;

    }


    if(command === "chat"){

        showPage("chat");

        return;

    }


    if(command === "games"){

        showPage("games");

        return;

    }


    if(command === "status"){

        terminalPrint(
            "Checking server..."
        );

        checkServer();

        return;

    }


    if(command === "date"){

        terminalPrint(
            new Date()
            .toLocaleDateString(
                "fr-FR"
            )
        );

        return;

    }


    if(command === "time"){

        terminalPrint(
            new Date()
            .toLocaleTimeString(
                "fr-FR"
            )
        );

        return;

    }


    if(command === "random"){

        terminalPrint(
            "RANDOM = " +
            Math.floor(
                Math.random() *
                999999
            )
        );

        return;

    }


    if(command === "whoami"){

        terminalPrint(
            currentUser?.username ||
            "guest"
        );

        return;

    }


    if(command === "wss"){

        terminalPrint(
            socketConnected
            ?
            "WSS = ONLINE"
            :
            "WSS = OFFLINE"
        );

        return;

    }


    if(command === "emotes"){

        terminalPrint(
            Object.keys(EMOTES)
            .map(
                name =>
                    ":" +
                    name +
                    ":"
            )
            .join("\n")
        );

        return;

    }


    if(command === "about"){

        terminalPrint(
            "DAVID RANDOM V2 // Render + GitHub + WSS"
        );

        return;

    }


    if(command === "ls"){

        terminalPrint(
`image/
music/
video/
chat-log/
accounts/
gif/`
        );

        return;

    }


    if(command === "help"){

        terminalPrint(
`COMMANDS
help
clear
about
date
time
random
whoami
account
login
logout
ls
status
media
chat
games
wss
emotes`
        );

        return;

    }


    terminalPrint(
        "Command not found: " +
        raw
    );

}


document
    .getElementById(
        "terminalInput"
    )
    .addEventListener(
        "keydown",
        event => {

            if(
                event.key === "Enter"
            ){

                terminalCommand(
                    event.target.value
                );

                event.target.value =
                    "";

            }

        }
    );


/* =========================================================
   CHAT ENTER
========================================================= */

document
    .getElementById(
        "chatMessage"
    )
    .addEventListener(
        "keydown",
        event => {

            if(
                event.key === "Enter" &&
                !event.shiftKey
            ){

                event.preventDefault();

                sendChat();

            }

        }
    );


/* =========================================================
   CLOSE EMOTE PICKER
========================================================= */

document.addEventListener(
    "click",
    event => {

        const picker =
            document.getElementById(
                "emotePicker"
            );

        const button =
            document.getElementById(
                "emoteButton"
            );


        if(
            !picker ||
            !button
        ){

            return;

        }


        if(
            !picker.contains(
                event.target
            ) &&
            !button.contains(
                event.target
            )
        ){

            closeEmotePicker();

        }

    }
);


/* =========================================================
   GUESTBOOK
========================================================= */

function addGuest(){

    const name =
        document.getElementById(
            "guestName"
        ).value.trim();


    const message =
        document.getElementById(
            "guestMessage"
        ).value.trim();


    if(
        !name ||
        !message
    ){

        alert(
            "Remplis les deux champs."
        );

        return;

    }


    const element =
        document.createElement(
            "div"
        );


    element.className =
        "chat-message";


    element.innerHTML = `
        <span class="chat-user">
            ${escapeHTML(name)}
        </span>

        <br>
    `;


    const content =
        document.createElement(
            "span"
        );


    content.appendChild(
        renderEmotes(
            message
        )
    );


    element.appendChild(
        content
    );


    document
        .getElementById(
            "guestList"
        )
        .prepend(
            element
        );


    document.getElementById(
        "guestName"
    ).value =
        "";


    document.getElementById(
        "guestMessage"
    ).value =
        "";

}


/* =========================================================
   GAME
========================================================= */

let score = 0;

let gameRunning = false;

let gameTimer = 10;

let gameInterval = null;


function startGame(){

    score = 0;

    gameTimer = 10;

    gameRunning = true;


    document.getElementById(
        "score"
    ).textContent =
        "0";


    document.getElementById(
        "gameTime"
    ).textContent =
        "10";


    clearInterval(
        gameInterval
    );


    gameInterval =
        setInterval(
            () => {

                gameTimer--;


                document.getElementById(
                    "gameTime"
                ).textContent =
                    gameTimer;


                if(
                    gameTimer <= 0
                ){

                    clearInterval(
                        gameInterval
                    );


                    gameRunning =
                        false;


                    alert(
                        "GAME OVER\n\nScore: " +
                        score
                    );

                }

            },
            1000
        );

}


function gameClick(){

    if(!gameRunning){

        return;

    }


    score++;


    document.getElementById(
        "score"
    ).textContent =
        score;


    document.getElementById(
        "clickTarget"
    ).style.transform =
        `translate(
            ${Math.random()*120-60}px,
            ${Math.random()*100-50}px
        )`;

}


/* =========================================================
   SYNCHRONIZED RANDOM MARQUEE
========================================================= */

const randomMarqueeMessages = [

    "*** WELCOME TO DAVID RANDOM // THE MOST UNNECESSARY WEBSITE ON THE INTERNET ***",

    "*** SYSTEM STATUS: ONLINE // COMMON SENSE: NOT FOUND // RANDOMNESS: 999999 ***",

    "*** DAVID_OS HAS STARTED SUCCESSFULLY // 0% PRODUCTIVITY // 100% RANDOMNESS ***",

    "*** YOU ARE CURRENTLY CONNECTED TO DAVID RANDOM // THERE IS PROBABLY NO REASON FOR THIS ***",

    "*** GITHUB STORAGE ONLINE // RENDER SERVER ONLINE // BRAIN STATUS: OFFLINE ***",

    "*** WARNING: TOO MUCH RANDOMNESS DETECTED // PLEASE REMAIN CALM AND CONTINUE EXPLORING ***",

    "*** THE CHAT IS ALIVE // THE SERVER IS ALIVE // WE ARE NOT SURE ABOUT THE DEVELOPER ***",

    "*** SOMEWHERE BETWEEN 1999 AND 2026 // THIS WEBSITE SHOULD NOT EXIST // BUT HERE WE ARE ***",

    "*** CRT SIGNAL STABLE // GREEN TEXT STABLE // SANITY LEVELS UNKNOWN ***",

    "*** RANDOM EVENT DETECTED // PLEASE DO NOT PANIC // ACTUALLY, PANIC A LITTLE ***",

    "*** NYAN CAT HAS ENTERED THE SERVER // PLEASE DO NOT ASK HOW OR WHY ***",

    "*** PEPE HAS CONNECTED TO THE CHAT // PEPE IS NOW TYPING... ***",

    "*** UNKNOWN USER DETECTED // WELCOME TO THE TERMINAL // PLEASE ENJOY YOUR STAY ***",

    "*** DATABASE CHECK COMPLETE // ACCOUNTS OK // CHAT-LOG OK // RANDOMNESS CRITICAL ***",

    "*** THERE ARE NO RULES HERE // EXCEPT THE ONES WRITTEN BY DAVID // PROBABLY ***",

    "*** YOU HAVE BEEN SCANNED BY DAVID_OS // RESULT: RANDOM HUMAN DETECTED ***",

    "*** SERVER TEMPERATURE: PROBABLY FINE // CPU: PROBABLY FINE // EVERYTHING: PROBABLY FINE ***",

    "*** CONNECTION ESTABLISHED // SIGNAL STRENGTH: 100% // PURPOSE OF CONNECTION: UNKNOWN ***",

    "*** WELCOME BACK USER // THE INTERNET HAS BEEN WAITING FOR YOU // MAYBE ***",

    "*** SECRET TERMINAL PROTOCOL ACTIVATED // JUST KIDDING // THERE IS NO PROTOCOL ***",

    "*** CHAT-LOG UPDATED // ANOTHER PIECE OF INTERNET HISTORY HAS BEEN CREATED ***",

    "*** WARNING: THIS WEBSITE MAY CONTAIN EXCESSIVE AMOUNTS OF PEPE, WOJAK AND RANDOMNESS ***",

    "*** DAVID RANDOM V2 // MORE FEATURES // MORE BUGS // EXACTLY THE SAME AMOUNT OF PLANNING ***",

    "*** INTERNET CONNECTION SUCCESSFUL // REALITY CONNECTION FAILED // PLEASE TRY AGAIN LATER ***",

    "*** THE SERVER KNOWS YOU ARE HERE // THE SERVER DOES NOT KNOW WHY YOU ARE HERE ***",

    "*** LOADING IMPORTANT INFORMATION... // IMPORTANT INFORMATION NOT FOUND ***",

    "*** YOU COULD BE DOING SOMETHING USEFUL RIGHT NOW // BUT YOU ARE HERE // RESPECT ***",

    "*** RANDOMNESS ENGINE OVERCLOCKED // PLEASE EXPECT UNEXPECTED RESULTS ***",

    "*** DAVID RANDOM INTERNET TERMINAL // SERVING ABSOLUTELY NO IMPORTANT SERVICES SINCE 1999 ***",

    "*** SIGNAL FROM THE VOID RECEIVED // MESSAGE CONTENT: BRUH ***",

    "*** CURRENT OBJECTIVE: EXPLORE THE WEBSITE // SECONDARY OBJECTIVE: FIND SOMETHING COMPLETELY USELESS ***",

    "*** SYSTEM LOG: USER ENTERED // SYSTEM LOG: USER STAYED // SYSTEM LOG: USER HAS NO IDEA WHY ***"

];


let lastRandomMarquee = -1;


/*
   Choisit le prochain message.
*/

function getRandomMarqueeMessage(){

    let index;

    do{

        index =
            Math.floor(
                Math.random() *
                randomMarqueeMessages.length
            );

    }while(
        index === lastRandomMarquee &&
        randomMarqueeMessages.length > 1
    );

    lastRandomMarquee = index;

    return randomMarqueeMessages[index];
}


/*
   Change le message AVANT que la nouvelle
   animation commence.

   Aucun changement pendant le défilement.
*/

function prepareRandomMarquee(){

    const element =
        document.getElementById(
            "randomMarquee"
        );

    if(!element){
        return;
    }

    element.textContent =
        getRandomMarqueeMessage();
}


/*
   Premier message.
*/

prepareRandomMarquee();


/*
   Toutes les 9 secondes :
   le message suivant est préparé.

   Comme l'animation CSS dure exactement
   9 secondes, les deux cycles restent
   synchronisés.
*/

setInterval(
    prepareRandomMarquee,
    9000
);


/* =========================================================
   CLOCK
========================================================= */

function updateClock(){

    document.getElementById(
        "clock"
    ).textContent =
        new Date()
        .toLocaleTimeString(
            "fr-FR"
        );

}


setInterval(
    updateClock,
    1000
);

updateClock();


/* =========================================================
   RANDOM GALLERY SYSTEM
========================================================= */

/*
   TYPES D'EVENTS DISPONIBLES :

   "none"
   "shake"
   "invert"
   "glitch"
   "spin"
   "zoom"
   "matrix"
   "party"
   "flash"
   "random"

   Pour ajouter une nouvelle case,
   ajoute simplement un objet dans le tableau.
*/


const randomItems = [

    {
        title: "NYAN CAT",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/nyan-cat.gif",
        event: "",
        url: "https://www.nyan.cat/"
    },


    {
        title: "PEPE THE FROG",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-banger.gif",
        event: "",
        url:  "https://fr.pinterest.com/omeris_art/pepe-the-frog/"
    },

    {
        title: "PEPE CHAIR",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-chair.gif",
        event: "spin"
    },

    {
        title: "PEPE CROSS",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-cross.png",
        event: "invert"
    },

    {
        title: "PEPE HACKER",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-hacker.gif",
        event: "matrix"
    },

    {
        title: "PEPE RAIN",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-rain.gif",
        event: "flash"
    },

    {
        title: "PEPE RICH",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-rich.gif",
        event: "zoom"
    },

    {
        title: "PEPE UWU",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-uwu.gif",
        event: "random"
    },

    {
        title: "PEPE WELCOME",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/pepe-welcome.gif",
        event: "party"
    },

    {
        title: "WOJAK CRY",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-cry.png",
        event: "shake"
    },

    {
        title: "WOJAK DARK",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-dark.png",
        event: "invert"
    },

    {
        title: "WOJAK DEVIL",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-devil.png",
        event: "glitch"
    },

    {
        title: "WOJAK POKER",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-pokerface.png",
        event: "zoom"
    },

    {
        title: "WOJAK TIRED",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak-tired.png",
        event: "spin"
    },

    {
        title: "manga",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@refs/heads/main/david-random/gif/banner-anime.gif",
        event: "",
        url:  "https://www.manga.org/"
    },

    {
        title: "unknown",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@refs/heads/main/david-random/gif/keyboards.webp",
        event: "",
        url:  "https://unknown.org/"
    },

    {
        title: "rule34",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@refs/heads/main/david-random/gif/9412869-anime.gif",
        event: "",
        url: "https://rule34.xxx/"
    },

    {
        title: "Don't click",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@refs/heads/main/david-random/gif/5284-rick-roll.gif",
        event: "",
        url: "https://rickrolled.fr/"
    },

    {
        title: "click",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/ds.gif",
        event: "",
        url: "https://media1.tenor.com/m/cuhoUrCM9eIAAAAd/gman-go-fuck-yourself.gif"
    },

    {
        title: "rose",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/banner.gif",
        event: "random",
        url: ""
    },

    {
        title: "chill",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/anime-purple.gif",
        event: "random",
        url: ""
    },

    {
        title: "ena",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/ena-joel-g-ena.gif",
        event: "random",
        url: ""
    },

    {
        title: "ena ?",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/ena.gif",
        event: "",
        url: "https://www.youtube.com/watch?v=ic4L_B-VJFw"
    },

    {
        title: "fish",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/fish-anime.webp",
        event: "random",
        url: ""
    },

    {
        title: "flower",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/flower-cat.gif",
        event: "random",
        url: ""
    },

    {
        title: "banner",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/gif-banner.gif",
        event: "random",
        url: ""
    },

    {
        title: "moom",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/green-moon-by-david.gif",
        event: "",
        url: "https://music.youtube.com/watch?v=GX8Hg6kWQYI"
    },

    {
        title: "half-life 3",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/half-life-half-life-2.gif",
        event: "",
        url: "https://www.youtube.com/watch?v=aJ6oQAur3xY"
    },

    {
        title: "bugs",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/half-life-half-life-bug.gif",
        event: "",
        url: "https://www.youtube.com/playlist?list=PL044B67C1F63FB0A3"
    },

    {
        title: "gmod ?",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/half-life-half-life2.gif",
        event: "",
        url: "https://store.steampowered.com/app/4000/Garrys_Mod/?l=french"
    },

    {
        title: "i don't know why",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/half-life-it-starts-with.gif",
        event: "",
        url: "https://fr.memedroid.com/memes/tag/half+life"
    },

    {
        title: "invincible",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/invincible-amazon-studios.gif",
        event: "",
        url: "https://invincible.shivank.dev/"
    },

    {
        title: "kitty",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/kitty's.gif",
        event: "",
        url: "https://www.trmn.sh/terminals/kitty"
    },

    {
        title: "maki",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/maki-maki-zenin.gif",
        event: "random",
        url: ""
    },

    {
        title: "dark red",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/red-dark.gif",
        event: "",
        url: "https://music.youtube.com/watch?v=Q6FarZpy67M"
    },

    {
        title: "redshift",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/redshift-discord-banner-redshift.gif",
        event: "",
        url: "https://ifunny.co/tags/redshift"
    },

    {
        title: "Ⓗ ",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/vex-animated-banner.webp",
        event: "",
        url: "https://www.youtube.com/watch?v=aW1ROdLjazc"
    },

    {
        title: "cute ?",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/vtuber-anime-girl.webp",
        event: "",
        url: "https://janbox.com/us/blog/best-cute-anime-cat-girls/"
    },

    {
        title: "welcome",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/welcome-to-the-teznox-official-server.gif",
        event: "",
        url: "https://dribbble.com/tags/welcome-page"
    },

    {
        title: "moon",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%202/%C3%B6ylesine.gif",
        event: "",
        url: "https://moon.com/"
    },

    {
        title: "JUICED",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/Capture%20d'%C3%A9cran%202026-09-04%20163113.png",
        event: "",
        url: "https://forums.commentcamarche.net/forum/affich-13954724-probleme-juiced-activer-memoire-virtuelle"
    },

    {
        title: "hate me",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/Capture%20d'%C3%A9cran%202026-09-05%20111019.png",
        event: "",
        url: "https://music.youtube.com/watch?v=5ZVO6NTcMZU&list=LM"
    },

    {
        title: "h4te me",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/Capture%20d'%C3%A9cran%202026-09-05%20111415.png",
        event: "",
        url: "https://music.youtube.com/watch?v=YOIEmbiBZz8&list=LM"
    },

    {
        title: "hi",
        image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif%203/hi-im-deadpool-marvel.gif",
        event: "",
        url: "https://media1.tenor.com/m/R4_JHVbc_5QAAAAd/deadpool-hello-there.gif"
    },

   

{
    title: "WOJAK",
    image: "https://cdn.jsdelivr.net/gh/davidtytytutu-lgtm/ramdom@main/david-random/gif/wojak.png",
    event: "",
    url: "https://wojakstudiopro.com/"
}

];

function loadRandomGallery(){

    const grid =
        document.getElementById(
            "randomGrid"
        );

    if(!grid){
        return;
    }


    grid.innerHTML = "";


    randomItems.forEach(
        (item,index) => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "random-card";


            card.innerHTML = `

                <img
                    src="${escapeHTML(item.image)}"
                    alt="${escapeHTML(item.title)}"
                    loading="lazy"
                >

                <div class="random-card-number">
                    #${String(index + 1).padStart(3,"0")}
                </div>

                <div class="random-card-title">
                    ${escapeHTML(item.title)}
                </div>

            `;


            card.addEventListener(
                "click",
                () => {

                    handleRandomCard(item);

                }
            );


            grid.appendChild(
                card
            );

        }
    );

}

/* =========================================================
   RANDOM EVENTS
========================================================= */

function runRandomEvent(event){

    switch(event){

        case "shake":
            randomShake();
            break;


        case "invert":
            randomInvert();
            break;


        case "glitch":
            randomGlitch();
            break;


        case "spin":
            randomSpin();
            break;


        case "zoom":
            randomZoom();
            break;


        case "matrix":
            randomMatrix();
            break;


        case "party":
            randomParty();
            break;


        case "flash":
            randomFlash();
            break;


        case "random":

            const events = [
                "shake",
                "invert",
                "glitch",
                "spin",
                "zoom",
                "matrix",
                "party",
                "flash"
            ];

            runRandomEvent(
                events[
                    Math.floor(
                        Math.random() *
                        events.length
                    )
                ]
            );

            break;

    }

}

/* =========================================================
   RANDOM CARD HANDLER
========================================================= */

function handleRandomCard(item){

    if(!item){
        return;
    }


    /*
       EVENT PRIORITAIRE
    */

    if(
        typeof item.event === "string" &&
        item.event.trim() !== ""
    ){

        runRandomEvent(
            item.event.trim()
        );

        return;
    }


    /*
       PAS D'EVENT → URL
    */

    if(
        typeof item.url === "string" &&
        item.url.trim() !== ""
    ){

        window.open(
            item.url.trim(),
            "_blank",
            "noopener,noreferrer"
        );

        return;
    }


    /*
       RIEN
    */

    console.log(
        "[RANDOM] Aucun event ni URL."
    );

}

/* SHAKE */

function randomShake(){

    document.body.animate(

        [
            {
                transform:"translate(0,0)"
            },

            {
                transform:"translate(-12px,5px)"
            },

            {
                transform:"translate(12px,-5px)"
            },

            {
                transform:"translate(-8px,-3px)"
            },

            {
                transform:"translate(8px,3px)"
            },

            {
                transform:"translate(0,0)"
            }
        ],

        {
            duration:500
        }

    );

}


/* INVERT */

function randomInvert(){

    document.body.style.filter =
        "invert(1)";


    setTimeout(
        () => {

            document.body.style.filter =
                "";

        },
        1000
    );

}


/* GLITCH */

function randomGlitch(){

    document.body.classList.add(
        "random-glitch"
    );


    setTimeout(
        () => {

            document.body.classList.remove(
                "random-glitch"
            );

        },
        1200
    );

}


/* SPIN */

function randomSpin(){

    document.body.animate(

        [
            {
                transform:"rotate(0deg)"
            },

            {
                transform:"rotate(2deg)"
            },

            {
                transform:"rotate(-2deg)"
            },

            {
                transform:"rotate(0deg)"
            }
        ],

        {
            duration:800
        }

    );

}


/* ZOOM */

function randomZoom(){

    document.body.animate(

        [
            {
                transform:"scale(1)"
            },

            {
                transform:"scale(1.08)"
            },

            {
                transform:"scale(1)"
            }
        ],

        {
            duration:900
        }

    );

}


/* FLASH */

function randomFlash(){

    const flash =
        document.createElement(
            "div"
        );


    flash.style.position =
        "fixed";

    flash.style.inset =
        "0";

    flash.style.zIndex =
        "9997";

    flash.style.background =
        "#ffffff";

    flash.style.pointerEvents =
        "none";


    document.body.appendChild(
        flash
    );


    setTimeout(
        () => {

            flash.remove();

        },
        100
    );

}


/* PARTY */

function randomParty(){

    document.body.style.transition =
        "filter .1s";


    let count = 0;


    const interval =
        setInterval(
            () => {

                document.body.style.filter =
                    `hue-rotate(${Math.random()*360}deg)`;


                count++;


                if(count >= 12){

                    clearInterval(
                        interval
                    );


                    document.body.style.filter =
                        "";

                }

            },
            100
        );

}


/* MATRIX */

function randomMatrix(){

    const overlay =
        document.createElement(
            "div"
        );


    overlay.style.position =
        "fixed";

    overlay.style.inset =
        "0";

    overlay.style.zIndex =
        "9996";

    overlay.style.pointerEvents =
        "none";

    overlay.style.color =
        "#35ff5a";

    overlay.style.font =
        "16px monospace";

    overlay.style.overflow =
        "hidden";

    overlay.style.background =
        "rgba(0,0,0,.15)";


    let text = "";


    for(
        let i = 0;
        i < 3000;
        i++
    ){

        text +=
            Math.random() > .5
            ? "1"
            : "0";

        if(i % 100 === 0){
            text += "\n";
        }

    }


    overlay.textContent =
        text;


    document.body.appendChild(
        overlay
    );


    setTimeout(
        () => {

            overlay.remove();

        },
        1500
    );

}


/* =========================================================
   DAVID COINS UI
========================================================= */

function updateCoinsUI(){

    const balanceElement = document.getElementById("coinBalance");

    if(!balanceElement){
        return;
    }

    if(!currentUser){
        balanceElement.textContent = "0";
        return;
    }

    const coins = Number(currentUser.coins);

    balanceElement.textContent =
        Number.isFinite(coins)
            ? Math.max(0, Math.floor(coins)).toLocaleString("fr-FR")
            : "0";
}

async function loadShop(){

    const container =
        document.getElementById("shopItems");

    if(!container){
        return;
    }

    container.innerHTML =
        '<div class="shop-loading">[ CHARGEMENT DU SHOP... ]</div>';

    try{

        const response = await fetch(
            "https://david-random.onrender.com/api/shop",
            {
                method:"GET",
                headers:{
                    "Authorization":
                        "Bearer " + token
                }
            }
        );

        const data =
            await response.json();

        if(!response.ok || !data.success){

            throw new Error(
                data.error || "Erreur du Shop"
            );

        }

        const balance =
            document.getElementById(
                "shopCoinBalance"
            );

        if(balance){

            balance.textContent =
                Number(
                    data.coins || 0
                ).toLocaleString("fr-FR");

        }

        container.innerHTML = "";

        for(const item of data.items){

            const owned =
                item.type === "emote"
                    ? (
                        data.inventory?.owned_emotes || []
                    ).includes(item.id)

                    : item.type === "theme"
                    ? (
                        data.inventory?.owned_themes || []
                    ).includes(item.id)

                    : item.type === "name_effect"
                    ? data.inventory?.name_effect === item.id

                    : false;


            const card =
                document.createElement("div");

            card.className =
                "shop-item";

            card.innerHTML = `

                <div class="shop-preview">

    ${
        item.type === "name_effect"

        ?

        `
        <div class="
            shop-name-preview
            ${
                item.id === "name_rgb"
                    ? "name-rgb"
                    : ""
            }
        ">
            NAME
        </div>
        `

        :

        item.image

        ?

        `
        <img
            src="${item.image}"
            alt="${item.name}"
        >
        `

        :

        ""

    }

</div>

                <div class="shop-item-title">
                    ${item.name}
                </div>

                <div class="shop-item-description">
                    ${item.description || ""}
                </div>

                <div class="shop-item-price">
                    ${item.price} ◈
                </div>

                <button
                    class="shop-buy-btn"
                    data-shop-item="${item.id}"
                    ${owned ? "disabled" : ""}
                >
                    ${
                        owned
                        ? "[ POSSEDÉ ]"
                        : "[ ACHETER ]"
                    }
                </button>

            `;

            container.appendChild(card);

        }


        container
            .querySelectorAll("[data-shop-item]")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {

                        buyShopItem(
                            button.dataset.shopItem
                        );

                    }
                );

            });

    }
    catch(error){

        console.error(
            "[SHOP]",
            error
        );

        container.innerHTML = `

            <div class="shop-message">

                [ ERREUR SHOP ]

                <br><br>

                ${error.message}

            </div>

        `;

    }

}


async function buyShopItem(itemId){

    try{

        const response =
            await fetch(
                "https://david-random.onrender.com/api/shop/buy",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            "Bearer " + token
                    },

                    body:JSON.stringify({
                        item_id:itemId
                    })
                }
            );


        const data =
            await response.json();


        if(
            !response.ok ||
            !data.success
        ){

            throw new Error(
                data.error ||
                "Achat refusé"
            );

        }


        /*
         * =========================
         * METTRE À JOUR LE COMPTE
         * =========================
         */

        currentUser = {
            ...currentUser,

            coins:
                data.coins,

            owned_emotes:
                data.inventory?.owned_emotes || [],

            owned_themes:
                data.inventory?.owned_themes || [],

            name_effect:
                data.inventory?.name_effect || "none"

        };


        /*
         * Sauvegarder le compte
         */

        localStorage.setItem(
            USER_KEY,
            JSON.stringify(
                currentUser
            )
        );


        /*
         * Mettre à jour les coins
         */

        updateCoinsUI();


        /*
         * IMPORTANT :
         * reconstruire le picker
         */

        initEmotePicker();


        /*
         * Actualiser le Shop
         */

        await loadShop();


        console.log(
            "[SHOP] Achat réussi:",
            itemId
        );


        console.log(
            "[SHOP] Inventaire:",
            currentUser.owned_emotes
        );


        console.log(
            "[SHOP] Picker reconstruit"
        );


    }catch(error){

        console.error(
            "[SHOP BUY]",
            error
        );


        alert(
            "Erreur d'achat : " +
            error.message
        );

    }

}

/* =========================================================
   INIT
========================================================= */

async function loadNeocitiesInfo(){

    const status =
        document.getElementById(
            "neocitiesStatus"
        );

    const site =
        document.getElementById(
            "neocitiesSite"
        );

    const update =
        document.getElementById(
            "neocitiesLastUpdate"
        );

    const views =
        document.getElementById(
            "neocitiesViews"
        );

    const hits =
        document.getElementById(
            "neocitiesHits"
        );

    try{

        const response =
            await fetch(
                API + "/api/neocities",
                {
                    cache:"no-store"
                }
            );

        const data =
            await response.json();

        console.log(
            "[NEOCITIES]",
            response.status,
            data
        );

        if(
            !response.ok ||
            data.result !== "success"
        ){

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }

        const info =
            data.info;

        site.textContent =
            info.sitename || "UNKNOWN";

        views.textContent =
            Number(
                info.views || 0
            ).toLocaleString("fr-FR");

        hits.textContent =
            Number(
                info.hits || 0
            ).toLocaleString("fr-FR");

        if(info.last_updated){

            const date =
                new Date(
                    info.last_updated
                );

            update.textContent =
                date.toLocaleString(
                    "fr-FR",
                    {
                        dateStyle:"medium",
                        timeStyle:"medium"
                    }
                );

        }else{

            update.textContent =
                "UNKNOWN";

        }

        status.textContent =
            "● NEOCITIES API ONLINE";

        status.className =
            "online";

    }catch(error){

        console.error(
            "[NEOCITIES]",
            error
        );

        status.textContent =
            "● NEOCITIES API ERROR";

        status.className =
            "offline";

        site.textContent =
            "ERROR";

        update.textContent =
            "--";

        views.textContent =
            "--";

        hits.textContent =
            "--";
    }
}


async function init(){

    console.log("DAVID RANDOM V2");

    // Charger la galerie
    loadRandomGallery();
    initEmotePicker();

    // Vérifier le serveur Render
    checkServer();

    // Charger les informations publiques Neocities
    loadNeocitiesInfo();

    // Vérifier si une session existe réellement
    const loggedIn = await restoreSession();

    if(loggedIn && token){

        console.log("[AUTH] Session valide");

        updateAccountUI();

        connectSocket();

    }else{

        console.log("[AUTH] Aucun compte connecté");

        // Supprimer toute ancienne session locale invalide
        token = null;
        currentUser = null;

        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);

        updateAccountUI();
        updateCoinsUI
        updateAccountUI();

    }

    console.log(
        "EMOTES:",
        Object.keys(EMOTES)
    );
}

init();
