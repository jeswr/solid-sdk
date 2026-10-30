<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Vendored fonts

Downloaded from the upstream font projects on 2026-10-30. All files are unmodified
apart from filenames. Each family includes its SIL Open Font License 1.1 in `OFL.txt`.
These full character sets include the Latin and Latin Extended glyphs used by the suite.

Normal styles only: Onest, Inter, Geist and Geist Mono use variable weights 100–900;
Source Serif 4 uses variable weights 200–900 and optical sizes 8–60;
Source Code Pro ships the static 400 and 600 faces.

The package build copies this directory to `dist/font-assets/`, beside `dist/fonts.js`.
The pod manager and issues app reference these workspace assets directly. The standalone
create-solid-app template carries identical Geist files and licences in `app/fonts/`, so
scaffolds do not depend on the workspace layout or an additional package.

## Sources and checksums

- `onest/Onest-Variable.woff2`: [upstream](https://github.com/simpals/onest/releases/download/2.001/onest-2.001.zip), SHA-256 `cb4d777c1b146887a2902ef01ba91cb3fb0c85e9804e95794eb289a1966c0782`.
- `onest/OFL.txt`: [upstream](https://github.com/simpals/onest/releases/download/2.001/onest-2.001.zip), SHA-256 `071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc`.
- `source-serif-4/SourceSerif4-Variable.woff2`: [upstream](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/WOFF2/VAR/SourceSerif4Variable-Roman.ttf.woff2), SHA-256 `940a76eda1388de39d38c8e7a79bf6ea058a387faee0a9f33c8d25c6ba05e1be`.
- `source-serif-4/OFL.txt`: [upstream](https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md), SHA-256 `c21d7293d87b6d7ab1d0229a2f55b77f33a7613a6a4e66f6693d68d7d8d09464`.
- `source-code-pro/SourceCodePro-Regular.woff2`: [upstream](https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/WOFF2/OTF/SourceCodePro-Regular.otf.woff2), SHA-256 `23a0d7981dc90c0a8ec7d8a6ca7ee5dc439c777f3e2aabcf1009fdcf0e821b79`.
- `source-code-pro/SourceCodePro-Semibold.woff2`: [upstream](https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/WOFF2/OTF/SourceCodePro-Semibold.otf.woff2), SHA-256 `ccfcf42d049fb8dc6fbcae3aef276d733f88991593cd3bdf4cbfe97b02eed1bc`.
- `source-code-pro/OFL.txt`: [upstream](https://raw.githubusercontent.com/adobe-fonts/source-code-pro/release/LICENSE.md), SHA-256 `7c940e28a5388e9bba866cf0e408edda45fe0899ba98665b8f6ab31dc5e4b8ff`.
- `inter/Inter-Variable.woff2`: [upstream](https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.woff2), SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`.
- `inter/OFL.txt`: [upstream](https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt), SHA-256 `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a`.
- `geist/Geist-Variable.woff2`: [upstream](https://raw.githubusercontent.com/vercel/geist-font/main/fonts/Geist/webfonts/Geist[wght].woff2), SHA-256 `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1`.
- `geist/OFL.txt`: [upstream](https://raw.githubusercontent.com/vercel/geist-font/main/OFL.txt), SHA-256 `c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90`.
- `geist-mono/GeistMono-Variable.woff2`: [upstream](https://raw.githubusercontent.com/vercel/geist-font/main/fonts/GeistMono/webfonts/GeistMono[wght].woff2), SHA-256 `afaacc4c5fbba89d2ebf7a02dc4070208540874592a5504d57175782fe893101`.
- `geist-mono/OFL.txt`: [upstream](https://raw.githubusercontent.com/vercel/geist-font/main/OFL.txt), SHA-256 `c683bfbcc7e087f5d37a54ef628f10387c451a83ddc459b151403a164ac46c90`.
