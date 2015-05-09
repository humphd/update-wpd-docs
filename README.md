update-wpd-docs [![Dependency Status](https://david-dm.org/MarcelGerber/update-wpd-docs.svg)](https://david-dm.org/MarcelGerber/update-wpd-docs)
===============

Creates a comprehensive JSON file of selected [WebPlatform Docs](https://docs.webplatform.org) data, mostly for offline use.

# Installation
```
[sudo] npm install
```

# Usage
```
[sudo] node update-wpd-docs --output <path to output json> [--lowercase-keys] [--exclude-vendor-prefixed] [--path <comma-separated list of paths>]
```

# Config
You can create a `config.json` file with the keys `output`, `paths`, `lowercase-keys` and `vendor-prefixes`. You can also define aliases in there and use them like this:
```
[sudo] node update-wpd-docs <alias>
```
[Example `config.json`](https://github.com/MarcelGerber/update-wpd-docs/blob/brackets-config/config.json)
