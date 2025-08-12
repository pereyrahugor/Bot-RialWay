
import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { processUserMessageWeb } from './processUserMessageWeb';

export interface Message {
  id: string;
  text: string;
  timestamp: number;
  from: 'frontend' | 'assistant';
}

export class AssistantBridge {
  private messageQueue: Message[] = [];
  private io: Server | null = null;

  constructor() {}

  // Inicializa el servidor web chat
  public startWebChatServer(port = 3000) {
    const app = express();
    // Servir el archivo webchat.html en /webchat
    app.get('/webchat', (req, res) => {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      res.sendFile(path.resolve(currentDir, '../../webchat.html'));
    });

    const server = http.createServer(app);
    this.io = new Server(server, {
      cors: { origin: "*" }
    });

    this.io.on('connection', (socket) => {
      console.log('💬 Cliente web conectado');

      socket.on('message', async (msg: string) => {
        try {
          console.log(`📩 Mensaje web: ${msg}`);
          const reply = await processUserMessageWeb(msg);
          socket.emit('reply', reply);
          this.saveMessage(msg, 'frontend');
          this.saveMessage(reply, 'assistant');
        } catch (err) {
          console.error("❌ Error procesando mensaje:", err);
          socket.emit('reply', "Hubo un error procesando tu mensaje.");
        }
      });

      socket.on('disconnect', () => {
        console.log('👋 Cliente web desconectado');
      });
    });

    server.listen(port, () => {
      console.log(`🚀 Servidor WebChat escuchando en http://localhost:${port}`);
      console.log(`🌐 Accede al chat web en http://localhost:${port}/webchat`);
    });
  }

  // Guarda mensajes en la cola interna
  private saveMessage(text: string, from: 'frontend' | 'assistant') {
    const msg: Message = {
      id: this.generateId(),
      text,
      timestamp: Date.now(),
      from,
    };
    this.messageQueue.push(msg);
  }

  // Acceso a historial de mensajes
  public getMessages(): Message[] {
    return this.messageQueue;
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
}