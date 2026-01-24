import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import type { RadarrMovie, RadarrMovieFile } from './types';

export class RadarrService {
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
          logger.warn(`Radarr rate limited, retrying after ${retryAfter}s`);
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
   * Test connection to Radarr
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/system/status');
      const isValid = !!response.data.version;

      if (isValid) {
        logger.info('Radarr connection test successful', { version: response.data.version });
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Radarr connection test failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get all movies
   */
  async getMovies(): Promise<RadarrMovie[]> {
    try {
      const response = await this.client.get<RadarrMovie[]>('/movie');
      logger.info(`Retrieved ${response.data.length} movies from Radarr`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get movies from Radarr', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get a specific movie by ID
   */
  async getMovieById(id: number): Promise<RadarrMovie> {
    try {
      const response = await this.client.get<RadarrMovie>(`/movie/${id}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get movie ${id} from Radarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Delete a movie
   */
  async deleteMovie(id: number, deleteFiles: boolean = false): Promise<void> {
    try {
      await this.client.delete(`/movie/${id}`, {
        params: {
          deleteFiles,
          addImportExclusion: false,
        },
      });
      logger.info(`Deleted movie ${id} from Radarr`, { deleteFiles });
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means movie doesn't exist - treat as success (already deleted)
      if (axiosError.response?.status === 404) {
        logger.info(`Movie ${id} not found in Radarr (already deleted)`);
        return;
      }
      logger.error(`Failed to delete movie ${id} from Radarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Remove a movie completely (alias for deleteMovie with deleteFiles=true)
   */
  async removeMovie(id: number, deleteFiles: boolean = true): Promise<void> {
    return this.deleteMovie(id, deleteFiles);
  }

  /**
   * Unmonitor a movie
   */
  async unmonitorMovie(id: number): Promise<void> {
    try {
      // First get the current movie data
      const movie = await this.getMovieById(id);

      // Update monitored status
      await this.client.put(`/movie/${id}`, {
        ...movie,
        monitored: false,
      });

      logger.info(`Unmonitored movie ${id} in Radarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to unmonitor movie ${id} in Radarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get movie files for a movie
   */
  async getMovieFiles(movieId: number): Promise<RadarrMovieFile[]> {
    try {
      // Radarr stores movie file info directly on the movie object
      const movie = await this.getMovieById(movieId);

      if (movie.movieFile) {
        return [movie.movieFile];
      }

      return [];
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get movie files for movie ${movieId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Delete a movie file by file ID
   */
  async deleteMovieFile(id: number): Promise<void> {
    try {
      await this.client.delete(`/moviefile/${id}`);
      logger.info(`Deleted movie file ${id} from Radarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means file doesn't exist - treat as success (already deleted)
      if (axiosError.response?.status === 404) {
        logger.info(`Movie file ${id} not found in Radarr (already deleted)`);
        return;
      }
      logger.error(`Failed to delete movie file ${id} from Radarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Delete movie files for a movie by movie ID (keeps movie metadata)
   */
  async deleteMovieFilesByMovieId(
    movieId: number,
    onProgress?: (progress: { current: number; total: number; fileName: string; status: 'deleting' | 'deleted' | 'failed' }) => void
  ): Promise<boolean> {
    try {
      const movie = await this.getMovieById(movieId);

      if (!movie.movieFile) {
        logger.info(`No movie file found for movie ${movieId}`);
        return true;
      }

      const fileName = movie.movieFile.relativePath || movie.movieFile.path || `Movie file ${movie.movieFile.id}`;

      // Emit "deleting" progress
      onProgress?.({ current: 1, total: 1, fileName, status: 'deleting' });

      await this.deleteMovieFile(movie.movieFile.id);
      logger.info(`Deleted movie file for movie ${movieId} (file ID: ${movie.movieFile.id})`);

      // Emit "deleted" progress
      onProgress?.({ current: 1, total: 1, fileName, status: 'deleted' });

      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      // 404 means movie doesn't exist
      if (axiosError.response?.status === 404) {
        logger.info(`Movie ${movieId} not found in Radarr`);
        return true;
      }
      logger.error(`Failed to delete movie file for movie ${movieId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Search for a movie by TMDB ID
   */
  async getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
    try {
      const response = await this.client.get<RadarrMovie[]>('/movie', {
        params: { tmdbId },
      });

      if (response.data.length > 0) {
        return response.data[0] ?? null;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to find movie by TMDB ID ${tmdbId}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Search for a movie by IMDB ID
   */
  async getMovieByImdbId(imdbId: string): Promise<RadarrMovie | null> {
    try {
      const allMovies = await this.getMovies();
      return allMovies.find((m) => m.imdbId === imdbId) || null;
    } catch (error) {
      logger.error(`Failed to find movie by IMDB ID ${imdbId}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Refresh movie metadata
   */
  async refreshMovie(movieId: number): Promise<void> {
    try {
      await this.client.post('/command', {
        name: 'RefreshMovie',
        movieIds: [movieId],
      });
      logger.info(`Triggered refresh for movie ${movieId} in Radarr`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to refresh movie ${movieId} in Radarr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get disk space information
   */
  async getDiskSpace(): Promise<Array<{ path: string; freeSpace: number; totalSpace: number }>> {
    try {
      const response = await this.client.get('/diskspace');
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get disk space from Radarr', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get movie by file path
   */
  async getMovieByPath(filePath: string): Promise<RadarrMovie | null> {
    try {
      const allMovies = await this.getMovies();
      return allMovies.find((m) => filePath.startsWith(m.path)) || null;
    } catch (error) {
      logger.error(`Failed to find movie by path ${filePath}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }
}

export default RadarrService;
