# Home Assistant Integration

Prunerr integrates with Home Assistant three ways, no custom component required:

1. **Outbound webhooks** — Prunerr POSTs events to HA, which become automation triggers.
2. **REST sensors** — HA pulls live state (free space, pending deletions) from `/api/stats`.
3. **REST commands** — HA triggers a scan via `/api/scan/trigger`.

Together these let HA be your notification layer (TTS on speakers, phone push, dashboard cards) and react to disk-pressure events — reaching people on the devices they actually use.

> **Auth:** All `/api/*` routes accept an `X-Api-Key` header. Find/regenerate the key under **Settings → API Key** in Prunerr. Requests from the web UI bypass the key (same-origin), but HA must always send it. Replace `http://prunerr.local:3000` and `YOUR_API_KEY` below with your values.

---

## 1. Receive Prunerr events (webhooks → automation triggers)

In Prunerr, go to **Settings → Outbound Webhooks → Add webhook** and point it at an HA webhook URL:

```
http://homeassistant.local:8123/api/webhook/prunerr-events
```

Tick the events you care about (e.g. **Disk pressure**, **Deletion complete**). Optionally set a **signing secret** — Prunerr then sends an `X-Prunerr-Signature: sha256=<hmac>` header computed over the exact request body, which you can verify.

### Payload shape

Every webhook POST is a JSON envelope:

```json
{
  "event": "DISK_PRESSURE_TRIGGERED",
  "timestamp": "2026-05-30T03:20:00.000Z",
  "source": "prunerr",
  "version": 1,
  "data": {
    "severity": "soft",
    "path": "/data/media",
    "freeBytes": 850000000000,
    "totalBytes": 12000000000000,
    "targetBytes": 1000000000000,
    "deficitBytes": 150000000000,
    "observeOnly": false,
    "itemsQueued": 1,
    "projectedReclaimBytes": 64000000000,
    "items": [{ "id": 1, "title": "Example Movie", "type": "movie", "sizeBytes": 64000000000 }]
  }
}
```

Also sent as headers: `X-Prunerr-Event: <EVENT_NAME>` and (if a secret is set) `X-Prunerr-Signature`.

### Example automation

```yaml
automation:
  - alias: "Prunerr disk pressure → announce"
    trigger:
      - platform: webhook
        webhook_id: prunerr-events
        allowed_methods: [POST]
        local_only: true
    condition:
      - condition: template
        value_template: "{{ trigger.json.event == 'DISK_PRESSURE_TRIGGERED' }}"
    action:
      - service: notify.mobile_app_my_phone
        data:
          title: "Prunerr: {{ trigger.json.data.severity }} disk pressure"
          message: >
            {{ trigger.json.data.path }} is low.
            {{ trigger.json.data.itemsQueued }} item(s) queued
            (~{{ (trigger.json.data.projectedReclaimBytes / 1024**3) | round(0) }} GB).
```

---

## 2. Pull Prunerr state (REST sensors)

Add to `configuration.yaml`. The disk fields are populated when **Disk Pressure** is enabled with at least one monitored path; otherwise they are `null`.

```yaml
rest:
  - resource: "http://prunerr.local:3000/api/stats"
    scan_interval: 300
    headers:
      X-Api-Key: "YOUR_API_KEY"
    sensor:
      - name: "Prunerr Free Space"
        value_template: "{{ value_json.data.diskFreeBytes | int(0) }}"
        device_class: data_size
        unit_of_measurement: "B"
      - name: "Prunerr Disk Pressure"
        value_template: "{{ value_json.data.diskPressureSeverity | default('ok') }}"
      - name: "Prunerr Pending Deletions"
        value_template: "{{ value_json.data.itemsMarkedForDeletion | int(0) }}"
      - name: "Prunerr Reclaimable Space"
        value_template: "{{ value_json.data.reclaimableSpace | int(0) }}"
        device_class: data_size
        unit_of_measurement: "B"
```

---

## 3. Trigger a scan (REST command)

```yaml
rest_command:
  prunerr_scan:
    url: "http://prunerr.local:3000/api/scan/trigger"
    method: POST
    headers:
      X-Api-Key: "YOUR_API_KEY"
```

`POST /api/scan/trigger` returns **202** when a scan starts and **409** if one is already running — both are normal; HA's `rest_command` treats any 2xx/4xx without raising unless you check the response.

Use it from an automation, e.g. run a scan when free space drops:

```yaml
automation:
  - alias: "Prunerr scan when disk fills"
    trigger:
      - platform: numeric_state
        entity_id: sensor.prunerr_free_space
        below: 1099511627776  # 1 TiB
    action:
      - service: rest_command.prunerr_scan
```

---

## Notes

- Free space is read directly from the filesystem (`statfs`) on the paths configured under **Settings → Disk Pressure**, so it works without Unraid.
- Webhook delivery is fire-and-forget with up to 3 retries on transient failures (5xx / network / 429); it never blocks Prunerr's own processing.
- All byte fields are raw bytes — divide by `1024**3` for GB or `1024**4` for TB in templates.
