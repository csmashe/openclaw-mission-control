# Hello World Plugin

A sample plugin that demonstrates the Mission Control plugin system. Use this as
a starting point for building your own plugins.

## Plugin Structure

Every plugin lives in its own directory under `~/.openclaw/mission-control/plugins/`
and needs two files:

```
plugins/
  my-plugin/
    plugin.json   # Manifest — tells MC about your plugin
    index.js      # Bundle — your pre-built React component
```

The directory name **must** match the `slug` in `plugin.json`.

## Manifest (`plugin.json`)

```json
{
  "name": "Hello World",
  "slug": "hello-world",
  "version": "1.0.0",
  "description": "A sample plugin demonstrating the Mission Control plugin system",
  "author": "Chris Smashe",
  "icon": "puzzle",
  "entry": "index.js"
}
```

| Field         | Required | Description                                                        |
| ------------- | -------- | ------------------------------------------------------------------ |
| `name`        | Yes      | Display name shown in Settings > Plugins and sidebar tooltip       |
| `slug`        | Yes      | Unique identifier — must match the directory name (kebab-case)     |
| `version`     | Yes      | Semver version string                                              |
| `description` | No       | Short description shown in the plugin manager                      |
| `author`      | No       | Author name shown in the plugin manager                            |
| `icon`        | No       | Lucide icon name in kebab-case (defaults to `puzzle`). Browse icons at https://lucide.dev/icons/ |
| `entry`       | Yes      | Path to the JS bundle file, relative to the plugin directory       |

## Bundle (`index.js`)

Plugins are pre-bundled JavaScript files. **Do not import React** — it is
provided by Mission Control via `window.__MC_REACT`. Your bundle registers a
component through `window.__MC_PLUGINS`.

### Pattern

```js
(function(React, mc) {

  // Your component receives a `context` prop
  function MyPlugin({ context }) {
    // context.pluginSlug  — your plugin's slug
    // context.api.get()   — fetch helper (GET)
    // context.api.post()  — fetch helper (POST)
    // context.api.patch() — fetch helper (PATCH)
    // context.api.delete()— fetch helper (DELETE)
    // context.navigate()  — navigate to a view (e.g. "board", "plugin:other-plugin")
    // context.settings    — your plugin's settings (Record<string, string>)

    return React.createElement('div', null, 'Hello from my plugin!');
  }

  // Register — slug must match plugin.json
  mc.register('my-plugin', MyPlugin);

})(window.__MC_REACT, window.__MC_PLUGINS);
```

### Using React hooks

Since React is passed in as a parameter, use `React.useState`, `React.useEffect`,
etc. directly:

```js
var _state = React.useState(null);
var data = _state[0];
var setData = _state[1];

React.useEffect(function() {
  context.api.get('/api/tasks').then(function(res) {
    setData(res.tasks);
  });
}, []);
```

### Styling

Plugins render inside MC's content area and have access to all Tailwind CSS
utility classes. Use `className` on your `React.createElement` calls:

```js
React.createElement('div', { className: 'flex-1 p-6 space-y-4' },
  React.createElement('h2', { className: 'text-2xl font-bold' }, 'Title')
);
```

Theme variables like `text-primary`, `bg-card`, `border-border`, and
`text-muted-foreground` will match MC's current dark/light theme.

## Context API Reference

| Property            | Type                                      | Description                              |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `context.pluginSlug`| `string`                                  | Your plugin's slug                       |
| `context.api.get`   | `(path: string) => Promise<any>`          | GET request to any MC API endpoint       |
| `context.api.post`  | `(path: string, body?) => Promise<any>`   | POST request                             |
| `context.api.patch` | `(path: string, body?) => Promise<any>`   | PATCH request                            |
| `context.api.delete`| `(path: string) => Promise<any>`          | DELETE request                           |
| `context.navigate`  | `(viewId: string) => void`                | Navigate to a view (`"board"`, `"settings"`, `"plugin:slug"`, etc.) |
| `context.settings`  | `Record<string, string>`                  | Plugin-specific settings from the DB     |

## Plugin Settings API

Plugins can store and retrieve key-value settings via the REST API:

```js
// Read settings
context.api.get('/api/plugins/my-plugin/settings')
// => { settings: { "key": "value" } }

// Update settings
context.api.patch('/api/plugins/my-plugin/settings', {
  settings: { "key": "new-value" }
})

// Delete a setting (set to null)
context.api.patch('/api/plugins/my-plugin/settings', {
  settings: { "key": null }
})
```

## Enabling Your Plugin

1. Drop your plugin folder into `~/.openclaw/mission-control/plugins/`
2. Open Mission Control and go to **Settings** (gear icon in sidebar)
3. Click the **Plugins** tab
4. Click the refresh button to rescan the plugins directory
5. Toggle your plugin to **Enabled**
6. Your plugin's icon will appear in the sidebar — click it to open

## Error Handling

If your plugin throws an error, MC catches it with an error boundary and shows
a friendly error screen with a **Retry** button. This prevents a broken plugin
from crashing the entire dashboard.

## Tips

- Keep bundles small — plugins are loaded and evaluated at runtime
- Use `React.createElement` directly since JSX requires a build step
- If you need a build step, use any bundler (esbuild, Rollup, webpack) configured to externalize React
- All MC REST API endpoints are available through `context.api`
- Test your plugin by checking the browser console for errors after enabling
