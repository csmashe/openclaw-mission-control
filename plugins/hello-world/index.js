(function(React, mc) {
  function HelloWorld(_ref) {
    var context = _ref.context;
    var _React$useState = React.useState(null);
    var taskCount = _React$useState[0];
    var setTaskCount = _React$useState[1];

    var _React$useState2 = React.useState(true);
    var loading = _React$useState2[0];
    var setLoading = _React$useState2[1];

    React.useEffect(function() {
      context.api.get('/api/tasks').then(function(data) {
        setTaskCount(data.tasks ? data.tasks.length : 0);
        setLoading(false);
      }).catch(function() {
        setLoading(false);
      });
    }, []);

    return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center p-6 gap-6' },
      React.createElement('div', { className: 'text-center space-y-4' },
        React.createElement('div', { className: 'w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto' },
          React.createElement('span', { className: 'text-3xl' }, '\uD83E\uDDE9')
        ),
        React.createElement('h2', { className: 'text-2xl font-bold' }, 'Hello World Plugin'),
        React.createElement('p', { className: 'text-muted-foreground max-w-md' },
          'This is a sample plugin demonstrating the Mission Control plugin system. ' +
          'Plugins can access MC\'s REST APIs and render custom React components.'
        )
      ),
      React.createElement('div', { className: 'bg-card border border-border rounded-xl p-6 w-full max-w-sm' },
        React.createElement('h3', { className: 'text-sm font-medium text-muted-foreground mb-2' }, 'Task Count'),
        React.createElement('div', { className: 'text-3xl font-bold' },
          loading ? '...' : String(taskCount)
        ),
        React.createElement('p', { className: 'text-xs text-muted-foreground mt-1' },
          'Fetched via context.api.get(\'/api/tasks\')'
        )
      ),
      React.createElement('div', { className: 'bg-card/50 border border-border/50 rounded-xl p-5 w-full max-w-sm text-sm text-muted-foreground' },
        React.createElement('p', { className: 'font-medium text-foreground mb-2' }, 'Plugin Context'),
        React.createElement('pre', { className: 'text-xs font-mono bg-background/50 rounded-lg p-3 overflow-auto' },
          JSON.stringify({ pluginSlug: context.pluginSlug }, null, 2)
        )
      )
    );
  }

  mc.register('hello-world', HelloWorld);
})(window.__MC_REACT, window.__MC_PLUGINS);
