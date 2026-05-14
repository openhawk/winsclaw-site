const https = require("https");
const WebSocket = require("ws");

const req = https.request({
    hostname: "www.winsclaw.com",
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0" }
}, (res) => {
    const cookies = [];
    if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(function(c) {
            const idx = c.indexOf(";");
            cookies.push(idx > 0 ? c.substring(0, idx) : c);
        });
    }

    const ws = new WebSocket("wss://www.winsclaw.com/", {
        headers: { "Cookie": cookies.join("; ") }
    });

    var gotMessages = 0;
    var gotUserinfo = false;

    ws.on("open", function() {
        console.log("WebSocket connected");
        ws.send(JSON.stringify({
            action: "login",
            user: "admin",
            pass: "MeshCentral2088Secret!"
        }));
    });

    ws.on("message", function(data) {
        gotMessages++;
        try {
            const msg = JSON.parse(data.toString());
            console.log("Message #" + gotMessages + " action: " + msg.action);
            if (msg.action === "userinfo") {
                gotUserinfo = true;
                console.log("userinfo.siteadmin:", msg.userinfo && msg.userinfo.siteadmin);
                console.log("userinfo keys:", msg.userinfo ? Object.keys(msg.userinfo).join(",") : "null");
                console.log("userinfo._id:", msg.userinfo && msg.userinfo._id);
            }
            if (msg.action === "login") {
                console.log("Login result:", JSON.stringify(msg));
            }
        } catch (e) {
            console.log("Non-JSON:", data.toString().substring(0, 100));
        }
    });

    ws.on("error", function(err) {
        console.log("WS Error:", err.message);
        process.exit(1);
    });

    ws.on("close", function() {
        console.log("Connection closed after " + gotMessages + " messages");
        if (gotUserinfo) {
            console.log("SUCCESS: userinfo message was received");
        } else {
            console.log("FAILURE: userinfo message was NOT received");
        }
        process.exit(gotUserinfo ? 0 : 1);
    });

    // Safety timeout
    setTimeout(function() {
        if (!gotUserinfo) {
            console.log("Timeout waiting for userinfo. Closing...");
            ws.close();
        }
    }, 8000);
});

req.end();

req.on("error", function(err) {
    console.log("HTTPS Error:", err.message);
    process.exit(1);
});
