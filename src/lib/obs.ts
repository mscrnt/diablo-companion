// Minimal obs-websocket v5 client — just enough to save the replay buffer
// ("clip that!") when you find a build piece or press the clip hotkey.

async function sha256b64(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

export async function obsRequest(url: string, password: string, requestType: string, requestData: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, "obswebsocket.json");
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("OBS websocket timeout"));
    }, 5000);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
      ws.close();
    };
    ws.onerror = () => done(() => reject(new Error(`Cannot connect to OBS at ${url}`)));
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.op === 0) {
        // Hello
        const identify: any = { rpcVersion: 1 };
        if (msg.d.authentication) {
          const { challenge, salt } = msg.d.authentication;
          const secret = await sha256b64(password + salt);
          identify.authentication = await sha256b64(secret + challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
      } else if (msg.op === 2) {
        // Identified
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId: crypto.randomUUID(), requestData } }));
      } else if (msg.op === 7) {
        const st = msg.d.requestStatus;
        done(() => (st.result ? resolve(msg.d.responseData ?? {}) : reject(new Error(`OBS: ${st.comment ?? st.code}`))));
      }
    };
  });
}

export const obsSaveReplay = (url: string, password: string) => obsRequest(url, password, "SaveReplayBuffer");
export const obsReplayStatus = (url: string, password: string) => obsRequest(url, password, "GetReplayBufferStatus");
export const obsStartReplay = (url: string, password: string) => obsRequest(url, password, "StartReplayBuffer");
