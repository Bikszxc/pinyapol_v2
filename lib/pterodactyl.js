import axios from 'axios';

/**
 * Pterodactyl API Utility
 */
export class PteroClient {
    constructor() {
        this.baseUrl = process.env.PTERO_URL?.trim().replace(/\/$/, '');
        this.apiKey = process.env.PTERO_API_KEY?.trim();
        this.serverId = process.env.PTERO_SERVER_ID?.trim();

        if (!this.baseUrl || !this.apiKey || !this.serverId) {
            throw new Error(`Missing Pterodactyl configuration. URL: ${this.baseUrl ? 'OK' : 'MISSING'}, Key: ${this.apiKey ? 'OK' : 'MISSING'}, ID: ${this.serverId ? 'OK' : 'MISSING'}`);
        }

        const fullBaseUrl = `${this.baseUrl}/api/client/servers/${this.serverId}/`;
        console.log(`[PteroClient] Initializing with BaseURL: ${fullBaseUrl}`);

        this.client = axios.create({
            baseURL: fullBaseUrl,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            }
        });
    }

    async getState() {
        try {
            const { data } = await this.client.get('resources');
            return data.attributes.current_state; // running, starting, stopping, offline
        } catch (error) {
            console.error('Error fetching Ptero state:', error.message);
            return 'error';
        }
    }

    async getSchedules() {
        try {
            const { data } = await this.client.get('schedules');
            return data.data.map(s => ({
                id: s.attributes.id,
                name: s.attributes.name,
                is_active: s.attributes.is_active,
                is_processing: s.attributes.is_processing,
                last_run_at: s.attributes.last_run_at,
                next_run_at: s.attributes.next_run_at,
                updated_at: s.attributes.updated_at
            }));
        } catch (error) {
            console.error('Error fetching Ptero schedules:', error.message);
            return [];
        }
    } // Added missing closing brace for getSchedules method
    async getWebSocketDetails() {
        try {
            const { data } = await this.client.get('websocket');
            return data.data; // { token, socket }
        } catch (error) {
            console.error('Error fetching Ptero websocket details:', error.message);
            return null;
        }
    }
}
