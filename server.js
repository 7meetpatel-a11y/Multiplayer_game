const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const COLORS = ['#5ee7ff','#ff5e7a','#ffd166','#9b7bff','#5cff9d','#ff9f5c','#f56cff','#a8ff5e'];
const W=900,H=600,R=18,SPEED=5;

app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(req,res)=>res.json({ok:true,rooms:rooms.size}));

function roomState(room){
  return {players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,score:p.score,color:p.color}))};
}
function spawn(){ return {x:60+Math.random()*(W-120),y:70+Math.random()*(H-140)}; }
function makeRoom(){ const code=Math.random().toString(36).slice(2,7).toUpperCase(); rooms.set(code,{players:new Map(),shots:[],started:true}); return code; }

io.on('connection', socket=>{
  socket.on('createRoom', ({name})=>{
    const code=makeRoom(); join(socket,code,name||'Player');
  });
  socket.on('joinRoom', ({code,name})=>{
    code=String(code||'').toUpperCase();
    const room=rooms.get(code);
    if(!room) return socket.emit('errorMessage','Room not found.');
    if(room.players.size>=8) return socket.emit('errorMessage','Room is full (8 players max).');
    join(socket,code,name||'Player');
  });
  socket.on('input', data=>{
    const room=rooms.get(socket.room); const p=room?.players.get(socket.id); if(!p) return;
    p.keys={up:!!data.up,down:!!data.down,left:!!data.left,right:!!data.right};
  });
  socket.on('shoot', ({dx,dy})=>{
    const room=rooms.get(socket.room); const p=room?.players.get(socket.id); if(!p||p.hp<=0)return;
    const len=Math.hypot(dx,dy)||1;
    room.shots.push({x:p.x,y:p.y,vx:dx/len*10,vy:dy/len*10,owner:p.id,life:70});
  });
  socket.on('restart',()=>{
    const room=rooms.get(socket.room); if(!room)return;
    room.players.forEach(p=>{const s=spawn();p.x=s.x;p.y=s.y;p.hp=100;p.score=0;});
    io.to(socket.room).emit('state',roomState(room));
  });
  socket.on('disconnect',()=>{
    const code=socket.room,room=rooms.get(code); if(!room)return;
    room.players.delete(socket.id); io.to(code).emit('state',roomState(room));
    if(room.players.size===0) rooms.delete(code);
  });
});
function join(socket,code,name){
  const room=rooms.get(code); const s=spawn();
  room.players.set(socket.id,{id:socket.id,name:String(name).slice(0,16),x:s.x,y:s.y,hp:100,score:0,color:COLORS[room.players.size%COLORS.length],keys:{}});
  socket.room=code; socket.emit('joined',{code,id:socket.id}); io.to(code).emit('state',roomState(room));
}

setInterval(()=>{
  for(const [code,room] of rooms){
    for(const p of room.players.values()){
      if(p.hp<=0) continue;
      let dx=(p.keys.right?1:0)-(p.keys.left?1:0),dy=(p.keys.down?1:0)-(p.keys.up?1:0);
      if(dx||dy){const l=Math.hypot(dx,dy);p.x=Math.max(R,Math.min(W-R,p.x+dx/l*SPEED));p.y=Math.max(R,Math.min(H-R,p.y+dy/l*SPEED));}
    }
    room.shots=room.shots.filter(s=>{s.x+=s.vx;s.y+=s.vy;s.life--; if(s.life<=0||s.x<0||s.x>W||s.y<0||s.y>H)return false;
      for(const p of room.players.values()){
        if(p.id===s.owner||p.hp<=0)continue;
        if(Math.hypot(p.x-s.x,p.y-s.y)<R+7){p.hp=Math.max(0,p.hp-25);const shooter=room.players.get(s.owner);if(p.hp===0&&shooter)shooter.score++;return false;}
      } return true;
    });
    io.to(code).emit('tick',{players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,hp:p.hp,score:p.score,color:p.color})),shots:room.shots});
  }
},50);

server.listen(PORT,()=>console.log(`Battle Arena running on ${PORT}`));
