import {
    Client,
    GatewayIntentBits,
    ComponentType,
    ContainerBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ThumbnailBuilder,
    MessageFlags,
    ActivityType,
} from 'discord.js';
import dotenv from 'dotenv';
import { getTrackedMods, updateModTimestamp } from './lib/supabase.js';
import { getWorkshopItemDetails } from './lib/steam.js';
import { getServerStatus } from './lib/status.js';
import { PteroSocket } from './lib/pteroSocket.js';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function checkForUpdates() {
    console.log('Checking for workshop updates...');
    try {
        const tracks = await getTrackedMods();
        if (!tracks || tracks.length === 0) return;

        const modIds = tracks.map(t => t.mod_id);
        const steamDetails = await getWorkshopItemDetails(modIds);

        for (const track of tracks) {
            const details = steamDetails.find(d => d.publishedfileid === track.mod_id);
            if (!details) continue;

            const lastUpdatedSteam = parseInt(details.time_updated);
            const lastUpdatedDb = parseInt(track.last_updated);

            if (lastUpdatedSteam > lastUpdatedDb) {
                console.log(`Update detected for mod: ${details.title}`);
                await notifyUpdate(track.channel_id, details);
                await updateModTimestamp(track.mod_id, lastUpdatedSteam);
            }
        }
    } catch (error) {
        console.error('Error in checkForUpdates loop:', error);
    }
}

async function notifyUpdate(channelId, details) {
    try {
        const button = new ButtonBuilder()
            .setLabel('View on Workshop')
            .setURL(`https://steamcommunity.com/sharedfiles/filedetails/?id=${details.publishedfileid}`)
            .setStyle(ButtonStyle.Link);

        const actionRow = new ActionRowBuilder()
            .addComponents(button);

        const titleText = new TextDisplayBuilder()
            .setContent(`## 🛠️ Workshop Update Detected!`);

        const descriptionText = new TextDisplayBuilder()
            .setContent(`**Mod Name:** ${details.title}\n**Mod ID:** \`${details.publishedfileid}\`\n\n${details.description.substring(0, 300)}...`);

        const mentionText = new TextDisplayBuilder()
            .setContent(`<@&${process.env.ROLE_ID}>`);

        const thumbnail = new ThumbnailBuilder()
            .setURL(details.preview_url);

        const section = new SectionBuilder()
            .addTextDisplayComponents(descriptionText)
            .setThumbnailAccessory(thumbnail);

        const separator = new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Large);

        const container = new ContainerBuilder()
            .setAccentColor(0xFED405)
            .addTextDisplayComponents(titleText)
            .addSectionComponents(section)
            .addSeparatorComponents(separator)
            .addTextDisplayComponents(mentionText)
            .addActionRowComponents(actionRow);

        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        // Components V2 Implementation
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        console.log(`Notified update for mod: ${details.title}`);
    } catch (error) {
        console.error('Error in notifyUpdate:', error);
    }
}

let lastStatusKey = null;

async function updateServerStatus(silent = false) {
    console.log('Checking for server status changes...');
    try {
        const status = await getServerStatus();
        const channelId = process.env.STATUS_CHANNEL_ID;

        if (!channelId) {
            console.warn('STATUS_CHANNEL_ID not set, skipping status check.');
            return;
        }

        // Determine styling based on state
        let statusEmoji = '⚪';
        let accentColor = 0x808080; // Gray
        let displayLabel = status.label;

        if (status.state === 'running') {
            statusEmoji = '🟢';
            accentColor = 0x2ECC71; // Green
            displayLabel = 'Server is Online';
        } else if (status.state === 'restarting_scheduled') {
            statusEmoji = '⏳';
            accentColor = 0x9B59B6; // Purple
            displayLabel = `Scheduled ${status.type} Restart`;
        } else if (status.state === 'restarting_normal') {
            statusEmoji = '🟠';
            accentColor = 0xE67E22; // Orange
            displayLabel = 'Server is Restarting';
        } else if (status.state === 'starting') {
            statusEmoji = '🟡';
            accentColor = 0xF1C40F; // Yellow
            displayLabel = 'Server is Initializing';
        } else if (status.state === 'offline' || status.state === 'stopping') {
            statusEmoji = '🔴';
            accentColor = 0xE74C3C; // Red
            displayLabel = 'Server is Offline';
        }

        // Update Bot Activity (Always update this to reflect player counts)
        let activityLabel = `${statusEmoji} ${displayLabel}`;
        if (status.state === 'running') {
            activityLabel = `🟢 Online | ${status.players} / ${status.maxPlayers} Players`;
        } else if (status.state === 'restarting_scheduled') {
            activityLabel = `⏳ Restarting | ${status.countdown.includes(':') ? 'Countdown' : status.label}`;
        }

        client.user.setActivity(activityLabel, { type: ActivityType.Custom });

        // Generate a unique key for the current state to detect changes
        let currentKey = status.state;
        if (status.state === 'restarting_scheduled') {
            // Stable ID: Bucket the trigger time to the nearest 10 minutes.
            // This prevents "Double Countdowns" when Ptero updates last_run_at during the reboot.
            const triggerUnix = status.trigger.match(/<t:(\d+):T>/)?.[1] || Math.floor(Date.now() / 1000);
            const bucketedTrigger = Math.floor(triggerUnix / 600) * 600; // 10 min buckets
            currentKey = `${status.state}_${status.type}_${bucketedTrigger}`;

            // PRECISION TIMING: If we have a countdown, schedule an immediate check when it hits 0.
            if (status.countdown.includes('<t:')) {
                const targetUnix = status.countdown.match(/<t:(\d+):R>/)?.[1];
                if (targetUnix) {
                    const msUntilZero = (parseInt(targetUnix) * 1000) - Date.now();
                    if (msUntilZero > 0 && msUntilZero < 600000) { // Only if within 10 mins
                        console.log(`[Status] Scheduling precision check in ${Math.round(msUntilZero / 1000)}s for countdown finish.`);
                        setTimeout(() => {
                            isChecking = false; // Reset to allow the forced check
                            triggerStatusCheck();
                        }, msUntilZero + 2000); // 2s buffer for safety
                    }
                }
            }
        }

        // Only send a new message if the state has changed
        if (currentKey === lastStatusKey) return status;

        lastStatusKey = currentKey;
        console.log(`State change detected: ${currentKey}. Sending notification...`);

        if (silent) {
            console.log('Silent mode: Status state initialized, skipping notification.');
            return status;
        }

        // Match notifyUpdate pattern exactly
        const titleText = new TextDisplayBuilder()
            .setContent(`# ${statusEmoji} ${displayLabel}`);

        const titleSeparator = new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small);

        const infoSeparator = new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small);

        const footerSeparator = new SeparatorBuilder()
            .setDivider(false)
            .setSpacing(SeparatorSpacingSize.Small);

        const footerText = new TextDisplayBuilder()
            .setContent(`<t:${Math.floor(Date.now() / 1000)}:d> | <t:${Math.floor(Date.now() / 1000)}:t>`);

        // Assemble Container
        const statusContainer = new ContainerBuilder()
            .setAccentColor(accentColor)
            .addTextDisplayComponents(titleText)
            .addSeparatorComponents(titleSeparator);

        // Add conditional info
        if (status.state === 'running') {
            const statsText = new TextDisplayBuilder().setContent([
                `### ${status.name}`,
                `👤 **Players:** \`${status.players} / ${status.maxPlayers}\``,
                `🗺️ **Map:** \`${status.map || 'Knox Country'}\``
            ].join('\n'));

            statusContainer
                .addTextDisplayComponents(statsText)
                .addSeparatorComponents(infoSeparator);
        } else if (status.state === 'restarting_scheduled' && status.countdown) {
            const countdownText = new TextDisplayBuilder().setContent(`**Restarting:** ${status.countdown}\n**Triggered At:** ${status.trigger}`);

            statusContainer
                .addTextDisplayComponents(countdownText)
                .addSeparatorComponents(infoSeparator);
        } else {
            // Transitional or Offline states
            statusContainer
                .addSeparatorComponents(infoSeparator);
        }

        // Add Footer
        statusContainer
            .addSeparatorComponents(footerSeparator)
            .addTextDisplayComponents(footerText);

        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        // Always send a NEW message
        await channel.send({
            components: [statusContainer],
            flags: MessageFlags.IsComponentsV2
        });

        return status;
    } catch (error) {
        console.error('Error in updateServerStatus:', error);
        return null;
    }
}

let isChecking = false;

// Helper to trigger a check and handle the "loading" phase transition
async function triggerStatusCheck() {
    if (isChecking) return;
    isChecking = true;

    try {
        const status = await updateServerStatus();
        if (!status) {
            isChecking = false;
            return;
        }

        // If the server is in a "transitional" state (starting or running but not yet queryable)
        // We should check again soon to detect when it's fully online.
        if (status.state === 'starting' || status.label === 'Offline') {
            const pteroState = status.pteroState;
            if (pteroState === 'starting' || pteroState === 'running') {
                console.log(`[Status] Server is ${status.label}. Checking again in 20s...`);
                setTimeout(() => {
                    isChecking = false;
                    triggerStatusCheck();
                }, 20000);
                return;
            }
        }
    } catch (err) {
        console.error('Error in triggerStatusCheck:', err);
    }

    isChecking = false;
}

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const workshopInterval = process.env.CHECK_INTERVAL_MS || 300000;
    setInterval(checkForUpdates, workshopInterval);

    // Initial checks
    checkForUpdates();
    updateServerStatus(true);

    // --- WebSocket Setup (Real-time) ---
    const socket = new PteroSocket();

    socket.on('status', (newStatus) => {
        console.log(`[WebSocket] Triggering status update due to power state: ${newStatus}`);
        triggerStatusCheck();
    });

    socket.on('console', (output) => {
        const lowerOutput = output.toLowerCase();
        // Check for restart keywords to trigger immediate schedule detection
        if (lowerOutput.includes('restart') || lowerOutput.includes('reboot') || lowerOutput.includes('shutting down')) {
            console.log(`[WebSocket] Detected restart keyword in console: "${output.trim()}". Triggering check...`);
            triggerStatusCheck();
        }

        // Check for "Economy hooks attached" to trigger "Online" status faster
        if (output.includes('[StatsCollector] Economy hooks attached.')) {
            console.log(`[WebSocket] Server initialization pattern detected. Triggering "Online" check in 5s...`);
            setTimeout(() => {
                isChecking = false; // Ensure we don't get blocked by an existing check
                triggerStatusCheck();
            }, 15000);
        }
    });

    socket.connect();

    // Heartbeat Polling (Backup - every 1 minute)
    // Faster heartbeat helps detect schedules which don't trigger power state changes.
    setInterval(updateServerStatus, 20000);

    console.log(`Running real-time loops and heartbeat...`);
});

client.login(process.env.DISCORD_TOKEN);
