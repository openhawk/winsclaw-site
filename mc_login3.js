const https = require("https");
const WebSocket = require("ws");
const qs = require("querystring");

// Step 1: GET to get initial cookies
const getReq = https.request({
    hostname: "www.winsclaw.com",
    port: 443,
    path: "/",
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0" }
}, (getRes) => {
    const cookies = [];
    if (getRes.headers["set-cookie"]) {
        getRes.headers["set-cookie"].forEach(function(c) {
            const idx = c.indexOf(";");
            cookies.push(idx > 0 ? c.substring(0, idx) : c);
        });
    }

    // Step 2: POST login with correct field names
    const postData = qs.stringify({
        username: "admin",
        password: "MeshCentral2088Secret!"
    });

    const postReq = https.request({
        hostname: "www.winsclaw.com",
        port: 443,
        path: "/login",
        method: "POST",
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
            "Cookie": cookies.join("; ")
        }
    }, (postRes) => {
        // Collect login response cookies
        if (postRes.headers["set-cookie"]) {
            postRes.headers["set-cookie"].forEach(function(c) {
                const idx = c.indexOf(";");
                cookies.push(idx > 0 ? c.substring(0, idx) : c);
            });
        }

        // Read response body
        let body = "";
        postRes.setEncoding("utf8");
        postRes.on("data", (chunk) => { body += chunk; });
        postRes.on("end", () => {
            console.log("Login response status:", postRes.statusCode);

            // Step 3: Connect WebSocket with session cookie
            const ws = new WebSocket("wss://www.winsclaw.com/", {
                headers: {
                    "Cookie": cookies.join("; ")
                }
            });

            var gotUserinfo = false;
            var msgCount = 0;

            ws.on("open", function() {
                console.log("WebSocket connected");
            });

            ws.on("message", function(data) {
                msgCount++;
                try {
                    const msg = JSON.parse(data.toString());
                    console.log("Message #" + msgCount + ": " + msg.action);
                    if (msg.action === "userinfo") {
                        gotUserinfo = true;
                        const ui = msg.userinfo;
                        console.log("userinfo._id:", ui && ui._id);
                        console.log("userinfo.siteadmin:", ui && ui.siteadmin);
                        console.log("userinfo.name:", ui && ui.name);
                    }
                    if (msg.action === "serverinfo") {
                        console.log("serverinfo loaded");
                    }
                } catch (e) {
                    console.log("Non-JSON message:", data.toString().substring(0, 80));
                }
            });

            ws.on("error", function(err) {
                console.log("WS Error:", err.message);
                process.exit(1);
            });

            ws.on("close", function() {
                console.log("Connection closed after " + msgCount + " messages");
                if (gotUserinfo) {
                    console.log("SUCCESS: userinfo received");
                } else {
                    console.log("FAILURE: no userinfo received");
                }
                process.exit(gotUserinfo ? 0 : 1);
            });

            // Safety timeout
            setTimeout(function() {
                if (!gotUserinfo && ws.readyState === WebSocket.OPEN) {
                    console.log("Timeout waiting for userinfo");
                    ws.close();
                }
            }, 10000);
        });
    });

    postReq.on("error", (err) => {
        console.log("POST Error:", err.message);
        process.exit(1);
    });

    postReq.write(postData);
    postReq.end();
});

getReq.on("error", (err) => {
    console.log("GET Error:", err.message);
    process.exit(1);
});

getReq.end();
