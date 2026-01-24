#!/bin/sh
# ============================================
# Prunerr - Docker Entrypoint Script
# ============================================
# Handles PUID/PGID user management for proper file permissions
# Unraid default: PUID=99, PGID=100

set -e

# Default to Unraid standard user/group IDs
PUID=${PUID:-99}
PGID=${PGID:-100}

echo "---------------------------------------------"
echo "Prunerr Container Startup"
echo "---------------------------------------------"
echo "Setting up user with UID=$PUID and GID=$PGID"

# Get current prunerr user/group IDs
CURRENT_UID=$(id -u prunerr 2>/dev/null || echo "")
CURRENT_GID=$(id -g prunerr 2>/dev/null || echo "")

# Check if we need to modify the user/group
if [ -n "$CURRENT_UID" ]; then
    # User exists, check if modification is needed
    if [ "$CURRENT_UID" != "$PUID" ] || [ "$CURRENT_GID" != "$PGID" ]; then
        echo "Modifying prunerr user: UID $CURRENT_UID -> $PUID, GID $CURRENT_GID -> $PGID"

        # Modify group ID first if different
        if [ "$CURRENT_GID" != "$PGID" ]; then
            # Delete existing group and recreate with new GID
            delgroup prunerr 2>/dev/null || true
            addgroup -g "$PGID" -S prunerr
        fi

        # Modify user ID if different
        if [ "$CURRENT_UID" != "$PUID" ]; then
            # Delete and recreate user with new UID
            deluser prunerr 2>/dev/null || true
            adduser -S prunerr -u "$PUID" -G prunerr -h /app -s /bin/sh
        fi
    else
        echo "User prunerr already has correct UID/GID"
    fi
else
    # User doesn't exist, create it
    echo "Creating prunerr user with UID=$PUID, GID=$PGID"
    addgroup -g "$PGID" -S prunerr 2>/dev/null || true
    adduser -S prunerr -u "$PUID" -G prunerr -h /app -s /bin/sh 2>/dev/null || true
fi

# Ensure data directory exists and has correct ownership
echo "Setting ownership of /app/data to prunerr:prunerr"
mkdir -p /app/data
chown -R prunerr:prunerr /app/data

# Also ensure the app directory is owned by prunerr
chown prunerr:prunerr /app

echo "---------------------------------------------"
echo "Starting Prunerr as user: $(id prunerr)"
echo "---------------------------------------------"

# Execute the main application as the prunerr user
# Using su-exec for clean process handoff (no zombie processes)
exec su-exec prunerr node dist/index.js
