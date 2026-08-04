import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      interceptors: { response: { use: vi.fn() } },
      request: vi.fn(),
    }),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { JellyfinService } from '../jellyfin';

const MOVIE = {
  Id: 'abc123',
  Name: 'Blade Runner 2049',
  Type: 'Movie',
  ProductionYear: 2017,
  OfficialRating: 'R',
  Overview: 'K, a new blade runner...',
  Taglines: ['There is an order to things'],
  CommunityRating: 8.0,
  CriticRating: 88,
  DateCreated: '2024-03-01T12:00:00.0000000Z',
  PremiereDate: '2017-10-04T00:00:00.0000000Z',
  RunTimeTicks: 98_640_000_000, // 2h44m40s
  Genres: ['Science Fiction', 'Drama'],
  Tags: ['4k-remux'],
  Studios: [{ Name: 'Warner Bros.' }],
  ProviderIds: { Tmdb: '335984', Imdb: 'tt1856101' },
  ImageTags: { Primary: 'tag-primary' },
  UserData: { PlayCount: 3, Played: true, LastPlayedDate: '2025-06-01T20:00:00.0000000Z' },
  MediaSources: [
    {
      Id: 'src1',
      Path: '/media/movies/Blade Runner 2049.mkv',
      Container: 'mkv',
      Size: 64_424_509_440,
      Bitrate: 52_000_000,
      RunTimeTicks: 98_640_000_000,
      MediaStreams: [
        {
          Type: 'Video',
          Index: 0,
          Codec: 'hevc',
          Profile: 'Main 10',
          Width: 3840,
          Height: 2160,
          AspectRatio: '16:9',
          AverageFrameRate: 23.976,
          VideoRange: 'HDR',
          VideoRangeType: 'DOVIWithHDR10',
          DisplayTitle: '4K HEVC Dolby Vision',
        },
        { Type: 'Audio', Index: 1, Codec: 'truehd', Channels: 8, Language: 'eng' },
        { Type: 'Subtitle', Index: 2, Codec: 'subrip', Language: 'eng' },
      ],
    },
  ],
};

function service(type: 'jellyfin' | 'emby' = 'jellyfin') {
  return new JellyfinService('http://jf.local:8096/', 'KEY123', type);
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('constructor', () => {
  it('rejects a backend it cannot serve', () => {
    expect(() => new JellyfinService('http://x', 'k', 'plex')).toThrow(/cannot serve/i);
  });

  it('reports its own backend type', () => {
    expect(service('jellyfin').serverType).toBe('jellyfin');
    expect(service('emby').serverType).toBe('emby');
  });
});

describe('testConnection', () => {
  it('is true only when the server reports a version', async () => {
    getMock.mockResolvedValueOnce({ data: { ServerName: 'jf', Version: '10.9.6' } });
    expect(await service().testConnection()).toBe(true);

    getMock.mockResolvedValueOnce({ data: {} });
    expect(await service().testConnection()).toBe(false);
  });

  it('returns false rather than throwing when the server is unreachable', async () => {
    getMock.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { response: undefined }));
    expect(await service().testConnection()).toBe(false);
  });
});

describe('getLibraries', () => {
  it('maps collection types onto the canonical library types', async () => {
    getMock.mockResolvedValueOnce({
      data: [
        { Name: 'Movies', ItemId: '1', CollectionType: 'movies', Locations: ['/media/movies'] },
        { Name: 'Shows', ItemId: '2', CollectionType: 'tvshows', Locations: ['/media/tv'] },
        { Name: 'Music', ItemId: '3', CollectionType: 'music' },
      ],
    });

    const libraries = await service().getLibraries();

    expect(libraries.map((l) => [l.key, l.title, l.type])).toEqual([
      ['1', 'Movies', 'movie'],
      ['2', 'Shows', 'show'],
      ['3', 'Music', 'artist'],
    ]);
    expect(libraries[0]!.location).toEqual(['/media/movies']);
    // Absent Locations must not produce undefined — the scanner iterates it.
    expect(libraries[2]!.location).toEqual([]);
  });

  it('defaults an unrecognised collection type to movie rather than dropping it', async () => {
    getMock.mockResolvedValueOnce({ data: [{ Name: 'Odd', ItemId: '9', CollectionType: 'wat' }] });
    const [lib] = await service().getLibraries();
    expect(lib!.type).toBe('movie');
  });
});

describe('getLibraryItems', () => {
  it('pages until TotalRecordCount is reached', async () => {
    getMock
      .mockResolvedValueOnce({ data: { Items: [MOVIE, MOVIE], TotalRecordCount: 3 } })
      .mockResolvedValueOnce({ data: { Items: [MOVIE], TotalRecordCount: 3 } });

    const items = await service().getLibraryItems('1');

    expect(items).toHaveLength(3);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock.mock.calls[1]![1]).toMatchObject({ params: { StartIndex: 2 } });
  });

  it('stops on an empty page when the server omits a total', async () => {
    getMock
      .mockResolvedValueOnce({ data: { Items: [MOVIE] } })
      .mockResolvedValueOnce({ data: { Items: [] } });

    expect(await service().getLibraryItems('1')).toHaveLength(1);
  });

  it('requests only top-level entities, not episodes', async () => {
    getMock.mockResolvedValueOnce({ data: { Items: [], TotalRecordCount: 0 } });
    await service().getLibraryItems('1');
    expect(getMock.mock.calls[0]![1]).toMatchObject({
      params: { IncludeItemTypes: 'Movie,Series', Recursive: true },
    });
  });
});

describe('item translation', () => {
  async function parseMovie() {
    getMock.mockResolvedValueOnce({ data: { Items: [MOVIE], TotalRecordCount: 1 } });
    const [item] = await service().getLibraryItems('1');
    return item!;
  }

  it('maps core metadata', async () => {
    const item = await parseMovie();
    expect(item.ratingKey).toBe('abc123');
    expect(item.title).toBe('Blade Runner 2049');
    expect(item.type).toBe('movie');
    expect(item.year).toBe(2017);
    expect(item.contentRating).toBe('R');
    expect(item.studio).toBe('Warner Bros.');
    expect(item.tagline).toBe('There is an order to things');
    expect(item.genres).toEqual(['Science Fiction', 'Drama']);
    expect(item.labels).toEqual(['4k-remux']);
  });

  it('converts ticks to milliseconds', async () => {
    const item = await parseMovie();
    expect(item.duration).toBe(9_864_000);
  });

  it('converts dates to unix seconds and trims the premiere date', async () => {
    const item = await parseMovie();
    expect(item.addedAt).toBe(Math.floor(Date.parse('2024-03-01T12:00:00Z') / 1000));
    expect(item.originallyAvailableAt).toBe('2017-10-04');
  });

  it('rescales CriticRating from 0-100 to the 0-10 the rules engine expects', async () => {
    const item = await parseMovie();
    expect(item.rating).toBe(8.8);
    expect(item.audienceRating).toBe(8.0);
  });

  it('converts ProviderIds into Plex-style guids for *arr matching', async () => {
    const item = await parseMovie();
    expect(item.guids).toEqual([{ id: 'tmdb://335984' }, { id: 'imdb://tt1856101' }]);
    expect(item.guid).toBe('tmdb://335984');
  });

  it('falls back to a jellyfin guid when the item has no external ids', async () => {
    getMock.mockResolvedValueOnce({
      data: { Items: [{ ...MOVIE, ProviderIds: undefined }], TotalRecordCount: 1 },
    });
    const [item] = await service().getLibraryItems('1');
    expect(item!.guid).toBe('jellyfin://abc123');
    expect(item!.guids).toBeUndefined();
  });

  it('maps file size and path, which deletion depends on', async () => {
    const item = await parseMovie();
    const part = item.media![0]!.parts[0]!;
    expect(part.size).toBe(64_424_509_440);
    expect(part.file).toBe('/media/movies/Blade Runner 2049.mkv');
  });

  it('derives Plex-style resolution buckets', async () => {
    const item = await parseMovie();
    expect(item.media![0]!.videoResolution).toBe('4k');
    expect(item.media![0]!.width).toBe(3840);
    expect(item.media![0]!.height).toBe(2160);
  });

  it('detects Dolby Vision from VideoRangeType', async () => {
    const item = await parseMovie();
    expect(item.hdr).toBe('dv');
  });

  it('maps stream types onto Plex numeric codes', async () => {
    const item = await parseMovie();
    const streams = item.media![0]!.parts[0]!.streams!;
    expect(streams.map((s) => s.streamType)).toEqual([1, 2, 3]);
    expect(item.media![0]!.audioCodec).toBe('truehd');
    expect(item.media![0]!.audioChannels).toBe(8);
  });

  it('parses a ratio string into a number', async () => {
    const item = await parseMovie();
    expect(item.media![0]!.aspectRatio).toBeCloseTo(1.78, 2);
  });

  it('leaves media undefined for a series, which carries no MediaSources', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        Items: [{ Id: 's1', Name: 'Severance', Type: 'Series', ChildCount: 2, RecursiveItemCount: 18 }],
        TotalRecordCount: 1,
      },
    });
    const [item] = await service().getLibraryItems('1');
    expect(item!.type).toBe('show');
    expect(item!.media).toBeUndefined();
    expect(item!.childCount).toBe(2);
    expect(item!.leafCount).toBe(18);
  });

  it('maps SDR content to none rather than leaving it unset', async () => {
    const sdr = structuredClone(MOVIE);
    sdr.MediaSources[0]!.MediaStreams[0]! = {
      ...sdr.MediaSources[0]!.MediaStreams[0]!,
      VideoRangeType: 'SDR',
      DisplayTitle: '1080p H264',
    };
    getMock.mockResolvedValueOnce({ data: { Items: [sdr], TotalRecordCount: 1 } });
    const [item] = await service().getLibraryItems('1');
    expect(item!.hdr).toBe('none');
  });
});

describe('getWatchHistory', () => {
  const PLUGIN_404 = Object.assign(new Error('not found'), { response: { status: 404 } });

  it('prefers the Playback Reporting plugin when it responds', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        columns: ['DateCreated', 'UserId', 'ItemId', 'ItemType', 'ItemName'],
        results: [
          ['2025-06-01 20:00:00', 'user-guid-1', 'abc123', 'Movie', 'Blade Runner 2049'],
          ['2025-05-30 19:00:00', 'user-guid-2', 'ep-1', 'Episode', 'Good News About Hell'],
        ],
      },
    });

    const entries = await service().getWatchHistory();

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      ratingKey: 'abc123',
      accountKey: 'user-guid-1',
      type: 'movie',
      title: 'Blade Runner 2049',
    });
    expect(entries[1]!.type).toBe('episode');
    // The plugin path must not fall through to the per-user scan.
    expect(getMock).not.toHaveBeenCalled();
  });

  it('keeps repeat plays of the same item as distinct events', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        results: [
          ['2025-06-01 20:00:00', 'u1', 'abc123', 'Movie', 'Blade Runner 2049'],
          ['2025-05-01 20:00:00', 'u1', 'abc123', 'Movie', 'Blade Runner 2049'],
        ],
      },
    });

    const entries = await service().getWatchHistory();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.historyKey)).size).toBe(2);
  });

  it('falls back to per-user watch state when the plugin is absent', async () => {
    postMock.mockRejectedValueOnce(PLUGIN_404);
    getMock
      .mockResolvedValueOnce({ data: [{ Id: 'u1', Name: 'harry', Policy: { IsAdministrator: true } }] })
      .mockResolvedValueOnce({
        data: {
          Items: [
            { Id: 'abc123', Name: 'Blade Runner 2049', Type: 'Movie', UserData: { LastPlayedDate: '2025-06-01T20:00:00Z' } },
          ],
          TotalRecordCount: 1,
        },
      });

    const entries = await service().getWatchHistory();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ratingKey: 'abc123', accountKey: 'u1', type: 'movie' });
  });

  it('stops paging a user once entries predate sinceUnix', async () => {
    postMock.mockRejectedValueOnce(PLUGIN_404);
    getMock.mockResolvedValueOnce({ data: [{ Id: 'u1', Name: 'harry' }] }).mockResolvedValueOnce({
      data: {
        Items: [
          { Id: 'new', Name: 'Recent', Type: 'Movie', UserData: { LastPlayedDate: '2025-06-01T20:00:00Z' } },
          { Id: 'old', Name: 'Ancient', Type: 'Movie', UserData: { LastPlayedDate: '2020-01-01T00:00:00Z' } },
        ],
        TotalRecordCount: 2,
      },
    });

    const since = Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000);
    const entries = await service().getWatchHistory({ sinceUnix: since });

    expect(entries.map((e) => e.ratingKey)).toEqual(['new']);
  });

  it('skips items that were never actually played', async () => {
    postMock.mockRejectedValueOnce(PLUGIN_404);
    getMock.mockResolvedValueOnce({ data: [{ Id: 'u1', Name: 'harry' }] }).mockResolvedValueOnce({
      data: { Items: [{ Id: 'x', Name: 'Unplayed', Type: 'Movie', UserData: {} }], TotalRecordCount: 1 },
    });

    expect(await service().getWatchHistory()).toEqual([]);
  });

  it('does not let one unreadable user sink the whole sync', async () => {
    postMock.mockRejectedValueOnce(PLUGIN_404);
    getMock
      .mockResolvedValueOnce({
        data: [
          { Id: 'u1', Name: 'broken' },
          { Id: 'u2', Name: 'fine' },
        ],
      })
      .mockRejectedValueOnce(Object.assign(new Error('403'), { response: { status: 403 } }))
      .mockResolvedValueOnce({
        data: {
          Items: [{ Id: 'ok', Name: 'Watched', Type: 'Movie', UserData: { LastPlayedDate: '2025-06-01T20:00:00Z' } }],
          TotalRecordCount: 1,
        },
      });

    const entries = await service().getWatchHistory();
    expect(entries.map((e) => e.accountKey)).toEqual(['u2']);
  });

  it('falls back when the plugin returns an unexpected column count', async () => {
    postMock.mockResolvedValueOnce({ data: { columns: ['a', 'b'], results: [['1', '2']] } });
    getMock.mockResolvedValueOnce({ data: [] });

    // Empty users list => empty history, but crucially it did not trust the
    // malformed plugin response.
    expect(await service().getWatchHistory()).toEqual([]);
    expect(getMock).toHaveBeenCalled();
  });
});

describe('getImageUrl', () => {
  it('signs relative paths and leaves absolute URLs alone', () => {
    const jf = service('jellyfin');
    expect(jf.getImageUrl('/Items/1/Images/Primary')).toBe(
      'http://jf.local:8096/Items/1/Images/Primary?ApiKey=KEY123'
    );
    expect(jf.getImageUrl('https://cdn/x.jpg')).toBe('https://cdn/x.jpg');
    expect(jf.getImageUrl('')).toBe('');
  });

  it('appends to an existing query string rather than starting a new one', () => {
    expect(service().getImageUrl('/Items/1/Images/Primary?tag=abc')).toBe(
      'http://jf.local:8096/Items/1/Images/Primary?tag=abc&ApiKey=KEY123'
    );
  });

  it('uses the Emby-flavoured parameter for Emby', () => {
    expect(service('emby').getImageUrl('/Items/1/Images/Primary')).toContain('api_key=KEY123');
  });
});

describe('fetchUsers', () => {
  it('maps administrators to owners and caches the result', async () => {
    getMock.mockResolvedValueOnce({
      data: [
        { Id: 'u1', Name: 'harry', Policy: { IsAdministrator: true }, PrimaryImageTag: 't' },
        { Id: 'u2', Name: 'sarah', Policy: { IsAdministrator: false } },
      ],
    });

    const svc = service();
    const users = await svc.fetchUsers();

    expect(users).toEqual([
      {
        id: 'u1',
        username: 'harry',
        email: null,
        thumbUrl: 'http://jf.local:8096/Users/u1/Images/Primary',
        isOwner: true,
        isHomeUser: false,
      },
      { id: 'u2', username: 'sarah', email: null, thumbUrl: null, isOwner: false, isHomeUser: false },
    ]);

    await svc.fetchUsers();
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list rather than throwing when /Users fails', async () => {
    getMock.mockRejectedValueOnce(Object.assign(new Error('500'), { response: { status: 500 } }));
    expect(await service().fetchUsers()).toEqual([]);
  });
});
