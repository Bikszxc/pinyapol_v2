import { GameDig } from 'gamedig';
import { PteroClient } from './pterodactyl.js';

export async function getServerStatus() {
    try {
        const ptero = new PteroClient();
        const pteroState = await ptero.getState();
        const schedules = await ptero.getSchedules();

        const now = new Date();
        const RESTART_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

        // 1. Map Transitional Power States FIRST
        // If the server is actually booting or shutting down, we show the hardware labels.
        // The user confirmed that "Starting..." (Yellow) is correct during the actual boot cycle.
        const pteroLabels = {
            'offline': 'Offline',
            'stopping': 'Stopping...',
            'starting': 'Starting...',
        };

        if (pteroLabels[pteroState]) {
            return {
                state: pteroState,
                label: pteroLabels[pteroState],
                pteroState
            };
        }

        // 2. Determine MOST RECENT relevant schedule (Warning or Recent)
        const relevantSchedules = schedules
            .filter(s => {
                const nameLower = s.name.toLowerCase();
                return nameLower.includes('workshop') || nameLower.includes('daily');
            })
            .sort((a, b) => {
                const dateA = new Date(a.is_processing ? a.updated_at : a.last_run_at || 0);
                const dateB = new Date(b.is_processing ? b.updated_at : b.last_run_at || 0);
                return dateB - dateA;
            });

        const activeSchedule = relevantSchedules[0];

        // 3. Process 'Running' State (Queryable vs Processing Phase)
        if (pteroState === 'running') {
            // A. Check for ACTIVE Processing (The Warning/Countdown Phase)
            if (activeSchedule && activeSchedule.is_processing) {
                const triggerTime = new Date(activeSchedule.updated_at || activeSchedule.last_run_at);
                const completionTime = new Date(triggerTime.getTime() + RESTART_WINDOW_MS);
                const unixCompletion = Math.floor(completionTime.getTime() / 1000);
                const unixTrigger = Math.floor(triggerTime.getTime() / 1000);

                const isWorkshop = activeSchedule.name.toLowerCase().includes('workshop');
                const typeLabel = isWorkshop ? 'Workshop' : 'Daily';

                return {
                    state: 'restarting_scheduled',
                    type: typeLabel,
                    label: `Scheduled ${typeLabel} Restart`,
                    countdown: `<t:${unixCompletion}:R>`,
                    trigger: `<t:${unixTrigger}:T>`,
                    pteroState
                };
            }

            // B. Check for recently finished schedule (The Reboot/Loading Phase)
            if (activeSchedule && activeSchedule.last_run_at) {
                const lastRunDate = new Date(activeSchedule.last_run_at);
                const diff = Math.abs(now - lastRunDate);

                if (diff < RESTART_WINDOW_MS) {
                    // Try to see if it's joinable yet
                    try {
                        // GRACE PERIOD: Ignore queries if triggered < 60s ago
                        if (diff > 60000) {
                            const query = await GameDig.query({
                                type: 'projectzomboid',
                                host: process.env.PZ_SERVER_IP,
                                port: parseInt(process.env.PZ_SERVER_PORT) || 16261
                            });

                            return {
                                state: 'running',
                                label: 'Running',
                                players: query.players.length,
                                maxPlayers: query.maxplayers,
                                map: query.map,
                                name: query.name,
                                pteroState
                            };
                        }
                    } catch (e) {
                        // Still loading...
                    }

                    const unixTrigger = Math.floor(lastRunDate.getTime() / 1000);
                    return {
                        state: 'restarting_scheduled',
                        type: activeSchedule.name.toLowerCase().includes('workshop') ? 'Workshop' : 'Daily',
                        label: `Processing Restart`,
                        countdown: 'Finalizing reboot...',
                        trigger: `<t:${unixTrigger}:T>`,
                        pteroState
                    };
                }
            }

            // C. Standard Running Check (No session/schedule nearby)
            try {
                const query = await GameDig.query({
                    type: 'projectzomboid',
                    host: process.env.PZ_SERVER_IP,
                    port: parseInt(process.env.PZ_SERVER_PORT) || 16261
                });

                return {
                    state: 'running',
                    label: 'Running',
                    players: query.players.length,
                    maxPlayers: query.maxplayers,
                    map: query.map,
                    name: query.name,
                    pteroState
                };
            } catch (error) {
                return {
                    state: 'starting',
                    label: 'Offline (Initializing)',
                    pteroState
                };
            }
        }

        // 4. Default Fallback
        return {
            state: pteroState,
            label: 'Unknown',
            pteroState
        };
    } catch (error) {
        console.error('Error in getServerStatus:', error);
        return { state: 'error', label: 'Offline (API Error)', pteroState: 'error' };
    }
}
