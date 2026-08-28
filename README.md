# HA Tools Panel — retired

> [!IMPORTANT]
> The legacy all-in-one panel is retired. It is archived and must not be used as the source for new HACS submissions or releases.

Version 4.0 replaces the dynamic monolith loader with an isolated migration notice. It no longer loads the bundled historical card copies, polls for registrations, or fetches runtime libraries from a CDN.

## Migration

1. Remove the `ha-tools-panel.js` resource and `panel_custom` entry from Home Assistant.
2. Install only the individual HA Tools you use from the maintained repositories under [MacSiem](https://github.com/MacSiem).
3. Refresh the browser after updating dashboard resources.

The old individual JavaScript files remain in the repository only as historical source. They are not loaded by the current entrypoint and should not be published separately.

## Why it changed

The monolith duplicated many tools and allowed those copies to drift away from their tested split repositories. Independent packages provide clearer permissions, lifecycle ownership, release history, and HACS validation.

## License

MIT — see [LICENSE](LICENSE).
