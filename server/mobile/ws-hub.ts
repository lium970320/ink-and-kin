import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type { Message } from "../../drizzle/schema";
import { readMobileSession } from "./settings-store";

export type MobileMessageDto = Pick<Message,
  "id" | "personaId" | "role" | "content" | "messageType" | "mediaUrl" |
  "mediaDuration" | "emotionalState" | "channel" | "sceneId" | "replyToMessageId"
> & {
  isSticker: boolean;
  mode: "daily" | "scene";
  excludedFromContext: boolean;
  createdAt: string;
  clientMsgId: string | null;
};

export type MobileSceneState = {
  personaId: number;
  activeSceneId: number | null;
  activeSceneTitle: string | null;
  immersiveDailyScene: boolean;
};

export type MobileEvent =
  | { type: "connected"; serverTime: string; deviceId: string }
  | { type: "typing"; personaId: number; isTyping: boolean }
  | { type: "bubble"; personaId: number; turnId: string; message: MobileMessageDto }
  | { type: "proactive"; personaId: number; message: MobileMessageDto }
  | ({ type: "scene_state" } & MobileSceneState)
  | { type: "pong"; ts: number };

type MobileSocket = {
  ws: WebSocket;
  userId: number;
  deviceId: string;
  authorization: string;
  alive: boolean;
};

const sockets = new Set<MobileSocket>();
const mobilePath = "/api/mobile/ws";
const clientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), ts: z.number().optional() }),
  z.object({ type: z.literal("user_typing"), personaId: z.number().int().positive() }),
  z.object({ type: z.literal("stop_turn"), personaId: z.number().int().positive() }),
]);

export function toMobileMessage(message: Message, excludedFromContext = false): MobileMessageDto {
  const { id, personaId, role, content, messageType, mediaUrl, mediaDuration, emotionalState,
    channel, sceneId, replyToMessageId, mode, createdAt, clientMessageId } = message;
  return {
    id, personaId, role, content, messageType, mediaUrl, mediaDuration, emotionalState,
    channel, sceneId, replyToMessageId, mode: mode === "scene" ? "scene" : "daily",
    createdAt: createdAt.toISOString(), clientMsgId: clientMessageId, excludedFromContext, isSticker: false,
  };
}

function send(connection: MobileSocket, event: MobileEvent) {
  if (connection.ws.readyState !== WebSocket.OPEN) return;
  if (connection.ws.bufferedAmount > 256 * 1024) {
    connection.ws.terminate();
    return;
  }
  connection.ws.send(JSON.stringify(event));
}

async function validateSocket(connection: MobileSocket, recordActivity = false) {
  const session = await readMobileSession(connection.authorization, recordActivity).catch(() => null);
  if (session?.deviceId === connection.deviceId && session.user.id === connection.userId) return true;
  connection.ws.close(4003, "Device session expired");
  sockets.delete(connection);
  return false;
}

export async function broadcastToMobileUser(userId: number, event: MobileEvent) {
  await Promise.all(Array.from(sockets).filter(socket => socket.userId === userId).map(async socket => {
    if (await validateSocket(socket)) send(socket, event);
  }));
}

export function onlineMobileDevices(userId: number) {
  return new Set(Array.from(sockets).filter(socket => socket.userId === userId && socket.ws.readyState === WebSocket.OPEN)
    .map(socket => socket.deviceId));
}

export function disconnectMobileDevice(userId: number, deviceId: string) {
  let count = 0;
  for (const socket of Array.from(sockets)) {
    if (socket.userId !== userId || socket.deviceId !== deviceId) continue;
    sockets.delete(socket);
    socket.ws.close(4003, "Device revoked");
    count++;
  }
  return count;
}

export function attachMobileWsHub(
  server: HttpServer,
  stopTurn: (userId: number, deviceId: string, personaId: number) => void,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  const connections = new Set<MobileSocket>();
  const timer = setInterval(() => {
    for (const connection of Array.from(connections)) {
      if (!connection.alive) {
        connection.ws.terminate();
        continue;
      }
      connection.alive = false;
      void validateSocket(connection, true).then(valid => { if (valid) connection.ws.ping(); });
    }
  }, 25_000);
  timer.unref();

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== mobilePath) return;
    const authorization = req.headers.authorization;
    const reject = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (req.url !== mobilePath || !authorization || req.headers.origin) {
      reject("401 Unauthorized");
      return;
    }
    const ignoreSocketError = () => socket.destroy();
    socket.on("error", ignoreSocketError);
    void readMobileSession(authorization, true).then(session => {
      if (!session || socket.destroyed) {
        if (!socket.destroyed) reject("401 Unauthorized");
        return;
      }
      socket.removeListener("error", ignoreSocketError);
      wss.handleUpgrade(req, socket, head, ws => {
        const connection = { ws, userId: session.user.id, deviceId: session.deviceId, authorization, alive: true };
        sockets.add(connection);
        connections.add(connection);
        ws.on("pong", () => { connection.alive = true; });
        ws.on("close", () => {
          connections.delete(connection);
          sockets.delete(connection);
        });
        ws.on("error", () => ws.terminate());
        ws.on("message", (data, isBinary) => {
          if (isBinary) return;
          try {
            const result = clientEvent.safeParse(JSON.parse(data.toString()));
            if (!result.success) return;
            const event = result.data;
            if (event.type === "ping") send(connection, { type: "pong", ts: event.ts ?? Date.now() });
            if (event.type === "stop_turn") {
              void validateSocket(connection).then(valid => {
                if (valid) stopTurn(connection.userId, connection.deviceId, event.personaId);
              });
            }
          } catch { /* 无效客户端消息 */ }
        });
        send(connection, { type: "connected", serverTime: new Date().toISOString(), deviceId: session.deviceId });
      });
    }).catch(() => { if (!socket.destroyed) reject("503 Service Unavailable"); });
  });

  server.once("close", () => {
    clearInterval(timer);
    for (const connection of Array.from(connections)) connection.ws.terminate();
    wss.close();
  });
}
