/** MkMk Re Maze — PeerJS による P2P 同期（ホスト権威） */

const PEER_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PEER_PREFIX = 'mkmkmaze-';

let PeerCtor = null;

export async function ensurePeerJS() {
  if (window.Peer) {
    PeerCtor = window.Peer;
    return PeerCtor;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_CDN;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PeerJSの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
  PeerCtor = window.Peer;
  return PeerCtor;
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/**
 * - host: ゲーム状態を権威的に保持し、ゲストへ配信
 * - guest: 操作をホストへ送り、状態を受信
 */
export function createNet({ role, roomCode, onEvent, onStatus }) {
  const code = (roomCode || randomRoomCode()).toUpperCase();
  const peerId = role === 'host' ? `${PEER_PREFIX}${code}` : undefined;

  let peer = null;
  let hostConn = null;
  const clients = new Map();
  let ready = false;
  let myId = null;

  const status = (msg, kind = 'info') => onStatus?.({ msg, kind });

  async function start() {
    await ensurePeerJS();
    peer = new PeerCtor(peerId, { debug: 1 });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Peer接続がタイムアウトしました')), 15000);
      peer.on('open', (id) => {
        clearTimeout(t);
        myId = id;
        ready = true;
        status(role === 'host' ? `部屋 ${code} を作成しました` : `接続ID: ${id}`, 'ok');
        resolve(id);
      });
      peer.on('error', (err) => {
        status(`Peerエラー: ${err.type || err.message}`, 'error');
        if (!ready) {
          clearTimeout(t);
          reject(err);
        }
      });
    });

    if (role === 'host') {
      peer.on('connection', (conn) => {
        setupClient(conn);
      });
    } else {
      hostConn = peer.connect(`${PEER_PREFIX}${code}`, { reliable: true });
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ホストへの接続がタイムアウトしました')), 15000);
        hostConn.on('open', () => {
          clearTimeout(t);
          status('ホストに接続しました', 'ok');
          resolve();
        });
        hostConn.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      hostConn.on('data', (data) => onEvent?.({ from: 'host', data }));
      hostConn.on('close', () => status('ホストとの接続が切れました', 'error'));
    }

    return { roomCode: code, peerId: myId };
  }

  function setupClient(conn) {
    conn.on('open', () => {
      clients.set(conn.peer, conn);
      status(`プレイヤー参加: ${conn.peer}`, 'ok');
      onEvent?.({ from: conn.peer, data: { type: 'peer_joined', peerId: conn.peer } });
    });
    conn.on('data', (data) => onEvent?.({ from: conn.peer, data }));
    conn.on('close', () => {
      clients.delete(conn.peer);
      status(`切断: ${conn.peer}`, 'warn');
      onEvent?.({ from: conn.peer, data: { type: 'peer_left', peerId: conn.peer } });
    });
  }

  function sendToHost(data) {
    if (role !== 'guest' || !hostConn) return;
    hostConn.send(data);
  }

  function broadcast(data) {
    if (role !== 'host') return;
    for (const conn of clients.values()) {
      if (conn.open) conn.send(data);
    }
  }

  function sendTo(peerIdTarget, data) {
    const conn = clients.get(peerIdTarget);
    if (conn?.open) conn.send(data);
  }

  function destroy() {
    try {
      hostConn?.close();
      for (const c of clients.values()) c.close();
      peer?.destroy();
    } catch (_) {
      /* ignore */
    }
  }

  return {
    role,
    get roomCode() {
      return code;
    },
    get peerId() {
      return myId;
    },
    get clientCount() {
      return clients.size;
    },
    start,
    sendToHost,
    broadcast,
    sendTo,
    destroy,
  };
}
