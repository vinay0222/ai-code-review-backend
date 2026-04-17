/**
 * Generates `.github/workflows/flutter-build.yml` for CI build automation.
 *
 * User format strings support tokens (replaced in generated bash):
 *   {run} | {run_number}  → run number
 *   {branch}              → ref name (slashes sanitized to hyphens)
 *   {sha}                 → full commit sha
 *   {short_sha}           → first 7 characters of sha
 */

const WORKFLOW_NAME = 'Flutter Build';
const WORKFLOW_FILE = '.github/workflows/flutter-build.yml';

/**
 * Expand user-facing name format into a bash string using env _RN, _REF, _SHA and derived REF_SAFE, _SHA_SHORT.
 */
function expandNameFormat(format, defaultValue) {
  const raw = (format && String(format).trim()) || defaultValue;
  return raw
    .replace(/\{run_number\}/gi, '${_RN}')
    .replace(/\{run\}/gi, '${_RN}')
    .replace(/\{branch\}/gi, '${REF_SAFE}')
    .replace(/\{short_sha\}/gi, '${_SHA_SHORT}')
    .replace(/\{sha\}/gi, '${_SHA}');
}

/**
 * @param {object} opts
 * @param {boolean} [opts.enabled]
 * @param {string[]} [opts.branches]
 * @param {object} [opts.android]
 * @param {string} [opts.android.apk_name_format]
 * @param {object} [opts.windows]
 * @param {boolean} [opts.windows.enabled]
 * @param {string} [opts.windows.exe_name_format]
 */
function generateFlutterBuildWorkflow(opts) {
  const enabled = opts.enabled !== false;
  const branches = Array.isArray(opts.branches) && opts.branches.length
    ? opts.branches.map((b) => String(b).trim()).filter(Boolean)
    : ['main'];

  const apkExpr = expandNameFormat(opts.android?.apk_name_format, 'app-{run}-{branch}');
  const winEnabled = !!(opts.windows && opts.windows.enabled);
  const exeExpr = expandNameFormat(opts.windows?.exe_name_format, 'app-{run}-{branch}');

  const branchYaml = branches.map((b) => `      - ${JSON.stringify(b)}`).join('\n');

  const onBlock = enabled
    ? `on:
  push:
    branches:
${branchYaml}
  workflow_dispatch:`
    : `on:
  workflow_dispatch:`;

  // Use gh* as line-continuation helpers so JS template does not interpret ${APK...}
  const lines = [];

  lines.push(`name: ${WORKFLOW_NAME}`);
  lines.push('');
  lines.push(onBlock);
  lines.push('');
  lines.push('jobs:');

  // ── Android job ──────────────────────────────────────────────────────────
  lines.push(`  build-android:`);
  lines.push(`    name: Build Android APK`);
  lines.push(`    runs-on: ubuntu-latest`);
  lines.push(`    timeout-minutes: 45`);
  lines.push(`    env:`);
  lines.push(`      _RN: \${{ github.run_number }}`);
  lines.push(`      _REF: \${{ github.ref_name }}`);
  lines.push(`      _SHA: \${{ github.sha }}`);
  lines.push(`    steps:`);
  lines.push(`      - name: Checkout`);
  lines.push(`        uses: actions/checkout@v4`);
  lines.push(``);
  lines.push(`      - name: Set up Java`);
  lines.push(`        uses: actions/setup-java@v4`);
  lines.push(`        with:`);
  lines.push(`          distribution: zulu`);
  lines.push(`          java-version: "17"`);
  lines.push(``);
  lines.push(`      - name: Set up Flutter`);
  lines.push(`        uses: subosito/flutter-action@v2`);
  lines.push(`        with:`);
  lines.push(`          channel: stable`);
  lines.push(`          cache: true`);
  lines.push(``);
  lines.push(`      - name: Flutter pub get`);
  lines.push(`        run: flutter pub get`);
  lines.push(``);
  lines.push(`      - name: Decode Android keystore`);
  lines.push(`        env:`);
  lines.push(`          KEYSTORE_BASE64: \${{ secrets.KEYSTORE_BASE64 }}`);
  lines.push(`        run: |`);
  lines.push(`          set -euo pipefail`);
  lines.push(`          test -n "$KEYSTORE_BASE64" || { echo "::error::KEYSTORE_BASE64 secret is not set"; exit 1; }`);
  lines.push(`          mkdir -p android/app`);
  lines.push(`          echo "$KEYSTORE_BASE64" | base64 -d > android/app/upload-keystore.jks`);
  lines.push(``);
  lines.push(`      - name: Build Android APK`);
  lines.push(`        env:`);
  lines.push(`          KEYSTORE_PASSWORD: \${{ secrets.KEYSTORE_PASSWORD }}`);
  lines.push(`          KEY_PASSWORD: \${{ secrets.KEY_PASSWORD }}`);
  lines.push(`          KEY_ALIAS: \${{ secrets.KEY_ALIAS }}`);
  lines.push(`        run: |`);
  lines.push(`          set -euo pipefail`);
  lines.push(`          flutter build apk --release`);
  lines.push(``);
  lines.push(`      - name: Rename APK for artifact`);
  lines.push(`        run: |`);
  lines.push(`          set -euo pipefail`);
  lines.push(`          mkdir -p build/artifacts`);
  lines.push(`          REF_SAFE="\${_REF//\\//-}"`);
  lines.push(`          _SHA_SHORT="\${_SHA:0:7}"`);
  lines.push(`          APK_BASENAME="${apkExpr}"`);
  lines.push(`          SRC="build/app/outputs/flutter-apk/app-release.apk"`);
  lines.push(`          test -f "$SRC" || { echo "::error::Expected APK not found at $SRC"; exit 1; }`);
  lines.push(`          cp "$SRC" "build/artifacts/\${APK_BASENAME}.apk"`);
  lines.push(`          echo "Built \${APK_BASENAME}.apk"`);
  lines.push(``);
  lines.push(`      - name: Upload Android APK`);
  lines.push(`        uses: actions/upload-artifact@v4`);
  lines.push(`        with:`);
  lines.push(`          name: android-apk-\${{ github.run_number }}-\${{ github.ref_name }}`);
  lines.push(`          path: build/artifacts/*.apk`);
  lines.push(`          if-no-files-found: error`);

  if (winEnabled) {
    lines.push(``);
    lines.push(`  build-windows:`);
    lines.push(`    name: Build Windows`);
    lines.push(`    runs-on: windows-latest`);
    lines.push(`    timeout-minutes: 60`);
    lines.push(`    steps:`);
    lines.push(`      - name: Checkout`);
    lines.push(`        uses: actions/checkout@v4`);
    lines.push(``);
    lines.push(`      - name: Set up Flutter`);
    lines.push(`        uses: subosito/flutter-action@v2`);
    lines.push(`        with:`);
    lines.push(`          channel: stable`);
    lines.push(`          cache: true`);
    lines.push(``);
    lines.push(`      - name: Flutter pub get`);
    lines.push(`        run: flutter pub get`);
    lines.push(``);
    lines.push(`      - name: Build Windows release`);
    lines.push(`        run: flutter build windows --release`);
    lines.push(``);
    lines.push(`      - name: Stage Windows EXE`);
    lines.push(`        shell: bash`);
    lines.push(`        env:`);
    lines.push(`          _RN: \${{ github.run_number }}`);
    lines.push(`          _REF: \${{ github.ref_name }}`);
    lines.push(`          _SHA: \${{ github.sha }}`);
    lines.push(`        run: |`);
    lines.push(`          set -euo pipefail`);
    lines.push(`          EXE=$(find build/windows -path "*/runner/Release/*.exe" -type f | head -n1)`);
    lines.push(`          if [ -z "$EXE" ]; then echo "::error::No Release .exe found"; exit 1; fi`);
    lines.push(`          mkdir -p build/artifacts/win`);
    lines.push(`          REF_SAFE="\${_REF//\\//-}"`);
    lines.push(`          _SHA_SHORT="\${_SHA:0:7}"`);
    lines.push(`          OUT_BASENAME="${exeExpr}"`);
    lines.push(`          cp "$EXE" "build/artifacts/win/\${OUT_BASENAME}.exe"`);
    lines.push(``);
    lines.push(`      - name: Upload Windows EXE`);
    lines.push(`        uses: actions/upload-artifact@v4`);
    lines.push(`        with:`);
    lines.push(`          name: windows-exe-\${{ github.run_number }}-\${{ github.ref_name }}`);
    lines.push(`          path: build/artifacts/win/*.exe`);
    lines.push(`          if-no-files-found: error`);
  }

  const yaml = `${lines.join('\n')}\n`;

  return {
    yaml,
    filePath: WORKFLOW_FILE,
    workflowName: WORKFLOW_NAME,
  };
}

module.exports = {
  generateFlutterBuildWorkflow,
  WORKFLOW_FILE,
  WORKFLOW_NAME,
  expandNameFormat,
};
