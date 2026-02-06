/**
 * Data client for the Python backend (open-source version).
 * All data (agents, sources, QA, alerts, dashboards) goes through the API.
 * Import as: import { dataClient } from "@/services/supabaseClient"
 */
import { apiClient } from '@/services/apiClient';

export const dataClient = apiClient;
/** @deprecated Use dataClient. */
export const supabaseClient = dataClient;
