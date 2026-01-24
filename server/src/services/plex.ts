import axios, { AxiosInstance, AxiosError } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import logger from '../utils/logger';
import type { PlexLibrary, PlexMediaItem, PlexMedia, PlexMediaPart, PlexGuid } from './types';

interface PlexXmlContainer {
  MediaContainer: {
    Directory?: PlexXmlDirectory | PlexXmlDirectory[];
    Video?: PlexXmlVideo | PlexXmlVideo[];
    Metadata?: PlexXmlMetadata | PlexXmlMetadata[];
    size?: number;
    totalSize?: number;
    [key: string]: unknown;
  };
}

interface PlexXmlDirectory {
  '@_key': string;
  '@_title': string;
  '@_type': string;
  '@_agent': string;
  '@_scanner': string;
  '@_language': string;
  '@_uuid': string;
  '@_updatedAt': string;
  '@_createdAt': string;
  '@_scannedAt': string;
  '@_contentChangedAt': string;
  '@_hidden': string;
  Location?: PlexXmlLocation | PlexXmlLocation[];
}

interface PlexXmlLocation {
  '@_path': string;
}

interface PlexXmlVideo {
  '@_ratingKey': string;
  '@_key': string;
  '@_guid': string;
  '@_type': string;
  '@_title': string;
  '@_titleSort'?: string;
  '@_originalTitle'?: string;
  '@_contentRating'?: string;
  '@_summary'?: string;
  '@_rating'?: string;
  '@_audienceRating'?: string;
  '@_year'?: string;
  '@_tagline'?: string;
  '@_thumb'?: string;
  '@_art'?: string;
  '@_duration'?: string;
  '@_originallyAvailableAt'?: string;
  '@_addedAt': string;
  '@_updatedAt': string;
  '@_studio'?: string;
  '@_childCount'?: string;
  '@_leafCount'?: string;
  '@_viewedLeafCount'?: string;
  '@_viewCount'?: string;
  '@_lastViewedAt'?: string;
  '@_parentRatingKey'?: string;
  '@_grandparentRatingKey'?: string;
  '@_parentTitle'?: string;
  '@_grandparentTitle'?: string;
  '@_index'?: string;
  '@_parentIndex'?: string;
  Media?: PlexXmlMedia | PlexXmlMedia[];
  Guid?: PlexXmlGuid | PlexXmlGuid[];
}

interface PlexXmlMetadata extends PlexXmlVideo {}

interface PlexXmlMedia {
  '@_id': string;
  '@_duration': string;
  '@_bitrate': string;
  '@_width': string;
  '@_height': string;
  '@_aspectRatio': string;
  '@_audioChannels': string;
  '@_audioCodec': string;
  '@_videoCodec': string;
  '@_videoResolution': string;
  '@_container': string;
  '@_videoFrameRate': string;
  '@_videoProfile': string;
  Part?: PlexXmlPart | PlexXmlPart[];
}

interface PlexXmlPart {
  '@_id': string;
  '@_key': string;
  '@_duration': string;
  '@_file': string;
  '@_size': string;
  '@_container': string;
  '@_videoProfile': string;
}

interface PlexXmlGuid {
  '@_id': string;
}

export class PlexService {
  private client: AxiosInstance;
  private parser: XMLParser;
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, ''); // Remove trailing slash
    this.token = token;

    this.client = axios.create({
      baseURL: this.url,
      headers: {
        'X-Plex-Token': token,
        Accept: 'application/xml',
      },
      timeout: 30000,
    });

    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => {
        // These elements should always be treated as arrays
        return ['Directory', 'Video', 'Metadata', 'Media', 'Part', 'Location', 'Guid'].includes(name);
      },
    });

    // Add response interceptor for rate limiting
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] as string) || 5;
          logger.warn(`Plex rate limited, retrying after ${retryAfter}s`);
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

  private parseXml(xml: string): PlexXmlContainer {
    return this.parser.parse(xml) as PlexXmlContainer;
  }

  private ensureArray<T>(item: T | T[] | undefined): T[] {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  }

  /**
   * Test connection to Plex server
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/');
      const parsed = this.parseXml(response.data);
      const isValid = !!parsed.MediaContainer;

      if (isValid) {
        logger.info('Plex connection test successful');
      }

      return isValid;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Plex connection test failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }

  /**
   * Get all libraries from Plex
   */
  async getLibraries(): Promise<PlexLibrary[]> {
    try {
      const response = await this.client.get('/library/sections');
      const parsed = this.parseXml(response.data);
      const directories = this.ensureArray(parsed.MediaContainer?.Directory);

      const libraries: PlexLibrary[] = directories.map((dir: PlexXmlDirectory) => {
        const locations = this.ensureArray(dir.Location);

        return {
          key: dir['@_key'],
          title: dir['@_title'],
          type: dir['@_type'] as PlexLibrary['type'],
          agent: dir['@_agent'],
          scanner: dir['@_scanner'],
          language: dir['@_language'],
          uuid: dir['@_uuid'],
          updatedAt: parseInt(dir['@_updatedAt']) || 0,
          createdAt: parseInt(dir['@_createdAt']) || 0,
          scannedAt: parseInt(dir['@_scannedAt']) || 0,
          contentChangedAt: parseInt(dir['@_contentChangedAt']) || 0,
          hidden: dir['@_hidden'] === '1',
          location: locations.map((loc: PlexXmlLocation) => loc['@_path']),
        };
      });

      logger.info(`Retrieved ${libraries.length} libraries from Plex`);
      return libraries;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error('Failed to get Plex libraries', {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get all items in a library
   */
  async getLibraryItems(libraryId: string): Promise<PlexMediaItem[]> {
    try {
      const response = await this.client.get(`/library/sections/${libraryId}/all`);
      const parsed = this.parseXml(response.data);

      // Items can be Video (movies) or Directory (shows)
      const videos = this.ensureArray(parsed.MediaContainer?.Video);
      const directories = this.ensureArray(parsed.MediaContainer?.Directory);
      const metadata = this.ensureArray(parsed.MediaContainer?.Metadata);

      // Combine all item types
      const allItems = [...videos, ...directories, ...metadata] as PlexXmlVideo[];

      const items: PlexMediaItem[] = allItems.map((item) => this.parseMediaItem(item));

      logger.info(`Retrieved ${items.length} items from Plex library ${libraryId}`);
      return items;
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get items from Plex library ${libraryId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Get detailed metadata for a specific item
   */
  async getItemMetadata(ratingKey: string): Promise<PlexMediaItem> {
    try {
      const response = await this.client.get(`/library/metadata/${ratingKey}`);
      const parsed = this.parseXml(response.data);

      const metadata = this.ensureArray(parsed.MediaContainer?.Metadata);
      const videos = this.ensureArray(parsed.MediaContainer?.Video);
      // TV shows are returned as Directory elements (same structure as Video for our purposes)
      const directories = this.ensureArray(parsed.MediaContainer?.Directory) as unknown as PlexXmlVideo[];
      const item = metadata[0] || videos[0] || directories[0];

      if (!item) {
        throw new Error(`Item with ratingKey ${ratingKey} not found`);
      }

      return this.parseMediaItem(item);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to get metadata for item ${ratingKey}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Trigger a library refresh/scan
   */
  async refreshLibrary(libraryId: string): Promise<void> {
    try {
      await this.client.get(`/library/sections/${libraryId}/refresh`);
      logger.info(`Triggered refresh for Plex library ${libraryId}`);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error(`Failed to refresh Plex library ${libraryId}`, {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      throw error;
    }
  }

  /**
   * Parse XML item to PlexMediaItem
   */
  private parseMediaItem(item: PlexXmlVideo): PlexMediaItem {
    const mediaArray = this.ensureArray(item.Media);
    const guidArray = this.ensureArray(item.Guid);

    const media: PlexMedia[] = mediaArray.map((m: PlexXmlMedia) => {
      const partsArray = this.ensureArray(m.Part);

      const parts: PlexMediaPart[] = partsArray.map((p: PlexXmlPart) => ({
        id: parseInt(p['@_id']) || 0,
        key: p['@_key'],
        duration: parseInt(p['@_duration']) || 0,
        file: p['@_file'],
        size: parseInt(p['@_size']) || 0,
        container: p['@_container'],
        videoProfile: p['@_videoProfile'],
      }));

      return {
        id: parseInt(m['@_id']) || 0,
        duration: parseInt(m['@_duration']) || 0,
        bitrate: parseInt(m['@_bitrate']) || 0,
        width: parseInt(m['@_width']) || 0,
        height: parseInt(m['@_height']) || 0,
        aspectRatio: parseFloat(m['@_aspectRatio']) || 0,
        audioChannels: parseInt(m['@_audioChannels']) || 0,
        audioCodec: m['@_audioCodec'],
        videoCodec: m['@_videoCodec'],
        videoResolution: m['@_videoResolution'],
        container: m['@_container'],
        videoFrameRate: m['@_videoFrameRate'],
        videoProfile: m['@_videoProfile'],
        parts,
      };
    });

    const guids: PlexGuid[] = guidArray.map((g: PlexXmlGuid) => ({
      id: g['@_id'],
    }));

    return {
      ratingKey: item['@_ratingKey'],
      key: item['@_key'],
      guid: item['@_guid'],
      type: item['@_type'] as PlexMediaItem['type'],
      title: item['@_title'],
      titleSort: item['@_titleSort'],
      originalTitle: item['@_originalTitle'],
      contentRating: item['@_contentRating'],
      summary: item['@_summary'],
      rating: item['@_rating'] ? parseFloat(item['@_rating']) : undefined,
      audienceRating: item['@_audienceRating'] ? parseFloat(item['@_audienceRating']) : undefined,
      year: item['@_year'] ? parseInt(item['@_year']) : undefined,
      tagline: item['@_tagline'],
      thumb: item['@_thumb'],
      art: item['@_art'],
      duration: item['@_duration'] ? parseInt(item['@_duration']) : undefined,
      originallyAvailableAt: item['@_originallyAvailableAt'],
      addedAt: parseInt(item['@_addedAt']) || 0,
      updatedAt: parseInt(item['@_updatedAt']) || 0,
      studio: item['@_studio'],
      childCount: item['@_childCount'] ? parseInt(item['@_childCount']) : undefined,
      leafCount: item['@_leafCount'] ? parseInt(item['@_leafCount']) : undefined,
      viewedLeafCount: item['@_viewedLeafCount'] ? parseInt(item['@_viewedLeafCount']) : undefined,
      viewCount: item['@_viewCount'] ? parseInt(item['@_viewCount']) : undefined,
      lastViewedAt: item['@_lastViewedAt'] ? parseInt(item['@_lastViewedAt']) : undefined,
      parentRatingKey: item['@_parentRatingKey'],
      grandparentRatingKey: item['@_grandparentRatingKey'],
      parentTitle: item['@_parentTitle'],
      grandparentTitle: item['@_grandparentTitle'],
      index: item['@_index'] ? parseInt(item['@_index']) : undefined,
      parentIndex: item['@_parentIndex'] ? parseInt(item['@_parentIndex']) : undefined,
      media: media.length > 0 ? media : undefined,
      guids: guids.length > 0 ? guids : undefined,
    };
  }

  /**
   * Get the full URL for a thumb/art path (includes auth token)
   */
  getImageUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    // Include the token for authentication
    const separator = path.includes('?') ? '&' : '?';
    return `${this.url}${path}${separator}X-Plex-Token=${this.token}`;
  }
}

export default PlexService;
