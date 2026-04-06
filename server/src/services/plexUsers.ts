import axios, { AxiosError } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import logger from '../utils/logger';
import plexUsersRepo, { type PlexUser, type PlexUserInput } from '../db/repositories/plexUsers';

const PLEX_TV_BASE_URL = 'https://plex.tv';

interface PlexTvAccountXml {
  MediaContainer?: {
    User?: PlexTvUserXml | PlexTvUserXml[];
    '@_id'?: string;
    '@_title'?: string;
  };
  user?: {
    '@_id'?: string;
    '@_username'?: string;
    '@_email'?: string;
    '@_thumb'?: string;
  };
}

interface PlexTvUserXml {
  '@_id': string;
  '@_title'?: string;
  '@_username'?: string;
  '@_email'?: string;
  '@_thumb'?: string;
  '@_home'?: string;
}

interface PmsAccountsXml {
  MediaContainer?: {
    Account?: PmsAccountXml | PmsAccountXml[];
  };
}

interface PmsAccountXml {
  '@_id': string;
  '@_key'?: string;
  '@_name'?: string;
  '@_defaultAudioLanguage'?: string;
  '@_autoSelectAudio'?: string;
  '@_defaultSubtitleLanguage'?: string;
  '@_subtitleMode'?: string;
  '@_thumb'?: string;
}

/**
 * PlexUsersService fetches users (owner + shared friends/home users) from Plex.
 *
 * Strategy:
 *   1. Try plex.tv/api/users (shared friends) using the X-Plex-Token — this is the
 *      authoritative list of users who can access the owner's server.
 *   2. Also fetch /myplex/account (or /) on plex.tv to identify the owner account.
 *   3. Fall back to the PMS `/accounts` endpoint if plex.tv calls fail.
 */
export class PlexUsersService {
  private pmsUrl: string;
  private token: string;
  private parser: XMLParser;

  constructor(pmsUrl: string, token: string) {
    this.pmsUrl = pmsUrl.replace(/\/$/, '');
    this.token = token;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['User', 'Account'].includes(name),
    });
  }

  /**
   * Fetch all users (owner + friends) from Plex.
   * Returns a normalized list of PlexUserInput records.
   */
  async getUsers(): Promise<PlexUserInput[]> {
    const [ownerResult, friendsResult] = await Promise.allSettled([
      this.fetchOwner(),
      this.fetchFriends(),
    ]);

    const users: PlexUserInput[] = [];
    const seen = new Set<string>();
    const addUnique = (user: PlexUserInput) => {
      if (!seen.has(user.plex_user_id)) {
        seen.add(user.plex_user_id);
        users.push(user);
      }
    };

    if (ownerResult.status === 'fulfilled' && ownerResult.value) {
      addUnique(ownerResult.value);
    } else if (ownerResult.status === 'rejected') {
      const axiosErr = ownerResult.reason as AxiosError;
      logger.warn('Failed to fetch Plex owner account from plex.tv', {
        status: axiosErr.response?.status,
        message: axiosErr.message,
      });
    }

    if (friendsResult.status === 'fulfilled') {
      for (const friend of friendsResult.value) {
        addUnique(friend);
      }
      return users;
    }

    const axiosErr = friendsResult.reason as AxiosError;
    logger.warn('Failed to fetch Plex friends from plex.tv, falling back to PMS /accounts', {
      status: axiosErr.response?.status,
      message: axiosErr.message,
    });

    // Fallback to PMS accounts endpoint
    const pmsUsers = await this.fetchPmsAccounts();
    for (const u of pmsUsers) {
      addUnique(u);
    }
    return users;
  }

  /**
   * Sync users to the local database (full-replace).
   */
  async syncUsers(): Promise<PlexUser[]> {
    logger.info('Starting Plex users sync');
    const users = await this.getUsers();

    if (users.length === 0) {
      logger.warn('No Plex users returned from sync');
      return [];
    }

    const synced = plexUsersRepo.replace(users);
    logger.info(`Plex users sync completed: ${synced.length} users`);
    return synced;
  }

  /**
   * Fetch the owner account via plex.tv.
   * Endpoint: GET https://plex.tv/users/account.xml
   */
  private async fetchOwner(): Promise<PlexUserInput | null> {
    const response = await axios.get(`${PLEX_TV_BASE_URL}/users/account.xml`, {
      headers: {
        'X-Plex-Token': this.token,
        Accept: 'application/xml',
      },
      timeout: 15000,
    });

    const parsed = this.parser.parse(response.data) as PlexTvAccountXml;
    const user = parsed.user;
    if (!user || !user['@_id']) {
      return null;
    }

    return {
      plex_user_id: String(user['@_id']),
      username: user['@_username'] ?? 'owner',
      email: user['@_email'] ?? null,
      thumb_url: user['@_thumb'] ?? null,
      is_home_user: 0,
      is_owner: 1,
    };
  }

  /**
   * Fetch shared friends via plex.tv.
   * Endpoint: GET https://plex.tv/api/users
   */
  private async fetchFriends(): Promise<PlexUserInput[]> {
    const response = await axios.get(`${PLEX_TV_BASE_URL}/api/users`, {
      headers: {
        'X-Plex-Token': this.token,
        Accept: 'application/xml',
      },
      timeout: 15000,
    });

    const parsed = this.parser.parse(response.data) as PlexTvAccountXml;
    const userNodes = parsed.MediaContainer?.User;
    if (!userNodes) {
      return [];
    }

    const usersArr = Array.isArray(userNodes) ? userNodes : [userNodes];
    return usersArr
      .filter((u) => u['@_id'])
      .map((u) => ({
        plex_user_id: String(u['@_id']),
        username: u['@_username'] ?? u['@_title'] ?? `user-${u['@_id']}`,
        email: u['@_email'] ?? null,
        thumb_url: u['@_thumb'] ?? null,
        is_home_user: u['@_home'] === '1' ? 1 : 0,
        is_owner: 0,
      }));
  }

  /**
   * Fallback: fetch users via PMS /accounts endpoint.
   * Endpoint: GET {pmsUrl}/accounts
   */
  private async fetchPmsAccounts(): Promise<PlexUserInput[]> {
    const response = await axios.get(`${this.pmsUrl}/accounts`, {
      headers: {
        'X-Plex-Token': this.token,
        Accept: 'application/xml',
      },
      timeout: 15000,
    });

    const parsed = this.parser.parse(response.data) as PmsAccountsXml;
    const accountNodes = parsed.MediaContainer?.Account;
    if (!accountNodes) {
      return [];
    }

    const accountsArr = Array.isArray(accountNodes) ? accountNodes : [accountNodes];
    return accountsArr
      .filter((a) => a['@_id'] && a['@_id'] !== '0') // id=0 is the "anyone" placeholder account
      .map((a) => ({
        plex_user_id: String(a['@_id']),
        username: a['@_name'] ?? `account-${a['@_id']}`,
        email: null,
        thumb_url: a['@_thumb'] ?? null,
        is_home_user: 0,
        // id=1 on PMS is the server owner
        is_owner: a['@_id'] === '1' ? 1 : 0,
      }));
  }
}

export default PlexUsersService;
