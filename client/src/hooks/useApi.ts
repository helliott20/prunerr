import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  dashboardApi,
  libraryApi,
  rulesApi,
  queueApi,
  historyApi,
  settingsApi,
  unraidApi,
  activityApi,
  healthApi,
} from '@/services/api';
import type {
  LibraryFilters,
  HistoryFilters,
  ActivityFilters,
  Rule,
  Settings,
  ServiceConnection,
} from '@/types';

// Query Keys
export const queryKeys = {
  stats: ['stats'] as const,
  recentActivity: ['activity', 'recent'] as const,
  upcomingDeletions: ['queue', 'upcoming'] as const,
  recommendations: (limit: number, unwatchedDays: number) => ['recommendations', limit, unwatchedDays] as const,
  library: (filters: LibraryFilters) => ['library', filters] as const,
  libraryItem: (id: string) => ['library', id] as const,
  rules: ['rules'] as const,
  rule: (id: string) => ['rules', id] as const,
  queue: ['queue'] as const,
  history: (filters: HistoryFilters) => ['history', filters] as const,
  activityLog: (filters: ActivityFilters) => ['activity', 'log', filters] as const,
  settings: ['settings'] as const,
  unraidStats: ['unraid', 'stats'] as const,
  healthStatus: ['health', 'status'] as const,
};

// Dashboard Hooks
export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: dashboardApi.getStats,
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: queryKeys.recentActivity,
    queryFn: dashboardApi.getRecentActivity,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useUpcomingDeletions() {
  return useQuery({
    queryKey: queryKeys.upcomingDeletions,
    queryFn: dashboardApi.getUpcomingDeletions,
  });
}

export function useRecommendations(limit = 10, unwatchedDays = 90) {
  return useQuery({
    queryKey: queryKeys.recommendations(limit, unwatchedDays),
    queryFn: () => dashboardApi.getRecommendations(limit, unwatchedDays),
  });
}

// Library Hooks
export function useLibrary(filters: LibraryFilters) {
  return useQuery({
    queryKey: queryKeys.library(filters),
    queryFn: () => libraryApi.getItems(filters),
    placeholderData: (previousData) => previousData, // Keep showing old data while fetching
  });
}

export function useLibraryItem(id: string) {
  return useQuery({
    queryKey: queryKeys.libraryItem(id),
    queryFn: () => libraryApi.getItem(id),
    enabled: !!id,
  });
}

export function useSyncLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.syncLibrary,
    onSuccess: () => {
      // Initial invalidation
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });

      // Poll for updates during sync (sync runs in background)
      // Refetch at 5s, 15s, 30s, and 60s intervals to catch when scan completes
      const delays = [5000, 15000, 30000, 60000];
      delays.forEach((delay) => {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['library'] });
          queryClient.invalidateQueries({ queryKey: queryKeys.stats });
        }, delay);
      });
    },
  });
}

export function useMarkForDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      options,
    }: {
      id: string;
      options?: {
        gracePeriodDays?: number;
        deletionAction?: string;
        resetOverseerr?: boolean;
      };
    }) => libraryApi.markForDeletion(id, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.queue });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useProtectItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: libraryApi.protectItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

export function useBulkMarkForDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ids,
      options,
    }: {
      ids: number[];
      options?: {
        gracePeriodDays?: number;
        deletionAction?: string;
        resetOverseerr?: boolean;
      };
    }) => libraryApi.bulkMarkForDeletion(ids, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.queue });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useBulkProtect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ids, reason }: { ids: number[]; reason?: string }) =>
      libraryApi.bulkProtect(ids, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

// Rules Hooks
export function useRules() {
  return useQuery({
    queryKey: queryKeys.rules,
    queryFn: rulesApi.getAll,
  });
}

export function useRule(id: string) {
  return useQuery({
    queryKey: queryKeys.rule(id),
    queryFn: () => rulesApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>) =>
      rulesApi.create(rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rules });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...rule }: { id: string } & Partial<Rule>) =>
      rulesApi.update(id, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: rulesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rules });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useToggleRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      rulesApi.toggle(ruleId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rules });
    },
  });
}

// Queue Hooks
export function useDeletionQueue() {
  return useQuery({
    queryKey: queryKeys.queue,
    queryFn: queueApi.getAll,
  });
}

export function useRemoveFromQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: queueApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queue });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useProcessQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: queueApi.process,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queue });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useDeleteNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: queueApi.deleteNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.queue });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['history'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

// History Hooks
export function useDeletionHistory(filters: HistoryFilters) {
  return useQuery({
    queryKey: queryKeys.history(filters),
    queryFn: () => historyApi.getAll(filters),
  });
}

// Activity Log Hooks
export function useActivityLog(filters: ActivityFilters) {
  return useQuery({
    queryKey: queryKeys.activityLog(filters),
    queryFn: () => activityApi.getLog(filters),
  });
}

// Settings Hooks
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: settingsApi.get,
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Settings) => settingsApi.save(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: ({
      service,
      config,
    }: {
      service: string;
      config: ServiceConnection;
    }) => settingsApi.testConnection(service, config),
  });
}

// Unraid Hooks
export function useUnraidStats() {
  return useQuery({
    queryKey: queryKeys.unraidStats,
    queryFn: unraidApi.getStats,
    refetchInterval: 60000, // Refresh every minute
    retry: false, // Don't retry if Unraid isn't configured
  });
}

// Health Hooks
export function useHealthStatus() {
  return useQuery({
    queryKey: queryKeys.healthStatus,
    queryFn: healthApi.getStatus,
    refetchInterval: 30000, // Poll every 30 seconds
    refetchIntervalInBackground: false, // Stop polling when tab not visible
    staleTime: 15000, // Consider stale after 15 seconds
    retry: 1, // Only retry once on failure
  });
}
