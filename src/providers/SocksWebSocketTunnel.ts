import net from 'net';
import WebSocket from 'ws';

export class SocksWebSocketTunnel {
    private server: net.Server | null = null;
    private workerUrl: string;
    private workerAuth: string;
    private port: number;

    constructor(workerUrl: string, workerAuth: string, port = 1080) {
        // Asegurar protocolo ws/wss
        this.workerUrl = workerUrl.replace(/^http/, 'ws');
        this.workerAuth = workerAuth;
        this.port = port;
    }

    public start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = net.createServer((clientSocket) => {
                this.handleClient(clientSocket);
            });

            this.server.on('error', (err) => {
                console.error('❌ [SocksTunnel Server Error]:', err.message);
            });

            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`🔌 [SocksTunnel] Servidor SOCKS5 local escuchando en 127.0.0.1:${this.port}`);
                resolve();
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('🔌 [SocksTunnel] Servidor SOCKS5 local detenido.');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    private handleClient(clientSocket: net.Socket) {
        let stage = 0; // 0: Handshake, 1: Request, 2: Piping
        let ws: WebSocket | null = null;

        clientSocket.on('data', (data) => {
            try {
                if (stage === 0) {
                    // SOCKS5 Handshake
                    if (data[0] !== 0x05) {
                        clientSocket.end();
                        return;
                    }
                    // Responder SOCKS5, sin autenticación (0x00)
                    clientSocket.write(Buffer.from([0x05, 0x00]));
                    stage = 1;
                } else if (stage === 1) {
                    // SOCKS5 Request (CONNECT)
                    if (data[0] !== 0x05 || data[1] !== 0x01) {
                        clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        clientSocket.end();
                        return;
                    }

                    const addressType = data[3];
                    let host = '';
                    let port = 0;
                    let offset = 4;

                    if (addressType === 0x01) { // IPv4
                        host = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
                        port = data.readUInt16BE(8);
                        offset = 10;
                    } else if (addressType === 0x03) { // Nombre de dominio
                        const len = data[4];
                        host = data.toString('utf8', 5, 5 + len);
                        port = data.readUInt16BE(5 + len);
                        offset = 7 + len;
                    } else if (addressType === 0x04) { // IPv6
                        const parts = [];
                        for (let i = 0; i < 8; i++) {
                            parts.push(data.readUInt16BE(4 + i * 2).toString(16));
                        }
                        host = parts.join(':');
                        port = data.readUInt16BE(20);
                        offset = 22;
                    } else {
                        clientSocket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        clientSocket.end();
                        return;
                    }

                    // Pausar el socket del cliente mientras se establece la conexión WebSocket
                    clientSocket.pause();

                    const wsUrl = `${this.workerUrl}?host=${encodeURIComponent(host)}&port=${port}&auth=${encodeURIComponent(this.workerAuth)}`;
                    ws = new WebSocket(wsUrl);

                    ws.on('open', () => {
                        // Confirmar conexión exitosa al cliente SOCKS5
                        clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        stage = 2;
                        clientSocket.resume();

                        // Si el cliente ya había mandado datos tras el CONNECT, enviarlos por WS una vez abierto
                        if (data.length > offset) {
                            const extra = data.subarray(offset);
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(extra);
                            }
                        }
                    });

                    ws.on('message', (messageData: WebSocket.Data) => {
                        const buffer = Buffer.isBuffer(messageData) ? messageData : Buffer.from(messageData as ArrayBuffer);
                        clientSocket.write(buffer);
                    });

                    ws.on('close', () => {
                        clientSocket.end();
                    });

                    ws.on('error', (err) => {
                        console.error(`❌ [SocksTunnel WS Error] Conexión fallida hacia ${host}:${port} a través del Worker:`, err.message);
                        clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
                        clientSocket.end();
                    });

                    clientSocket.on('end', () => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    });

                    clientSocket.on('close', () => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    });

                    clientSocket.on('error', () => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    });


                } else if (stage === 2) {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                }
            } catch (err: any) {
                console.error('❌ [SocksTunnel handler error]:', err.message);
                clientSocket.end();
            }
        });
    }
}
