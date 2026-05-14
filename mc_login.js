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

    ws.on("open", function() {
        console.log("WebSocket connected");
        ws.send(JSON.stringify({
            action: "login",
            user: "admin",
            pass: "MeshCentral2088Secret!"
        }));
    });

    ws.on("message", function(data) {
        try {
            const msg = JSON.parse(data.toString());
            console.log("Received action:", msg.action);
            if (msg.action === "userinfo") {
                console.log("userinfo.siteadmin:", msg.userinfo && msg.userinfo.siteadmin);
                console.log("userinfo keys:", msg.userinfo ? Object.keys(msg.userinfo) : "null");
            }
            if (msg.action === "login") {
                console.log("Login result:", msg.result || "OK");
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
        console.log("Done");
        process.exit(0);
    });
});

req.end();

req.on("error", function(err) {
    console.log("HTTPS Error:", err.message);
    process.exit(1);
});
