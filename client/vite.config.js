import { defineConfig } from 'vite';
import vue2 from '@vitejs/plugin-vue2';
import path from 'path';
import fs from 'fs';
import postcss from 'postcss';

var versionJsonPath = path.resolve(__dirname, '../server/version.json');
var appVersion = '1.0.0';
var buildHash = '';
try {
  var versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  appVersion = versionData.version || '1.0.0';
  buildHash = versionData.buildHash || '';
} catch (e) {}

function cacheBusterPlugin() {
  return {
    name: 'cache-buster',
    transformIndexHtml: function(html) {
      if (!buildHash) return html;
      var script = '<script>(function(){var k=\'_cv\',s=localStorage.getItem(k),v=\'' + buildHash + '\';if(s&&s!==v){try{if(\'caches\' in window)caches.keys().then(function(n){for(var i=0;i<n.length;i++)caches.delete(n[i]);});}catch(e){}localStorage.setItem(k,v);location.replace(location.href.split(\'?\')[0]+\'?_v=\'+v);}else if(!s){localStorage.setItem(k,v);}})();</' + 'script>';
      return html.replace('<head>', '<head>' + script);
    }
  };
}

// PostCSS plugin: automatic flex gap polyfill for Chrome 80 (flex gap supported since Chrome 84)
// For each rule with display:flex + gap, generates a @supports not (gap: 1px) fallback
// using margin on > * + * children.
function flexGapPolyfillPlugin() {
  return {
    postcssPlugin: 'flex-gap-polyfill',
    Rule: function(rule) {
      // Skip rules inside @supports not (gap: 1px) to prevent recursion
      var parent = rule.parent;
      while (parent) {
        if (parent.type === 'atrule' && parent.name === 'supports' && parent.params.indexOf('not (gap') !== -1) {
          return;
        }
        parent = parent.parent;
      }

      var hasFlex = false;
      var gapValue = null;
      var gapImportant = false;
      var flexDirection = 'row';

      rule.walkDecls(function(decl) {
        if (decl.prop === 'display' && (decl.value === 'flex' || decl.value === 'inline-flex')) {
          hasFlex = true;
        }
        if (decl.prop === 'gap' && decl.value !== 'normal' && decl.value !== '0' && decl.value !== '0px') {
          gapValue = decl.value;
          gapImportant = decl.important;
        }
        if (decl.prop === 'flex-direction') {
          flexDirection = decl.value;
        }
      });

      if (!hasFlex || !gapValue) return;

      // Parse gap value: "10px" or "8px 16px" or "var(--spacing-sm)"
      var parts = gapValue.split(/\s+/);
      var rowGap = parts[0];
      var colGap = parts.length > 1 ? parts[1] : parts[0];

      var marginProp;
      var marginValue;
      if (flexDirection.indexOf('column') === 0) {
        marginProp = flexDirection.indexOf('reverse') !== -1 ? 'margin-bottom' : 'margin-top';
        marginValue = rowGap;
      } else {
        marginProp = flexDirection.indexOf('reverse') !== -1 ? 'margin-right' : 'margin-left';
        marginValue = colGap;
      }

      // Create @supports not (gap: 1px) { selector > * + * { margin: value; } }
      var atRule = postcss.atRule({
        name: 'supports',
        params: 'not (gap: 1px)'
      });
      var newRule = postcss.rule({
        selector: rule.selector + ' > * + *'
      });
      newRule.append(postcss.decl({
        prop: marginProp,
        value: marginValue,
        important: gapImportant
      }));
      atRule.append(newRule);
      rule.parent.insertAfter(rule, atRule);
    }
  };
}
flexGapPolyfillPlugin.postcss = true;

// PostCSS plugin: automatically add -webkit- prefix to user-select for Android WebView compatibility
function webkitPrefixPlugin() {
  return {
    postcssPlugin: 'webkit-prefix',
    Declaration: function(decl) {
      if (decl.prop === 'user-select') {
        // Check if -webkit-user-select already exists in the same rule
        var exists = false;
        decl.parent.walkDecls('-webkit-user-select', function() {
          exists = true;
        });
        if (!exists) {
          decl.cloneBefore({
            prop: '-webkit-user-select',
            value: decl.value,
            important: decl.important
          });
        }
      }
    }
  };
}
webkitPrefixPlugin.postcss = true;

export default defineConfig({
  plugins: [
    vue2(),
    cacheBusterPlugin()
  ],
  define: {
    '__APP_VERSION__': JSON.stringify(appVersion)
  },
  css: {
    postcss: {
      plugins: [
        flexGapPolyfillPlugin(),
        webkitPrefixPlugin()
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5001,
    proxy: {
      '/api': {
        target: 'http://localhost:9001',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000
      },
      '/ws': {
        target: 'ws://localhost:10001',
        ws: true
      },
      '/resources': {
        target: 'http://localhost:9001',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'chrome80',
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'vuex'],
          'vendor-utils': ['axios'],
          'vendor-markdown': ['marked'],
          'vendor-katex': ['katex'],
          'vendor-mermaid': ['mermaid'],
          'vendor-vhs': ['@videojs/http-streaming'],
          'vendor-purify': ['dompurify']
        }
      }
    },
    chunkSizeWarningLimit: 1500
  }
});
