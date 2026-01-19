import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY;

export async function getWorkshopItemDetails(itemIds) {
    if (!Array.isArray(itemIds)) itemIds = [itemIds];

    const url = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';
    const params = new URLSearchParams();
    params.append('itemcount', itemIds.length);
    itemIds.forEach((id, index) => {
        params.append(`publishedfileids[${index}]`, id);
    });

    try {
        const response = await axios.post(url, params);
        return response.data.response.publishedfiledetails;
    } catch (error) {
        console.error('Error fetching Steam Workshop details:', error);
        throw error;
    }
}
