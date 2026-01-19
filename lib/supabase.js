import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase configuration in .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getTrackedMods() {
  const { data, error } = await supabase
    .from('workshop_tracks')
    .select('*');

  if (error) throw error;
  return data;
}

export async function updateModTimestamp(modId, timestamp) {
  console.log(`Updating database for mod ${modId} with timestamp ${timestamp}...`);
  const { data, error } = await supabase
    .from('workshop_tracks')
    .update({ last_updated: timestamp })
    .eq('mod_id', modId)
    .select();

  if (error) {
    console.error(`Database update error for mod ${modId}:`, error);
    throw error;
  }

  if (!data || data.length === 0) {
    console.warn(`No rows updated for mod_id: ${modId}. Please verify if the mod_id exists in the database.`);
  } else {
    console.log(`Successfully updated database for mod ${modId}.`);
  }
}
