import WebSocket from 'ws';
import EventEmitter from 'events';
import { PteroClient } from './pterodactyl.js';

/**
 * PteroSocket manages the real-time connection to Pterodactyl.
 */
export class PteroSocket extends EventEmitter {
    constructor() {
        super();
        this.ptero = new PteroClient();
        this.ws = null;
        this.token = null;
        this.socketUrl = null;
        this.reconnectTimer = null;
        this.isConnected = false;
    }

    async connect() {
        console.log('[PteroSocket] Attempting to connect...');
        const details = await this.ptero.getWebSocketDetails();

        if (!details) {
            console.error('[PteroSocket] Could not get websocket details. Retrying in 30s...');
            this.reconnect(30000);
            return;
        }

        this.token = details.token;
        this.socketUrl = details.socket;

        this.ws = new WebSocket(this.socketUrl, {
            origin: process.env.PTERO_URL
        });

        this.ws.on('open', () => {
            console.log('[PteroSocket] Connected to Pterodactyl WebSocket.');
            this.isConnected = true;

            // Authenticate
            this.ws.send(JSON.stringify({
                event: 'auth',
                args: [this.token]
            }));
        });

        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleMessage(msg);
            } catch (err) {
                console.error('[PteroSocket] Error parsing message:', err.message);
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(`[PteroSocket] Connection closed (${code}): ${reason || 'No reason'}`);
            this.isConnected = false;
            this.reconnect(5000);
        });

        this.ws.on('error', (err) => {
            console.error('[PteroSocket] WebSocket error:', err.message);
        });
    }

    handleMessage(msg) {
        // console.log('[PteroSocket] Received:', msg.event, msg.args);

        switch (msg.event) {
            case 'auth success':
                console.log('[PteroSocket] Authenticated successfully.');
                break;
            case 'token expiring':
            case 'token expired':
                console.log('[PteroSocket] Token expiring, refreshing...');
                this.refreshToken();
                break;
            case 'status':
                const newStatus = msg.args[0];
                console.log(`[PteroSocket] Server status changed: ${newStatus}`);
                this.emit('status', newStatus);
                break;
            case 'console output':
            case 'servermsg':
                const output = msg.args[0];
                this.emit('console', output);
                break;
            // You can add 'stats' here if needed.
        }
    }

    async refreshToken() {
        const details = await this.ptero.getWebSocketDetails();
        if (details && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.token = details.token;
            this.ws.send(JSON.stringify({
                event: 'auth',
                args: [this.token]
            }));
        }
    }

    reconnect(delay) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
}
