const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');

// MV3 bundle: one entry per context. ts-loader compiles with tsconfig.build.json (which
// flips off the typecheck-only `noEmit`). The popup is loaded as an ES module
// (<script type="module">); the others are classic content/worker scripts.
module.exports = {
  mode: 'production',
  devtool: 'source-map',
  // Extension bundles load from disk, not the network; the web-oriented 244 KiB hint does not
  // apply. Keep a ceiling so an accidental heavy dependency still warns.
  performance: { maxAssetSize: 512 * 1024, maxEntrypointSize: 512 * 1024 },
  entry: {
    'background/service-worker': './src/background/service-worker.ts',
    'popup/popup': './src/popup/popup.ts',
    'sidepanel/sidepanel': './src/sidepanel/sidepanel.ts',
    'content/content-script': './src/content/content-script.ts',
    'inject/fetch-patch': './src/inject/fetch-patch.ts',
    'inject/inject': './src/inject/inject.ts',
    'consent/consent': './src/consent/consent.ts',
    'formfill/preview': './src/formfill/preview.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { configFile: 'tsconfig.build.json' },
        },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/manifest.json', to: 'manifest.json' },
        { from: 'src/shared/suite-tokens.css', to: 'shared/suite-tokens.css' },
        { from: 'src/shared/fonts', to: 'shared/fonts' },
        { from: 'src/shared/account-surface.css', to: 'shared/account-surface.css' },
        { from: 'src/shared/permission-surface.css', to: 'shared/permission-surface.css' },
        { from: 'src/popup/popup.html', to: 'popup/popup.html' },
        { from: 'src/popup/popup.css', to: 'popup/popup.css' },
        { from: 'src/popup/profiles.css', to: 'popup/profiles.css' },
        { from: 'src/sidepanel/sidepanel.html', to: 'sidepanel/sidepanel.html' },
        { from: 'src/sidepanel/sidepanel.css', to: 'sidepanel/sidepanel.css' },
        { from: 'src/sidepanel/grants.css', to: 'sidepanel/grants.css' },
        { from: 'src/consent/consent.html', to: 'consent/consent.html' },
        { from: 'src/consent/consent.css', to: 'consent/consent.css' },
        { from: 'src/formfill/preview.html', to: 'formfill/preview.html' },
        { from: 'src/formfill/preview.css', to: 'formfill/preview.css' },
        { from: 'src/icons', to: 'icons' },
        // Generated from client-id-template.ts and the manifest's pinned public key.
        { from: 'public/clientid.jsonld', to: 'clientid.jsonld' },
      ],
    }),
  ],
};
