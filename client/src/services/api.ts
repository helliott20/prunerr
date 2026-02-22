import axios, { AxiosError, AxiosInstance } from 'axios';
import type {
  MediaItem,
  LibraryFilters,
  LibraryResponse,
  Rule,
  QueueItem,
  HistoryFilters,
  HistoryResponse,
  DashboardStats,
  Activity,
  UpcomingDeletion,
  RecommendationsResponse,
  Settings,
  ServiceConnection,
  ApiResponse,
  UnraidStats,
  ActivityFilters,
  ActivityLogResponse,
  SystemHealthResponse,
  StorageSnapshot,
} from '@/types';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Extended error response type
interface ApiErrorResponse {
  error?: string;
  details?: string;
  success?: boolean;
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorResponse>) => {
    const errorData = error.response?.data;
    const message = errorData?.error || error.message || 'An error occurred';
    const details = errorData?.details;

    // Create a detailed error message
    const fullMessage = details ? `${message}\n\n${details}` : message;
    console.error('API Error:', fullMessage);

    return Promise.reject(new Error(fullMessage));
  }
);

// Dashboard APIs
export const dashboardApi = {
  getStats: async (): Promise<DashboardStats> => {
    const { data } = await api.get<ApiResponse<DashboardStats>>('/stats');
    return data.data!;
  },

  getRecentActivity: async (): Promise<Activity[]> => {
    const { data } = await api.get<ApiResponse<Activity[]>>('/activity/recent');
    return data.data || [];
  },

  getUpcomingDeletions: async (): Promise<UpcomingDeletion[]> => {
    const { data } = await api.get<ApiResponse<UpcomingDeletion[]>>('/queue/upcoming');
    return data.data || [];
  },

  getStorageHistory: async (days = 30): Promise<StorageSnapshot[]> => {
    const { data } = await api.get<ApiResponse<StorageSnapshot[]>>(`/stats/storage-history?days=${days}`);
    return data.data || [];
  },

  getRecommendations: async (limit = 10, unwatchedDays = 90): Promise<RecommendationsResponse> => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    params.append('unwatchedDays', String(unwatchedDays));
    const { data } = await api.get<ApiResponse<RecommendationsResponse>>(`/stats/recommendations?${params}`);
    return data.data!;
  },
};

// Library APIs
export const libraryApi = {
  getItems: async (filters: LibraryFilters): Promise<LibraryResponse> => {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    // Map client type 'tv' to server type 'show'
    if (filters.type) params.append('type', filters.type === 'tv' ? 'show' : filters.type);
    if (filters.status) params.append('status', filters.status);
    params.append('page', String(filters.page));
    params.append('limit', String(filters.limit));
    params.append('sortBy', filters.sortBy);
    params.append('sortOrder', filters.sortOrder);

    const { data } = await api.get<ApiResponse<LibraryResponse>>(`/library?${params}`);
    return data.data!;
  },

  getItem: async (id: string): Promise<MediaItem> => {
    const { data } = await api.get<ApiResponse<MediaItem>>(`/library/${id}`);
    return data.data!;
  },

  syncLibrary: async (): Promise<void> => {
    await api.post('/library/sync');
  },

  getSyncStatus: async (): Promise<{ inProgress: boolean }> => {
    const { data } = await api.get<ApiResponse<{ inProgress: boolean }>>('/library/sync/status');
    return data.data!;
  },

  markForDeletion: async (
    id: string,
    options?: {
      gracePeriodDays?: number;
      deletionAction?: string;
      resetOverseerr?: boolean;
    }
  ): Promise<void> => {
    await api.post(`/library/${id}/mark-deletion`, options || {});
  },

  protectItem: async (id: string): Promise<void> => {
    await api.post(`/library/${id}/protect`);
  },

  unprotectItem: async (id: string): Promise<void> => {
    await api.delete(`/library/${id}/protect`);
  },

  bulkMarkForDeletion: async (
    ids: number[],
    options?: {
      gracePeriodDays?: number;
      deletionAction?: string;
      resetOverseerr?: boolean;
    }
  ): Promise<BulkActionResult> => {
    const { data } = await api.post<ApiResponse<BulkActionResult>>('/library/bulk/mark-deletion', {
      ids,
      ...options,
    });
    return data.data!;
  },

  bulkProtect: async (ids: number[], reason?: string): Promise<BulkActionResult> => {
    const { data } = await api.post<ApiResponse<BulkActionResult>>('/library/bulk/protect', {
      ids,
      reason,
    });
    return data.data!;
  },
};

// Bulk action result type
export interface BulkActionResult {
  success: Array<{ id: number; title: string }>;
  failed: Array<{ id: number; error: string }>;
  skipped: Array<{ id: number; title: string; reason: string }>;
}

// Rule preview types
export interface RulePreviewResult {
  matchCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  sampleItems: Array<{
    id: number;
    title: string;
    type: string;
    size: number;
    posterUrl?: string;
    lastWatched?: string;
    playCount: number;
    addedAt?: string;
  }>;
  breakdown: {
    movies: number;
    shows: number;
  };
}

export interface RuleSuggestion {
  id: string;
  name: string;
  description: string;
  icon: string;
  matchCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  conditions: Array<{ field: string; operator: string; value: string | number | boolean }>;
  mediaType: 'all' | 'movie' | 'show';
}

export interface RuleSuggestionsResponse {
  suggestions: RuleSuggestion[];
  libraryStats: {
    totalItems: number;
    movies: number;
    shows: number;
    totalSize: number;
  };
}

// Rules APIs
export const rulesApi = {
  getAll: async (): Promise<Rule[]> => {
    const { data } = await api.get<ApiResponse<Rule[]>>('/rules');
    return data.data || [];
  },

  getById: async (id: string): Promise<Rule> => {
    const { data } = await api.get<ApiResponse<Rule>>(`/rules/${id}`);
    return data.data!;
  },

  create: async (rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>): Promise<Rule> => {
    const { data } = await api.post<ApiResponse<Rule>>('/rules', rule);
    return data.data!;
  },

  update: async (id: string, rule: Partial<Rule>): Promise<Rule> => {
    const { data } = await api.put<ApiResponse<Rule>>(`/rules/${id}`, rule);
    return data.data!;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/rules/${id}`);
  },

  toggle: async (id: string, enabled: boolean): Promise<void> => {
    await api.patch(`/rules/${id}/toggle`, { enabled });
  },

  runRule: async (id: string): Promise<{ matched: number; processed: number }> => {
    const { data } = await api.post<ApiResponse<{ summary: { matched: number; processed: number } }>>(`/rules/${id}/run`);
    return {
      matched: data.data!.summary.matched,
      processed: data.data!.summary.processed,
    };
  },

  // Preview which items would match a rule before saving
  preview: async (
    conditions: Array<{ field: string; operator: string; value: string | number | boolean }>,
    mediaType?: 'all' | 'movie' | 'show'
  ): Promise<RulePreviewResult> => {
    const { data } = await api.post<ApiResponse<RulePreviewResult>>('/rules/preview', {
      conditions,
      mediaType,
    });
    return data.data!;
  },

  // Get smart rule suggestions based on library analysis
  getSuggestions: async (): Promise<RuleSuggestionsResponse> => {
    const { data } = await api.get<ApiResponse<RuleSuggestionsResponse>>('/rules/suggestions');
    return data.data!;
  },
};

// Queue APIs
export const queueApi = {
  getAll: async (): Promise<QueueItem[]> => {
    const { data } = await api.get<ApiResponse<QueueItem[]>>('/queue');
    return data.data || [];
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/queue/${id}`);
  },

  process: async (): Promise<{ deleted: number; freedSpace: number }> => {
    const { data } = await api.post<ApiResponse<{ deleted: number; freedSpace: number }>>('/queue/process');
    return data.data!;
  },

  deleteNow: async (id: string): Promise<{
    id: number;
    title: string;
    deletionAction: string;
    fileSizeFreed: number;
    overseerrReset?: boolean;
  }> => {
    const { data } = await api.post<ApiResponse<{
      id: number;
      title: string;
      deletionAction: string;
      fileSizeFreed: number;
      overseerrReset?: boolean;
    }>>(`/queue/${id}/delete-now`);
    return data.data!;
  },
};

// History APIs
export const historyApi = {
  getAll: async (filters: HistoryFilters): Promise<HistoryResponse> => {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    params.append('page', String(filters.page));
    params.append('limit', String(filters.limit));
    params.append('dateRange', filters.dateRange);

    const { data } = await api.get<ApiResponse<HistoryResponse>>(`/history?${params}`);
    return data.data!;
  },

  exportCsv: async (): Promise<Blob> => {
    const { data } = await api.get('/history/export', {
      responseType: 'blob',
    });
    return data;
  },
};

// Unraid APIs
export const unraidApi = {
  getStats: async (): Promise<UnraidStats> => {
    const { data } = await api.get<ApiResponse<UnraidStats>>('/unraid/stats');
    return data.data!;
  },
};

// Activity APIs
export const activityApi = {
  getLog: async (filters: ActivityFilters): Promise<ActivityLogResponse> => {
    const params = new URLSearchParams();
    params.append('page', String(filters.page));
    params.append('limit', String(filters.limit));
    params.append('dateRange', filters.dateRange);
    if (filters.search) params.append('search', filters.search);
    if (filters.eventTypes?.length) params.append('eventTypes', filters.eventTypes.join(','));
    if (filters.actorTypes?.length) params.append('actorTypes', filters.actorTypes.join(','));

    const { data } = await api.get<ApiResponse<ActivityLogResponse>>(`/activity?${params}`);
    return data.data!;
  },
};

// Health APIs
export const healthApi = {
  getStatus: async (): Promise<SystemHealthResponse> => {
    const { data } = await api.get<ApiResponse<SystemHealthResponse>>('/health/status');
    return data.data!;
  },
};

// Settings APIs
export const settingsApi = {
  get: async (): Promise<Settings> => {
    const { data } = await api.get<ApiResponse<Settings>>('/settings');
    return data.data!;
  },

  save: async (settings: Settings): Promise<Settings> => {
    const { data } = await api.put<ApiResponse<Settings>>('/settings', settings);
    return data.data!;
  },

  testConnection: async (
    service: string,
    config: ServiceConnection
  ): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post<ApiResponse<{ success: boolean; message: string }>>(
      `/settings/test/${service}`,
      config
    );
    return data.data!;
  },
};

export default api;
