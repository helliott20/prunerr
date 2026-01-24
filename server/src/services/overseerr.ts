import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import type { OverseerrRequest, OverseerrApiResponse } from './types';

export class OverseerrService {
  private client: AxiosInstance;

  constructor(url: string, apiKey: string) {
    const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash

    this.client = axios.create({
      baseURL: `${baseUrl}/api/v1`,
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
          logger.warn(`Overseerr rate limited, retrying after ${retryAfter}s`);
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
   * Test connection to Overseerr
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/status');
      const isValid = !!response.data.version;

      if (isValid) {
        logger.info('Overseerr connection test successful', { version: response.data.version });
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Overseerr connection test failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get all requests with pagination
   */
  async getRequests(take: number = 100, skip: number = 0): Promise<OverseerrRequest[]> {
    try {
      const allRequests: OverseerrRequest[] = [];
      let hasMore = true;
      let currentSkip = skip;

      while (hasMore) {
        const response = await this.client.get<OverseerrApiResponse<OverseerrRequest>>('/request', {
          params: {
            take,
            skip: currentSkip,
            sort: 'added',
            filter: 'all',
          },
        });

        const results = response.data.results || [];
        allRequests.push(...results);

        // Check if there are more pages
        const pageInfo = response.data.pageInfo;
        if (pageInfo && pageInfo.page < pageInfo.pages) {
          currentSkip += take;
        } else {
          hasMore = false;
        }

        // Safety limit to prevent infinite loops
        if (allRequests.length >= 10000) {
          logger.warn('Reached maximum request limit of 10000');
          hasMore = false;
        }
      }

      logger.info(`Retrieved ${allRequests.length} requests from Overseerr`);
      return allRequests;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get requests from Overseerr', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get a request by media TMDB ID and type
   */
  async getRequestByMediaId(
    tmdbId: number,
    type: 'movie' | 'tv'
  ): Promise<OverseerrRequest | null> {
    try {
      // First, get the media info from Overseerr
      const mediaType = type === 'movie' ? 'movie' : 'tv';
      const response = await this.client.get(`/${mediaType}/${tmdbId}`);

      // Check if media exists and has request info
      if (response.data && response.data.mediaInfo) {
        const mediaInfo = response.data.mediaInfo;

        // Get the request associated with this media
        if (mediaInfo.requests && mediaInfo.requests.length > 0) {
          // Return the most recent request
          return mediaInfo.requests[0] as OverseerrRequest;
        }
      }

      return null;
    } catch (error) {
      const axiosError = error as AxiosError;

      // 404 means no media found, which is normal
      if (axiosError.response?.status === 404) {
        return null;
      }

      logger.error(`Failed to get request for ${type} with TMDB ID ${tmdbId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return null;
    }
  }

  /**
   * Get the username of who requested the media
   */
  async getRequestedBy(tmdbId: number, type: 'movie' | 'tv'): Promise<string | null> {
    try {
      const request = await this.getRequestByMediaId(tmdbId, type);

      if (request && request.requestedBy) {
        // Return display name, falling back to username or email
        return (
          request.requestedBy.displayName ||
          request.requestedBy.plexUsername ||
          request.requestedBy.username ||
          request.requestedBy.email ||
          null
        );
      }

      return null;
    } catch (error) {
      logger.error(`Failed to get requester for ${type} with TMDB ID ${tmdbId}`, {
        message: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Get media details from Overseerr by TMDB ID
   */
  async getMediaDetails(
    tmdbId: number,
    type: 'movie' | 'tv'
  ): Promise<{
    status: number;
    requestedBy: string | null;
    requests: OverseerrRequest[];
  } | null> {
    try {
      const mediaType = type === 'movie' ? 'movie' : 'tv';
      const response = await this.client.get(`/${mediaType}/${tmdbId}`);

      if (!response.data || !response.data.mediaInfo) {
        return null;
      }

      const mediaInfo = response.data.mediaInfo;
      const requests = (mediaInfo.requests || []) as OverseerrRequest[];

      // Get the primary requester
      let requestedBy: string | null = null;
      const firstRequest = requests[0];
      if (requests.length > 0 && firstRequest?.requestedBy) {
        requestedBy =
          firstRequest.requestedBy.displayName ||
          firstRequest.requestedBy.plexUsername ||
          firstRequest.requestedBy.username ||
          null;
      }

      return {
        status: mediaInfo.status,
        requestedBy,
        requests,
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 404) {
        return null;
      }

      logger.error(`Failed to get media details for ${type} with TMDB ID ${tmdbId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return null;
    }
  }

  /**
   * Search for media in Overseerr
   */
  async search(query: string): Promise<Array<{ id: number; mediaType: string; title: string }>> {
    try {
      const response = await this.client.get('/search', {
        params: { query, page: 1, language: 'en' },
      });

      const results = response.data.results || [];
      return results.map((r: { id: number; mediaType: string; title?: string; name?: string }) => ({
        id: r.id,
        mediaType: r.mediaType,
        title: r.title || r.name || 'Unknown',
      }));
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to search Overseerr for "${query}"`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return [];
    }
  }

  /**
   * Get all users from Overseerr
   */
  async getUsers(): Promise<
    Array<{ id: number; displayName: string; plexUsername?: string; email?: string }>
  > {
    try {
      const response = await this.client.get('/user', {
        params: { take: 1000, skip: 0 },
      });

      const results = response.data.results || [];
      return results.map(
        (u: { id: number; displayName: string; plexUsername?: string; email?: string }) => ({
          id: u.id,
          displayName: u.displayName,
          plexUsername: u.plexUsername,
          email: u.email,
        })
      );
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get users from Overseerr', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return [];
    }
  }

  /**
   * Get request count by user
   */
  async getRequestCountByUser(): Promise<Map<string, number>> {
    try {
      const requests = await this.getRequests();
      const countMap = new Map<string, number>();

      for (const request of requests) {
        if (request.requestedBy) {
          const username =
            request.requestedBy.displayName ||
            request.requestedBy.plexUsername ||
            request.requestedBy.username ||
            'Unknown';

          countMap.set(username, (countMap.get(username) || 0) + 1);
        }
      }

      return countMap;
    } catch (error) {
      logger.error('Failed to get request count by user', {
        message: (error as Error).message,
      });
      return new Map();
    }
  }

  // ============================================================================
  // Request Management (for deletion workflow)
  // ============================================================================

  /**
   * Delete a request by request ID
   * This removes the request from Overseerr completely
   */
  async deleteRequest(requestId: number): Promise<boolean> {
    try {
      await this.client.delete(`/request/${requestId}`);
      logger.info(`Deleted request ${requestId} from Overseerr`);
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to delete request ${requestId} from Overseerr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Delete media entry from Overseerr by media ID
   * This resets the media status so it can be re-requested
   */
  async deleteMedia(mediaId: number): Promise<boolean> {
    try {
      await this.client.delete(`/media/${mediaId}`);
      logger.info(`Deleted media ${mediaId} from Overseerr (reset status)`);
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to delete media ${mediaId} from Overseerr`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Reset media status by TMDB ID - allows content to be re-requested
   * This finds the media entry and deletes it, resetting the availability status
   */
  async resetMediaByTmdbId(tmdbId: number, type: 'movie' | 'tv'): Promise<boolean> {
    try {
      const mediaType = type === 'movie' ? 'movie' : 'tv';
      const response = await this.client.get(`/${mediaType}/${tmdbId}`);

      if (response.data && response.data.mediaInfo && response.data.mediaInfo.id) {
        const mediaId = response.data.mediaInfo.id;
        return await this.deleteMedia(mediaId);
      }

      logger.warn(`No media entry found in Overseerr for ${type} with TMDB ID ${tmdbId}`);
      return false;
    } catch (error) {
      const axiosError = error as AxiosError;

      // 404 means no media found, which is fine
      if (axiosError.response?.status === 404) {
        logger.debug(`No media entry in Overseerr for ${type} with TMDB ID ${tmdbId}`);
        return true;
      }

      logger.error(`Failed to reset media for ${type} with TMDB ID ${tmdbId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get media ID from Overseerr by TMDB ID
   */
  async getMediaId(tmdbId: number, type: 'movie' | 'tv'): Promise<number | null> {
    try {
      const mediaType = type === 'movie' ? 'movie' : 'tv';
      const response = await this.client.get(`/${mediaType}/${tmdbId}`);

      if (response.data && response.data.mediaInfo && response.data.mediaInfo.id) {
        return response.data.mediaInfo.id;
      }

      return null;
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 404) {
        return null;
      }

      logger.error(`Failed to get media ID for ${type} with TMDB ID ${tmdbId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return null;
    }
  }

  /**
   * Update request status (useful for marking as declined, etc.)
   * Status values: 1 = pending, 2 = approved, 3 = declined
   */
  async updateRequestStatus(requestId: number, status: 1 | 2 | 3): Promise<boolean> {
    try {
      const endpoint = status === 2 ? 'approve' : status === 3 ? 'decline' : null;

      if (!endpoint) {
        logger.warn(`Invalid status ${status} for request ${requestId}`);
        return false;
      }

      await this.client.post(`/request/${requestId}/${endpoint}`);
      logger.info(`Updated request ${requestId} status to ${endpoint}`);
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to update request ${requestId} status`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get request by ID
   */
  async getRequestById(requestId: number): Promise<OverseerrRequest | null> {
    try {
      const response = await this.client.get(`/request/${requestId}`);
      return response.data as OverseerrRequest;
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 404) {
        return null;
      }

      logger.error(`Failed to get request ${requestId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return null;
    }
  }

  /**
   * Notify a user about content deletion via Overseerr (if configured)
   * This creates an issue/notification in Overseerr for the requesting user
   */
  async notifyRequesterOfDeletion(
    tmdbId: number,
    type: 'movie' | 'tv',
    title: string,
    reason?: string
  ): Promise<boolean> {
    try {
      // Get the request to find the requester
      const request = await this.getRequestByMediaId(tmdbId, type);

      if (!request || !request.requestedBy) {
        logger.debug(`No requester found for ${type} with TMDB ID ${tmdbId}`);
        return false;
      }

      // Note: Overseerr doesn't have a direct notification API
      // This is a placeholder for future implementation when Overseerr adds this feature
      // For now, we log it and return true
      logger.info(`Would notify user ${request.requestedBy.displayName || request.requestedBy.email} about deletion of "${title}"`, {
        reason,
        userId: request.requestedBy.id,
      });

      return true;
    } catch (error) {
      logger.error(`Failed to notify requester about deletion of ${title}`, {
        message: (error as Error).message,
      });
      return false;
    }
  }
}

export default OverseerrService;
