/**
 * Database Repositories
 *
 * This module exports all database repositories for the application.
 * Each repository provides CRUD operations and specialized queries
 * for its corresponding database table.
 */

// Import repositories
import settingsRepo from './settings';
import mediaItemsRepo from './mediaItems';
import rulesRepo from './rules';
import historyRepo from './historyRepo';
import scanHistoryRepo from './scanHistoryRepo';
import profilesRepo from './profilesRepo';

// Export individual repositories
export { default as settingsRepo } from './settings';
export { default as mediaItemsRepo } from './mediaItems';
export { default as rulesRepo } from './rules';
export { default as historyRepo } from './historyRepo';
export { default as scanHistoryRepo } from './scanHistoryRepo';
export { default as profilesRepo } from './profilesRepo';

// Also export as named aliases for convenience
export const mediaRepo = mediaItemsRepo;
export const deletionHistoryRepo = historyRepo;

// Export all repositories as a combined object
export default {
  settings: settingsRepo,
  media: mediaItemsRepo,
  mediaItems: mediaItemsRepo,
  rules: rulesRepo,
  history: historyRepo,
  deletionHistory: historyRepo,
  scanHistory: scanHistoryRepo,
  profiles: profilesRepo,
};

// Re-export specific functions that might be commonly used
export {
  // Settings
  getAllSettings,
  getSettingByKey,
  getSettingValue,
  setSetting,
  deleteSetting,
  getBooleanSetting,
  getNumberSetting,
  getJsonSetting,
  setJsonSetting,
} from './settings';

export {
  // Media Items
  getAllMediaItems,
  getMediaItemById,
  getMediaItemByPlexId,
  getMediaItemBySonarrId,
  getMediaItemByRadarrId,
  createMediaItem,
  updateMediaItem,
  deleteMediaItem,
  updateMediaItemStatus,
  protectMediaItem,
  unprotectMediaItem,
  getMediaItemsByStatus,
  getFlaggedMediaItems,
  getProtectedMediaItems,
  getPendingDeletionItems,
  getMediaStats,
} from './mediaItems';

export {
  // Rules
  getAllRules,
  getEnabledRules,
  getRuleById,
  getRulesByProfileId,
  createRule,
  updateRule,
  deleteRule,
  toggleRuleEnabled,
  getRuleConditions,
  // Profiles (from rules.ts for backwards compatibility)
  getAllProfiles,
  getProfileById,
  getActiveProfile,
  createProfile,
  setActiveProfile,
  deleteProfile,
  // Deletion History (from rules.ts for backwards compatibility)
  getDeletionHistory,
  addDeletionHistory,
  getDeletionStats,
  // Scan History (from rules.ts for backwards compatibility)
  getScanHistory,
  getLatestScan,
  startScan,
  completeScan,
  failScan,
  getRunningScan,
} from './rules';
