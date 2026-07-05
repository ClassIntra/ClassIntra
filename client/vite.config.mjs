// Vite 配置（ESM 形式，避免 CJS 加载警告）
// 注意：本文件以 .mjs 扩展名确保 Vite 以 ESM 方式加载
import { defineConfig } from 'vite';
import vue2 from '@vitejs/plugin-vue2';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import postcss from 'postcss';

// ESM 中没有 __dirname，需通过 fileURLToPath 计算
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);

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
      // 缓存破坏：检测版本变更时清除浏览器缓存，但不修改 URL 以保护浏览器历史记录
      var script = '<script>(function(){var k=\'_cv\',s=localStorage.getItem(k),v=\'' + buildHash + '\';if(s&&s!==v){try{if(\'caches\' in window)caches.keys().then(function(n){for(var i=0;i<n.length;i++)caches.delete(n[i]);});}catch(e){}localStorage.setItem(k,v);}else if(!s){localStorage.setItem(k,v);}})();</' + 'script>';
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
    preprocessorOptions: {
      scss: {
        // 使用现代 Sass API，避免 legacy-js-api 弃用警告
        api: 'modern-compiler'
      }
    },
    postcss: {
      plugins: [
        flexGapPolyfillPlugin(),
        webkitPrefixPlugin()
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@apps': path.resolve(__dirname, '../apps'),
      '@shared': path.resolve(__dirname, '../shared/src'),
      // apps/ 目录在 Vite root 之外，显式映射前端 bare imports 到 client/node_modules
      // 后端 bare imports（express 等）由 apps/node_modules junction 指向 server/node_modules 解析
      'marked': path.resolve(__dirname, 'node_modules/marked'),
      'dompurify': path.resolve(__dirname, 'node_modules/dompurify'),
      'highlight.js': path.resolve(__dirname, 'node_modules/highlight.js'),
      'katex': path.resolve(__dirname, 'node_modules/katex'),
      'mermaid': path.resolve(__dirname, 'node_modules/mermaid'),
      'video.js': path.resolve(__dirname, 'node_modules/video.js'),
      'videojs-mobile-ui': path.resolve(__dirname, 'node_modules/videojs-mobile-ui'),
      '@videojs/http-streaming': path.resolve(__dirname, 'node_modules/@videojs/http-streaming'),
      'axios': path.resolve(__dirname, 'node_modules/axios')
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
