import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Rocket, SlidersHorizontal, LifeBuoy } from 'lucide-react';
import {
  AppLink,
  Callout,
  Code,
  CodeBlock,
  DocLink,
  EnvTable,
  ExternalLink,
  List,
  P,
  Steps,
  SubHeading,
  Ui,
} from './DocsPrimitives';

/**
 * The docs themselves. These replace the GitHub wiki pages (Installation,
 * Configuration, Troubleshooting), so they ship with the version they
 * describe. English only for now: the page chrome is translated, the guides
 * are not.
 *
 * Section ids are permanent anchors (/docs#config-from-env) — other parts of
 * the app link to them, so rename with care.
 */

export interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface DocGuide {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  sections: DocSection[];
}

const FORUM_URL = 'https://forums.unraid.net/topic/196929-support-prunerr-media-library-cleanup-tool/';
const ISSUES_URL = 'https://github.com/helliott20/prunerr/issues';
const DISCUSSIONS_URL = 'https://github.com/helliott20/prunerr/discussions';

const DOCKER_RUN = `docker run -d \\
  --name prunerr \\
  -p 3000:3000 \\
  -v /path/to/data:/app/data \\
  -e PLEX_URL=http://your-plex-server:32400 \\
  -e PLEX_TOKEN=your-plex-token \\
  -e SONARR_URL=http://your-sonarr:8989 \\
  -e SONARR_API_KEY=your-sonarr-api-key \\
  -e RADARR_URL=http://your-radarr:7878 \\
  -e RADARR_API_KEY=your-radarr-api-key \\
  helliott20/prunerr:latest`;

const DOCKER_COMPOSE = `services:
  prunerr:
    image: helliott20/prunerr:latest
    container_name: prunerr
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      # Uncomment to keep this file as the source of truth for the connections
      # below. Otherwise they only fill in Settings on first start.
      # - CONFIG_FROM_ENV=true
      - PLEX_URL=http://plex:32400
      - PLEX_TOKEN=your-plex-token
      - SONARR_URL=http://sonarr:8989
      - SONARR_API_KEY=your-sonarr-api-key
      - RADARR_URL=http://radarr:7878
      - RADARR_API_KEY=your-radarr-api-key
      # Watch history - you need at least one of these
      - TAUTULLI_URL=http://tautulli:8181
      - TAUTULLI_API_KEY=your-tautulli-api-key
      # Optional stuff
      - OVERSEERR_URL=http://overseerr:5055
      - OVERSEERR_API_KEY=your-overseerr-api-key
      - DISCORD_WEBHOOK_URL=your-discord-webhook
    restart: unless-stopped`;

const UNRAID_TEMPLATE = 'https://raw.githubusercontent.com/helliott20/prunerr/main/my-prunerr.xml';

const installation: DocGuide = {
  id: 'installation',
  title: 'Installation',
  summary: 'Get Prunerr running with Docker, Compose or Unraid.',
  icon: Rocket,
  sections: [
    {
      id: 'docker',
      title: 'Docker',
      body: (
        <>
          <P>The quickest way to get going is a single container:</P>
          <CodeBlock language="bash" code={DOCKER_RUN} />
        </>
      ),
    },
    {
      id: 'docker-compose',
      title: 'Docker Compose',
      body: (
        <>
          <P>If you run everything in Compose (most people do):</P>
          <CodeBlock language="yaml" code={DOCKER_COMPOSE} />
          <Callout type="tip">
            Leave <Code>CONFIG_FROM_ENV</Code> commented out if you&apos;d rather manage connections in the UI. See{' '}
            <DocLink to="config-from-env">Settings or environment variables</DocLink>
            .
          </Callout>
        </>
      ),
    },
    {
      id: 'unraid',
      title: 'Unraid',
      body: (
        <>
          <P>
            Prunerr is in the Community Apps store. Search for <Ui>Prunerr</Ui> and hit install. If you can&apos;t
            find it there, add it manually with this template URL:
          </P>
          <CodeBlock language="url" code={UNRAID_TEMPLATE} />
        </>
      ),
    },
    {
      id: 'first-run',
      title: 'Once it’s running',
      body: (
        <Steps
          steps={[
            <>
              Open <Code>http://your-server:3000</Code>.
            </>,
            <>
              Head to <AppLink to="/settings?section=connections" path={['Settings', 'Connections']} /> and hook up
              your services: your media server, Sonarr/Radarr, and a watch history provider (Tautulli or Tracearr).
              Anything you passed as environment variables is already filled in.
            </>,
            <>
              Go to <AppLink to="/library" path={['Library']} /> and hit <Ui>Sync Library</Ui> to pull everything in.
            </>,
            <>
              Go to <AppLink to="/rules" path={['Rules']} /> and create your first rule.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'api-key',
      title: 'API key',
      body: (
        <P>
          Your API key lives in <AppLink to="/settings?section=system" path={['Settings', 'System', 'API key']} />.
          You&apos;ll need it to call the API from scripts or to add Prunerr to nzb360. Send it in the{' '}
          <Code>X-Api-Key</Code> header.
        </P>
      ),
    },
    {
      id: 'data',
      title: 'Data',
      body: (
        <Callout type="warning" title="Map /app/data somewhere persistent">
          Everything (the SQLite database, your rules and settings) lives in <Code>/app/data</Code> inside the
          container. If it isn&apos;t mapped to a volume you&apos;ll lose your config when the container is recreated.
        </Callout>
      ),
    },
    {
      id: 'updating',
      title: 'Updating',
      body: (
        <List>
          <li>
            <Ui>Docker:</Ui> <Code>docker pull helliott20/prunerr:latest</Code>, then recreate the container.
          </li>
          <li>
            <Ui>Compose:</Ui> <Code>docker compose pull &amp;&amp; docker compose up -d</Code>
          </li>
          <li>
            <Ui>Unraid:</Ui> hit the update button in the Docker tab when it shows up.
          </li>
        </List>
      ),
    },
    {
      id: 'architecture',
      title: 'Supported hardware',
      body: (
        <P>
          Images are built for <Code>amd64</Code> and <Code>arm64</Code>, so Prunerr runs on regular servers,
          Raspberry Pi 4+, Synology and so on. Docker pulls the right one automatically.
        </P>
      ),
    },
  ],
};

const configuration: DocGuide = {
  id: 'configuration',
  title: 'Configuration',
  summary: 'Connect your services and choose where settings live.',
  icon: SlidersHorizontal,
  sections: [
    {
      id: 'config-from-env',
      title: 'Settings or environment variables',
      body: (
        <>
          <P>
            You can set everything up in <AppLink to="/settings" path={['Settings']} />, or pass environment variables
            if you prefer to configure things at the Docker level.
          </P>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-surface-700/60 bg-surface-800/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Default</p>
              <p className="mt-1 font-semibold text-surface-100">Seed once, then the UI owns it</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-surface-400">
                Service variables fill in Settings the first time Prunerr starts. Changing a variable later does
                nothing; edit the connection in Settings instead.
              </p>
            </div>
            <div className="rounded-xl border border-accent-500/30 bg-accent-500/[0.06] p-4">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-accent-text">
                CONFIG_FROM_ENV=true
              </p>
              <p className="mt-1 font-semibold text-surface-100">Your compose file is the source of truth</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-surface-400">
                Every service variable you set is re-applied on each start, and its fields in Settings are locked.
                Services without a variable can still be managed in the UI.
              </p>
            </div>
          </div>
          <EnvTable
            vars={[
              {
                name: 'CONFIG_FROM_ENV',
                description: 'true (or 1) to make service variables override Settings on every start.',
                badge: 'default: off',
              },
            ]}
          />
          <Callout type="note">
            This covers the connection URLs and keys for Plex, Jellyfin/Emby, Sonarr, Radarr, Tautulli, Tracearr,
            Seerr and Unraid. Other variables below are read the same way whatever this is set to.
          </Callout>
        </>
      ),
    },
    {
      id: 'media-server',
      title: 'Media server',
      body: (
        <>
          <P>You need one media server. Plex is the default.</P>
          <EnvTable
            vars={[
              { name: 'MEDIA_SERVER_TYPE', description: 'plex, jellyfin or emby.', badge: 'default: plex' },
              { name: 'PLEX_URL', description: <>Your Plex server URL, e.g. <Code>http://192.168.1.100:32400</Code></> },
              {
                name: 'PLEX_TOKEN',
                description: (
                  <>
                    Your Plex token (
                    <ExternalLink href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/">
                      how to find it
                    </ExternalLink>
                    )
                  </>
                ),
              },
              { name: 'JELLYFIN_URL', description: <>Jellyfin or Emby URL, e.g. <Code>http://192.168.1.100:8096</Code></> },
              { name: 'JELLYFIN_API_KEY', description: 'Jellyfin or Emby API key. Both use the JELLYFIN_* variables.' },
            ]}
          />
        </>
      ),
    },
    {
      id: 'sonarr-radarr',
      title: 'Sonarr & Radarr',
      body: (
        <>
          <P>
            Not strictly required, but you&apos;ll want at least one: it&apos;s how Prunerr actually removes content.
          </P>
          <EnvTable
            vars={[
              { name: 'SONARR_URL', description: 'Sonarr URL' },
              { name: 'SONARR_API_KEY', description: 'Sonarr API key (Settings › General › Security in Sonarr)' },
              { name: 'RADARR_URL', description: 'Radarr URL' },
              { name: 'RADARR_API_KEY', description: 'Radarr API key (Settings › General › Security in Radarr)' },
            ]}
          />
        </>
      ),
    },
    {
      id: 'watch-history',
      title: 'Watch history',
      body: (
        <>
          <P>
            You need <Ui>one</Ui> of these for watch-based rules to work. Without it, Prunerr doesn&apos;t know
            what&apos;s been watched.
          </P>
          <EnvTable
            vars={[
              { name: 'TAUTULLI_URL', description: 'Tautulli URL' },
              { name: 'TAUTULLI_API_KEY', description: 'Tautulli API key (Settings › Web Interface in Tautulli)' },
              { name: 'TRACEARR_URL', description: 'Tracearr URL' },
              { name: 'TRACEARR_API_KEY', description: 'Tracearr API token' },
            ]}
          />
          <P>
            <ExternalLink href="https://github.com/helliott20/tracearr">Tracearr</ExternalLink> is an alternative if you
            don&apos;t run Tautulli. Pick which provider to use under{' '}
            <AppLink to="/settings?section=connections" path={['Settings', 'Connections', 'Watch history']} />.
          </P>
        </>
      ),
    },
    {
      id: 'optional',
      title: 'Optional',
      body: (
        <EnvTable
          vars={[
            { name: 'OVERSEERR_URL', description: 'Overseerr / Seerr URL' },
            { name: 'OVERSEERR_API_KEY', description: 'Overseerr / Seerr API key' },
            { name: 'UNRAID_URL', description: 'Unraid server URL, for disk monitoring' },
            { name: 'UNRAID_API_KEY', description: 'Unraid API key' },
            { name: 'DISCORD_WEBHOOK_URL', description: 'Discord webhook for notifications' },
            { name: 'PRUNERR_API_KEY', description: 'Override the auto-generated API key' },
            { name: 'LOG_LEVEL', description: 'error, warn, info or debug', badge: 'default: info' },
            { name: 'PUID / PGID', description: 'User and group ID for file permissions', badge: 'default: 99 / 100' },
          ]}
        />
      ),
    },
    {
      id: 'service-health',
      title: 'Service health',
      body: (
        <P>
          Once everything&apos;s connected, the <AppLink to="/" path={['Dashboard']} /> shows a{' '}
          <Ui>Service Status</Ui> panel with the connection state and response time of each service. If something&apos;s
          red, check its URL and API key.
        </P>
      ),
    },
  ],
};

const troubleshooting: DocGuide = {
  id: 'troubleshooting',
  title: 'Troubleshooting',
  summary: 'Fixes for the problems people hit most.',
  icon: LifeBuoy,
  sections: [
    {
      id: 'nothing-after-scan',
      title: 'Nothing shows up after scanning',
      body: (
        <P>
          Make sure your Plex URL and token are correct. The token has to belong to the server owner&apos;s account,
          not a shared user. On the <AppLink to="/" path={['Dashboard']} />, Plex should show as connected with a
          green dot under <Ui>Service Status</Ui>.
        </P>
      ),
    },
    {
      id: 'env-var-ignored',
      title: 'Changing an environment variable does nothing',
      body: (
        <P>
          By default, service variables like <Code>SONARR_URL</Code> only fill in Settings the first time Prunerr
          starts. After that, change the connection in{' '}
          <AppLink to="/settings?section=connections" path={['Settings', 'Connections']} />, or set{' '}
          <Code>CONFIG_FROM_ENV=true</Code> so your variables are re-applied on every start. See{' '}
          <DocLink to="config-from-env">Settings or environment variables</DocLink>
          .
        </P>
      ),
    },
    {
      id: 'fields-locked',
      title: 'Settings fields are locked',
      body: (
        <P>
          <Code>CONFIG_FROM_ENV</Code> is on and those fields come from environment variables. Change them in your
          container config and restart, or remove <Code>CONFIG_FROM_ENV</Code> to manage them in the UI again.
        </P>
      ),
    },
    {
      id: 'watch-history-missing',
      title: 'Watch history isn’t working',
      body: (
        <>
          <P>
            You need Tautulli or Tracearr configured. Plex on its own only tracks the server owner&apos;s watches, so
            shared users&apos; history won&apos;t show up without a watch history provider.
          </P>
          <P>
            If you&apos;ve just set up Tautulli, give it time to build its history. Prunerr reads from Tautulli&apos;s
            API, so if Tautulli doesn&apos;t have the data yet, Prunerr won&apos;t either.
          </P>
        </>
      ),
    },
    {
      id: 'rules-not-matching',
      title: 'Rules aren’t matching anything',
      body: (
        <List>
          <li>Is the rule enabled? There&apos;s a toggle on each rule on the Rules page.</li>
          <li>Does the rule&apos;s media type match your content (Movies, TV Shows or All)?</li>
          <li>Run the rule manually and check the preview. It shows exactly what would match.</li>
          <li>For watch-based conditions, make sure your watch history provider is connected.</li>
        </List>
      ),
    },
    {
      id: 'collections-missing',
      title: 'Collections aren’t showing up',
      body: (
        <P>
          Collections come from Radarr, not Plex. Make sure Radarr is connected, then hit <Ui>Sync Collections</Ui> on
          the <AppLink to="/collections" path={['Collections']} /> page. Only movie collections are supported, since
          Sonarr has no concept of collections.
        </P>
      ),
    },
    {
      id: 'unexpected-protection',
      title: 'Items show as protected but I didn’t protect them',
      body: (
        <P>
          They&apos;re probably in a protected collection. The <Ui>Protected</Ui> badge on the item names the
          collection; click it to go there.
        </P>
      ),
    },
    {
      id: 'api-401',
      title: 'API returns 401',
      body: (
        <P>
          Include your API key in the <Code>X-Api-Key</Code> header. You&apos;ll find it in{' '}
          <AppLink to="/settings?section=system" path={['Settings', 'System', 'API key']} />.
        </P>
      ),
    },
    {
      id: 'high-usage',
      title: 'High CPU or memory usage',
      body: (
        <P>
          With a very large library (5,000+ items) the first scan takes a while. Later scans are faster because they
          only look for changes. If it&apos;s consistently slow, check your media server&apos;s response time in the
          Service Status panel.
        </P>
      ),
    },
    {
      id: 'database',
      title: 'Database issues',
      body: (
        <>
          <P>
            The SQLite database is at <Code>/app/data/prunerr.db</Code> inside the container. To start completely
            fresh, stop the container and delete that file; Prunerr recreates it on the next start.
          </P>
          <Callout type="warning">
            Deleting the database loses all your rules, history and settings. Take a backup first from{' '}
            <AppLink to="/settings?section=system" path={['Settings', 'System', 'Backup & restore']} />.
          </Callout>
        </>
      ),
    },
    {
      id: 'getting-help',
      title: 'Getting help',
      body: (
        <>
          <SubHeading>Still stuck?</SubHeading>
          <List>
            <li>
              Unraid forum: <ExternalLink href={FORUM_URL}>Prunerr support thread</ExternalLink>
            </li>
            <li>
              GitHub Issues: <ExternalLink href={ISSUES_URL}>report a bug</ExternalLink>
            </li>
            <li>
              GitHub Discussions: <ExternalLink href={DISCUSSIONS_URL}>ask a question</ExternalLink>
            </li>
          </List>
        </>
      ),
    },
  ],
};

export const DOC_GUIDES: DocGuide[] = [installation, configuration, troubleshooting];
