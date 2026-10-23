const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 25000, pingTimeout: 20000 });
const PORT = process.env.PORT || 10000;
const rooms = new Map();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'NEON STRIKE multiplayer' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const cleanName = v => String(v || 'بازیکن').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'بازیکن';
const cleanClass = v => ['VANGUARD','PHANTOM','TITAN','TECH-MEDIC'].includes(v) ? v : 'VANGUARD';
function publicPlayer(p) { return { id:p.id, name:p.name, className:p.className, x:p.x||0, y:p.y||0, z:p.z||0, yaw:p.yaw||0, hp:p.hp??100, color:p.color||'#20dff0' }; }
function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code); socket.data.roomCode = null;
  if (!room) return;
  room.players.delete(socket.id);
  socket.to(code).emit('playerLeft', socket.id);
  io.to(code).emit('roomInfo', { code, players: [...room.players.values()].map(publicPlayer), maxPlayers: 8 });
  if (!room.players.size) rooms.delete(code);
}
function makeCode() { const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code; do { code=''; for(let i=0;i<5;i++) code+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(code)); return code; }
function joinRoom(socket, code, profile, create=false) {
  leaveRoom(socket);
  code = String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  if (create) { code = makeCode(); rooms.set(code,{players:new Map()}); }
  const room = rooms.get(code);
  if (!room) return socket.emit('netError','اتاق پیدا نشد؛ کد را بررسی کن.');
  if (room.players.size >= 8) return socket.emit('netError','ظرفیت اتاق پر است (حداکثر ۸ بازیکن).');
  const p = { id:socket.id, name:cleanName(profile?.name), className:cleanClass(profile?.className), x:0,y:0,z:0,yaw:0,hp:100,color:String(profile?.color||'#20dff0').slice(0,16) };
  room.players.set(socket.id,p); socket.join(code); socket.data.roomCode=code;
  socket.emit('roomJoined',{code,selfId:socket.id,players:[...room.players.values()].map(publicPlayer),maxPlayers:8});
  socket.to(code).emit('playerJoined',publicPlayer(p));
  io.to(code).emit('roomInfo',{code,players:[...room.players.values()].map(publicPlayer),maxPlayers:8});
}
io.on('connection', socket => {
  socket.on('createRoom', profile => joinRoom(socket, '', profile, true));
  socket.on('joinRoom', ({code,profile}={}) => joinRoom(socket, code, profile, false));
  socket.on('playerState', state => {
    const code=socket.data.roomCode, room=rooms.get(code), p=room?.players.get(socket.id); if(!p||!state)return;
    for (const k of ['x','y','z','yaw']) { const n=Number(state[k]); if(Number.isFinite(n)) p[k]=Math.max(-100,Math.min(100,n)); }
    p.hp=Math.max(0,Math.min(100,Number(state.hp)||0));
    if(state.name) p.name=cleanName(state.name); if(state.className) p.className=cleanClass(state.className);
    socket.to(code).volatile.emit('playerState',publicPlayer(p));
  });
  socket.on('playerShoot', data => {
    const code=socket.data.roomCode, room=rooms.get(code), p=room?.players.get(socket.id); if(!p||!data)return;
    const d={x:Number(data.dx)||0,y:Number(data.dy)||0,z:Number(data.dz)||-1};
    socket.to(code).emit('playerShoot',{id:socket.id,x:p.x,y:(p.y||0)+1.3,z:p.z,dx:d.x,dy:d.y,dz:d.z});
  });
  socket.on('playerHit', ({targetId,damage}={}) => {
    const code=socket.data.roomCode, room=rooms.get(code), shooter=room?.players.get(socket.id), target=room?.players.get(targetId);
    if(!shooter||!target||target.id===shooter.id)return;
    const amount=Math.max(1,Math.min(50,Number(damage)||20)); target.hp=Math.max(0,target.hp-amount);
    io.to(code).emit('playerHealth',{id:target.id,hp:target.hp,by:shooter.id});
    if(target.hp<=0){ setTimeout(()=>{const live=rooms.get(code)?.players.get(target.id); if(live){live.hp=100;live.x=(Math.random()-.5)*20;live.z=(Math.random()-.5)*20;io.to(code).emit('playerRespawn',publicPlayer(live));}},1800); }
  });
  socket.on('disconnect',()=>leaveRoom(socket));
});
server.listen(PORT,'0.0.0.0',()=>console.log(`NEON STRIKE listening on ${PORT}`));
