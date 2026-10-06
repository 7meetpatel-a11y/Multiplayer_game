const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const COLORS = [
    "#5ee7ff",
    "#ff5e7a",
    "#ffd166",
    "#9b7bff",
    "#5cff9d",
    "#ff9f5c",
    "#f56cff",
    "#a8ff5e"
];

const W = 900;
const H = 600;
const R = 18;
const SPEED = 5;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size
    });
});

function spawn() {
    return {
        x: 60 + Math.random() * (W - 120),
        y: 70 + Math.random() * (H - 140)
    };
}

function makeRoom() {
    let code;

    do {
        code = Math.random()
            .toString(36)
            .substring(2, 7)
            .toUpperCase();
    } while (rooms.has(code));

    rooms.set(code, {
        players: new Map(),
        shots: []
    });

    return code;
}

function getRoomState(room) {
    return {
        players: [...room.players.values()].map(p => ({
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            hp: p.hp,
            score: p.score,
            color: p.color
        }))
    };
}

function joinRoom(socket, code, name) {

    const room = rooms.get(code);

    if (!room) {
        socket.emit("errorMessage", "Room not found.");
        return;
    }

    if (room.players.size >= 8) {
        socket.emit("errorMessage", "Room is full.");
        return;
    }

    const position = spawn();

    const player = {
        id: socket.id,
        name: String(name || "Player").substring(0, 16),
        x: position.x,
        y: position.y,
        hp: 100,
        score: 0,
        color: COLORS[room.players.size % COLORS.length],
        keys: {}
    };

    room.players.set(socket.id, player);

    socket.join(code);
    socket.room = code;

    socket.emit("joined", {
        code: code,
        id: socket.id
    });

    io.to(code).emit("state", getRoomState(room));
}

io.on("connection", socket => {

    console.log("Player connected:", socket.id);

    socket.on("createRoom", data => {

        const code = makeRoom();

        joinRoom(
            socket,
            code,
            data?.name || "Player"
        );
    });

    socket.on("joinRoom", data => {

        const code = String(data?.code || "")
            .trim()
            .toUpperCase();

        joinRoom(
            socket,
            code,
            data?.name || "Player"
        );
    });

    socket.on("input", data => {

        const room = rooms.get(socket.room);

        if (!room) return;

        const player = room.players.get(socket.id);

        if (!player) return;

        player.keys = {
            up: !!data?.up,
            down: !!data?.down,
            left: !!data?.left,
            right: !!data?.right
        };
    });

    socket.on("shoot", data => {

        const room = rooms.get(socket.room);

        if (!room) return;

        const player = room.players.get(socket.id);

        if (!player || player.hp <= 0) return;

        let dx = Number(data?.dx) || 0;
        let dy = Number(data?.dy) || 0;

        const length = Math.hypot(dx, dy) || 1;

        room.shots.push({
            x: player.x,
            y: player.y,
            vx: dx / length * 10,
            vy: dy / length * 10,
            owner: player.id,
            life: 70
        });
    });

    socket.on("restart", () => {

        const room = rooms.get(socket.room);

        if (!room) return;

        room.shots = [];

        room.players.forEach(player => {

            const position = spawn();

            player.x = position.x;
            player.y = position.y;
            player.hp = 100;
            player.score = 0;
            player.keys = {};
        });

        io.to(socket.room).emit(
            "state",
            getRoomState(room)
        );
    });

    socket.on("disconnect", () => {

        console.log("Player disconnected:", socket.id);

        const code = socket.room;

        if (!code) return;

        const room = rooms.get(code);

        if (!room) return;

        room.players.delete(socket.id);

        io.to(code).emit(
            "state",
            getRoomState(room)
        );

        if (room.players.size === 0) {
            rooms.delete(code);
        }
    });
});

setInterval(() => {

    for (const [code, room] of rooms) {

        for (const player of room.players.values()) {

            if (player.hp <= 0) continue;

            let dx =
                (player.keys.right ? 1 : 0) -
                (player.keys.left ? 1 : 0);

            let dy =
                (player.keys.down ? 1 : 0) -
                (player.keys.up ? 1 : 0);

            if (dx || dy) {

                const length = Math.hypot(dx, dy);

                player.x += dx / length * SPEED;
                player.y += dy / length * SPEED;

                player.x = Math.max(
                    R,
                    Math.min(W - R, player.x)
                );

                player.y = Math.max(
                    R,
                    Math.min(H - R, player.y)
                );
            }
        }

        room.shots = room.shots.filter(shot => {

            shot.x += shot.vx;
            shot.y += shot.vy;
            shot.life--;

            if (
                shot.life <= 0 ||
                shot.x < 0 ||
                shot.x > W ||
                shot.y < 0 ||
                shot.y > H
            ) {
                return false;
            }

            for (const player of room.players.values()) {

                if (
                    player.id === shot.owner ||
                    player.hp <= 0
                ) {
                    continue;
                }

                const distance = Math.hypot(
                    player.x - shot.x,
                    player.y - shot.y
                );

                if (distance < R + 7) {

                    player.hp = Math.max(
                        0,
                        player.hp - 25
                    );

                    const shooter =
                        room.players.get(shot.owner);

                    if (
                        player.hp === 0 &&
                        shooter
                    ) {
                        shooter.score++;
                    }

                    return false;
                }
            }

            return true;
        });

        io.to(code).emit("tick", {
            players: [...room.players.values()].map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                hp: p.hp,
                score: p.score,
                color: p.color
            })),
            shots: room.shots
        });
    }

}, 50);

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Battle Arena running on ${PORT}`);
});
