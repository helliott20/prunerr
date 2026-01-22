import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import type {
  SonarrSeries,
  SonarrEpisode,
  SonarrEpisodeFile,
} from './types';

export class SonarrService {
  private client: AxiosInstance;

  constructor(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash

    this.client = axios.create({
      baseURL: `${baseUrl}/api/v3`,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add response interceptor for rate limiting
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`Sonarr rate limited, retrying after ${retryAfter}s`);
          await this.delay(retryAfter * 1000);
          return this.client.request(error.config!);
        }
        throw error;
      }
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test connection to Sonarr
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/system/status');
      const isValid = !!response.data.version;

      if (isValid) {
        logger.info('Sonarr connection test successful', { version: response.data.version });
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Sonarr connection test failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get all series
   */
  async getSeries(): Promise<SonarrSeries[]> {
    try {
      const response = await this.client.get<SonarrSeries[]>('/series');
      logger.info(`Retrieved ${response.data.length} series from Sonarr`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get series from Sonarr', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get a specific series by ID
   */
  async getSeriesById(id: number): Promise<SonarrSeries> {
    try {
      const response = await this.client.get<SonarrSeries>(`/series/${id}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get series ${id} from Sonarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get all episodes for a series
   */
  async getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
    try {
      const response = await this.client.get<SonarrEpisode[]>('/episode', {
        params: { seriesId },
      });
      logger.debug(`Retrieved ${response.data.length} episodes for series ${seriesId}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get episodes for series ${seriesId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get episode files for a series
   */
  async getEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    try {
      const response = await this.client.get<SonarrEpisodeFile[]>('/episodefile', {
        params: { seriesId },
      });
      logger.debug(`Retrieved ${response.data.length} episode files for series ${seriesId}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get episode files for series ${seriesId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Delete a series
   */
  async deleteSeries(id: number, deleteFiles: boolean = false): Promise<void> {
    try {
      await this.client.delete(`/series/${id}`, {
        params: { deleteFiles },
      });
      logger.info(`Deleted series ${id} from Sonarr`, { deleteFiles });
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means series doesn't exist - treat as success (already deleted)
      if (axiosError.response?.status === 404) {
        logger.info(`Series ${id} not found in Sonarr (already deleted)`);
        return;
      }
      logger.error(`Failed to delete series ${id} from Sonarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Remove a series completely (alias for deleteSeries with deleteFiles=true)
   */
  async removeSeries(id: number, deleteFiles: boolean = true): Promise<void> {
    return this.deleteSeries(id, deleteFiles);
  }

  /**
   * Delete an episode file
   */
  async deleteEpisodeFile(id: number): Promise<void> {
    try {
      await this.client.delete(`/episodefile/${id}`);
      logger.info(`Deleted episode file ${id} from Sonarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means file doesn't exist - treat as success (already deleted)
      if (axiosError.response?.status === 404) {
        logger.info(`Episode file ${id} not found in Sonarr (already deleted)`);
        return;
      }
      logger.error(`Failed to delete episode file ${id} from Sonarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Progress callback type for deletion operations
   */
  public static readonly ProgressCallback = Symbol('ProgressCallback');

  /**
   * Delete all episode files for a series (keeps series metadata)
   */
  async deleteAllEpisodeFiles(
    seriesId: number,
    onProgress?: (progress: { current: number; total: number; fileName: string; status: 'deleting' | 'deleted' | 'failed' }) => void
  ): Promise<{ deleted: number; failed: number }> {
    try {
      const episodeFiles = await this.getEpisodeFiles(seriesId);

      if (episodeFiles.length === 0) {
        logger.info(`No episode files found for series ${seriesId}`);
        return { deleted: 0, failed: 0 };
      }

      let deleted = 0;
      let failed = 0;
      const total = episodeFiles.length;

      for (let i = 0; i < episodeFiles.length; i++) {
        const file = episodeFiles[i];
        if (!file) continue;
        const fileName = file.relativePath || file.path || `Episode file ${file.id}`;

        // Emit "deleting" progress
        onProgress?.({ current: i + 1, total, fileName, status: 'deleting' });

        try {
          await this.deleteEpisodeFile(file.id);
          deleted++;
          // Emit "deleted" progress
          onProgress?.({ current: i + 1, total, fileName, status: 'deleted' });
        } catch (error) {
          logger.warn(`Failed to delete episode file ${file.id} for series ${seriesId}`);
          failed++;
          // Emit "failed" progress
          onProgress?.({ current: i + 1, total, fileName, status: 'failed' });
        }
      }

      logger.info(`Deleted ${deleted}/${episodeFiles.length} episode files for series ${seriesId}`);
      return { deleted, failed };
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means series doesn't exist
      if (axiosError.response?.status === 404) {
        logger.info(`Series ${seriesId} not found in Sonarr`);
        return { deleted: 0, failed: 0 };
      }
      logger.error(`Failed to delete episode files for series ${seriesId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Unmonitor a series
   */
  async unmonitorSeries(id: number): Promise<void> {
    try {
      // First get the current series data
      const series = await this.getSeriesById(id);

      // Update monitored status
      await this.client.put(`/series/${id}`, {
        ...series,
        monitored: false,
      });

      logger.info(`Unmonitored series ${id} in Sonarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to unmonitor series ${id} in Sonarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Unmonitor specific episodes
   */
  async unmonitorEpisodes(episodeIds: number[]): Promise<void> {
    if (episodeIds.length === 0) {
      return;
    }

    try {
      await this.client.put('/episode/monitor', {
        episodeIds,
        monitored: false,
      });

      logger.info(`Unmonitored ${episodeIds.length} episodes in Sonarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to unmonitor episodes in Sonarr', {
        status: axiosError.response?.status,
        message: axiosError.message,
        episodeIds,
      });
      throw error;
    }
  }

  /**
   * Search for a series by TVDB ID
   */
  async getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | null> {
    try {
      const allSeries = await this.getSeries();
      return allSeries.find((s) => s.tvdbId === tvdbId) || null;
    } catch (error) {
      logger.error(`Failed to find series by TVDB ID ${tvdbId}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Search for a series by IMDB ID
   */
  async getSeriesByImdbId(imdbId: string): Promise<SonarrSeries | null> {
    try {
      const allSeries = await this.getSeries();
      return allSeries.find((s) => s.imdbId === imdbId) || null;
    } catch (error) {
      logger.error(`Failed to find series by IMDB ID ${imdbId}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Get total size on disk for a series
   */
  async getSeriesSizeOnDisk(seriesId: number): Promise<number> {
    try {
      const files = await this.getEpisodeFiles(seriesId);
      return files.reduce((total, file) => total + file.size, 0);
    } catch (error) {
      logger.error(`Failed to calculate size for series ${seriesId}`, {
        message: (error as Error).message,
      });
      return 0;
    }
  }

  /**
   * Refresh series metadata
   */
  async refreshSeries(seriesId: number): Promise<void> {
    try {
      await this.client.post('/command', {
        name: 'RefreshSeries',
        seriesId,
      });
      logger.info(`Triggered refresh for series ${seriesId} in Sonarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to refresh series ${seriesId} in Sonarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }
}

export default SonarrService;
