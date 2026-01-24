#!/bin/sh
# ============================================
# Prunerr - Docker Entrypoint Script
# ============================================
# Handles PUID/PGID user management for proper file permissions
# Unraid default: PUID=99, PGID=100

# Don't exit on error - we'll handle errors ourselves
set +e

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

# Function to setup user/group
setup_user() {
    # Remove existing user if present
    if id prunerr >/dev/null 2>&1; then
        deluser prunerr 2>/dev/null || true
    fi

    # Remove existing group if present
    if getent group prunerr >/dev/null 2>&1; then
        delgroup prunerr 2>/dev/null || true
    fi

    # Create group with desired GID (or use existing group with that GID)
    if ! getent group "$PGID" >/dev/null 2>&1; then
        addgroup -g "$PGID" -S prunerr
    fi

    # Get the group name for the GID
    GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

    # Create user with desired UID
    adduser -S -u "$PUID" -G "$GROUP_NAME" -h /app -s /bin/sh prunerr 2>/dev/null || true
}

# Check if we need to modify the user/group
if [ -n "$CURRENT_UID" ]; then
    if [ "$CURRENT_UID" != "$PUID" ] || [ "$CURRENT_GID" != "$PGID" ]; then
        echo "Modifying prunerr user: UID $CURRENT_UID -> $PUID, GID $CURRENT_GID -> $PGID"
        setup_user
    else
        echo "User prunerr already has correct UID/GID"
    fi
else
    echo "Creating prunerr user with UID=$PUID, GID=$PGID"
    setup_user
fi

# Ensure data directory exists and has correct ownership
echo "Setting ownership of /app/data"
mkdir -p /app/data
chown -R "$PUID:$PGID" /app/data

# Also ensure the app directory is accessible
chown "$PUID:$PGID" /app

echo "---------------------------------------------"
echo "Starting Prunerr as UID=$PUID GID=$PGID"
echo "---------------------------------------------"

# Exit on error from here
set -e

# Execute the main application as the prunerr user
# Using su-exec for clean process handoff (no zombie processes)
exec su-exec "$PUID:$PGID" node dist/index.js
