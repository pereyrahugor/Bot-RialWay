
import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { processUserMessageWeb } from './processUserMessageWeb';
import fs from 'fs';
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

  // Inicializa el webchat en el servidor principal
  public setupWebChat(app: any, server: http.Server) {
    // Servir el archivo webchat.html en /webchat (Polka no tiene sendFile)

    app.get('/webchat', (req, res) => {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const filePath = path.resolve(currentDir, '../webchat.html');
      res.setHeader('Content-Type', 'text/html');
      res.end(fs.readFileSync(filePath));
    });

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