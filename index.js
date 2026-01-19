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
} from 'discord.js';
import dotenv from 'dotenv';
import { getTrackedMods, updateModTimestamp } from './lib/supabase.js';
import { getWorkshopItemDetails } from './lib/steam.js';

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

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const interval = process.env.CHECK_INTERVAL_MS || 300000; // Default 5 mins
    setInterval(checkForUpdates, interval);

    console.log(`Running...`);

    // Initial check on startup
    checkForUpdates();
});

client.login(process.env.DISCORD_TOKEN);
