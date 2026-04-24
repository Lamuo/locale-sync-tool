#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const LOCALES_RELATIVE_PATH = path.join("public", "i18n", "locales");
const DEFAULT_REFERENCE_LOCALES = ["en"];
const DEFAULT_PLACEHOLDER = "TO BE TRANSLATED";
const DEFAULT_SORT_REFERENCES = true;
const DEFAULT_DELETE_MODE = false;
const FORMAT_MODE_FLAT = "flat";
const FORMAT_MODE_OBJECT = "object";
const OBJECT_VALUE_KEY = "__value";
const DEFAULT_FORMAT_MODE = FORMAT_MODE_OBJECT;
const DEFAULT_CONFIG_FILE = "sync-locales.config.json";
const DEFAULT_PAUSE_ON_EXIT = Boolean(process.pkg);
const NAMED_ANSI_COLORS = Object.freeze({
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  grey: "\x1b[90m",
  orange: "\x1b[38;5;208m",
});
const DEFAULT_UI_COLORS = Object.freeze({
  theme: "orange",
  deleteModeTheme: "red",
});
let uiColors = {
  ...DEFAULT_UI_COLORS,
};
let activeAccentColor = DEFAULT_UI_COLORS.theme;

class ObjectFormatConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ObjectFormatConflictError";
  }
}

function compareAlphabetical(left, right) {
  return left.localeCompare(right, "en");
}

function parseFormatMode(rawValue, optionName = "--format") {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized !== FORMAT_MODE_FLAT && normalized !== FORMAT_MODE_OBJECT) {
    throw new Error(
      `The ${optionName} option must be '${FORMAT_MODE_FLAT}' or '${FORMAT_MODE_OBJECT}'.`,
    );
  }

  return normalized;
}

function parseArgs(argv) {
  const options = {
    baseDir: null,
    referenceLocales: DEFAULT_REFERENCE_LOCALES,
    refsProvided: false,
    placeholder: DEFAULT_PLACEHOLDER,
    dryRun: false,
    sortReferences: DEFAULT_SORT_REFERENCES,
    deleteMode: DEFAULT_DELETE_MODE,
    formatMode: DEFAULT_FORMAT_MODE,
    configPath: null,
    pauseOnExit: DEFAULT_PAUSE_ON_EXIT,
  };

  for (const arg of argv) {
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        continue;
      case "--sort-refs":
        options.sortReferences = true;
        continue;
      case "--no-sort-refs":
        options.sortReferences = false;
        continue;
      case "--delete-mode":
        options.deleteMode = true;
        continue;
      case "--safe-mode":
        options.deleteMode = false;
        continue;
      case "--flat-format":
        options.formatMode = FORMAT_MODE_FLAT;
        continue;
      case "--object-format":
        options.formatMode = FORMAT_MODE_OBJECT;
        continue;
      case "--pause":
        options.pauseOnExit = true;
        continue;
      case "--no-pause":
        options.pauseOnExit = false;
        continue;
      default:
        break;
    }

    if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length).trim();
      if (!value) {
        throw new Error("The --base option requires a value.");
      }
      options.baseDir = path.resolve(process.cwd(), value);
      continue;
    }

    if (arg.startsWith("--refs=")) {
      const value = arg.slice("--refs=".length);
      const refs = value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (refs.length === 0) {
        throw new Error("The --refs option requires at least one locale code.");
      }

      options.referenceLocales = refs;
      options.refsProvided = true;
      continue;
    }

    if (arg.startsWith("--placeholder=")) {
      options.placeholder = arg.slice("--placeholder=".length);
      continue;
    }

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      options.formatMode = parseFormatMode(value);
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length).trim();
      if (!value) {
        throw new Error("The --config option requires a value.");
      }
      options.configPath = path.resolve(process.cwd(), value);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readJsonObject(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Expected a JSON object in ${filePath}`);
  }

  return parsed;
}

function resolveConfigPath(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
    if (!fs.statSync(explicitPath).isFile()) {
      throw new Error(`Config path is not a file: ${explicitPath}`);
    }
    return explicitPath;
  }

  const candidates = [
    path.resolve(process.cwd(), DEFAULT_CONFIG_FILE),
    path.resolve(path.dirname(process.execPath), DEFAULT_CONFIG_FILE),
    path.resolve(__dirname, DEFAULT_CONFIG_FILE),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function normalizeConfiguredColor(value, settingName, configPath) {
  if (value === null || value === false) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(
      `Invalid color for ui.colors.${settingName} in ${configPath}: expected string, null or false.`,
    );
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return null;
  }

  if (!resolveAnsiColorOpen(normalized)) {
    throw new Error(
      `Invalid color "${value}" for ui.colors.${settingName} in ${configPath}. Use a named color, #RRGGBB, ansi:<0-255>, or none.`,
    );
  }

  return normalized;
}

function applyUiColorsFromConfig(configPathOption) {
  const configPath = resolveConfigPath(configPathOption);
  if (!configPath) {
    return;
  }

  const config = readJsonObject(configPath);
  if (!Object.prototype.hasOwnProperty.call(config, "ui")) {
    return;
  }

  const ui = config.ui;
  if (!isPlainObject(ui)) {
    throw new Error(`Invalid config in ${configPath}: "ui" must be an object.`);
  }

  if (!Object.prototype.hasOwnProperty.call(ui, "colors")) {
    return;
  }

  const colors = ui.colors;
  if (!isPlainObject(colors)) {
    throw new Error(
      `Invalid config in ${configPath}: "ui.colors" must be an object.`,
    );
  }

  const nextColors = {
    ...uiColors,
  };

  if (Object.prototype.hasOwnProperty.call(colors, "theme")) {
    nextColors.theme = normalizeConfiguredColor(
      colors.theme,
      "theme",
      configPath,
    );
  }

  if (Object.prototype.hasOwnProperty.call(colors, "deleteModeTheme")) {
    nextColors.deleteModeTheme = normalizeConfiguredColor(
      colors.deleteModeTheme,
      "deleteModeTheme",
      configPath,
    );
  }

  uiColors = nextColors;
  activeAccentColor = uiColors.theme;
}

function sortObjectKeys(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort(compareAlphabetical);

  for (const key of keys) {
    sorted[key] = obj[key];
  }

  return sorted;
}

function isPlainObject(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function splitKeyIntoSegments(key, contextLabel) {
  const segments = key.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid key "${key}" in ${contextLabel}.`);
  }

  return segments;
}

function addFlatEntry(flatEntries, flatKey, value, contextLabel) {
  if (Object.prototype.hasOwnProperty.call(flatEntries, flatKey)) {
    throw new Error(`Duplicate key "${flatKey}" found in ${contextLabel}.`);
  }

  flatEntries[flatKey] = value;
}

function flattenJsonToFlatEntries(
  obj,
  contextLabel,
  parentSegments = [],
  result = {},
) {
  for (const [rawKey, value] of Object.entries(obj)) {
    const segments = splitKeyIntoSegments(rawKey, contextLabel);
    const nextSegments = parentSegments.concat(segments);

    if (isPlainObject(value)) {
      flattenJsonToFlatEntries(value, contextLabel, nextSegments, result);
      continue;
    }

    addFlatEntry(result, nextSegments.join("."), value, contextLabel);
  }

  return result;
}

function sortObjectKeysDeep(value) {
  if (!isPlainObject(value)) {
    return value;
  }

  const sorted = {};
  const keys = Object.keys(value).sort(compareAlphabetical);
  for (const key of keys) {
    sorted[key] = sortObjectKeysDeep(value[key]);
  }

  return sorted;
}

function convertFlatEntriesToObject(flatEntries, contextLabel) {
  const flatKeys = Object.keys(flatEntries);
  const flatKeySet = new Set(flatKeys);
  for (const flatKey of flatKeys) {
    const reservedKeyPath = `${flatKey}.${OBJECT_VALUE_KEY}`;
    if (flatKeySet.has(reservedKeyPath)) {
      throw new ObjectFormatConflictError(
        `Cannot auto-move key "${flatKey}" in ${contextLabel} because "${reservedKeyPath}" already exists.`,
      );
    }
  }

  const nested = {};

  for (const [flatKey, value] of Object.entries(flatEntries)) {
    const segments = splitKeyIntoSegments(flatKey, contextLabel);
    let cursor = nested;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
          cursor[segment] = value;
          continue;
        }

        const existing = cursor[segment];
        if (isPlainObject(existing)) {
          if (
            Object.prototype.hasOwnProperty.call(existing, OBJECT_VALUE_KEY)
          ) {
            throw new ObjectFormatConflictError(
              `Cannot preserve key "${flatKey}" in ${contextLabel} because "${segments
                .slice(0, i + 1)
                .join(".")}.${OBJECT_VALUE_KEY}" is already defined.`,
            );
          }

          existing[OBJECT_VALUE_KEY] = value;
          continue;
        }

        cursor[segment] = value;
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
        cursor[segment] = {};
      } else if (!isPlainObject(cursor[segment])) {
        const existingValue = cursor[segment];
        cursor[segment] = {
          [OBJECT_VALUE_KEY]: existingValue,
        };
      }

      cursor = cursor[segment];
    }
  }

  return sortObjectKeysDeep(nested);
}

function detectFileEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function hasTrailingEol(text) {
  return text.endsWith("\r\n") || text.endsWith("\n");
}

function stringifyJsonWithFormatting(obj, eol, keepTrailingEol) {
  const jsonWithLf = JSON.stringify(obj, null, 2);
  const normalizedJson =
    eol === "\n" ? jsonWithLf : jsonWithLf.replace(/\n/g, eol);
  return keepTrailingEol ? `${normalizedJson}${eol}` : normalizedJson;
}

function toNormalizedLineArray(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function countChangedLines(beforeText, afterText) {
  const beforeLines = toNormalizedLineArray(beforeText);
  const afterLines = toNormalizedLineArray(afterText);
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  let changed = 0;
  for (let i = 0; i < maxLines; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      changed += 1;
    }
  }

  return changed;
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getLocaleDirs(baseDir) {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareAlphabetical);
}

function findLocalesDirFrom(startDir) {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, LOCALES_RELATIVE_PATH);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

function resolveBaseDir(baseDir) {
  if (baseDir) {
    if (!fs.existsSync(baseDir)) {
      throw new Error(`Locales directory not found: ${baseDir}`);
    }
    return baseDir;
  }

  const searchRoots = [
    process.cwd(),
    path.dirname(process.execPath),
    __dirname,
  ];
  const seen = new Set();

  for (const root of searchRoots) {
    const normalizedRoot = path.resolve(root);
    if (seen.has(normalizedRoot)) {
      continue;
    }
    seen.add(normalizedRoot);

    const found = findLocalesDirFrom(normalizedRoot);
    if (found) {
      return found;
    }
  }

  throw new Error(
    `Locales directory not found. Looked for ${LOCALES_RELATIVE_PATH} from: ${Array.from(seen).join("; ")}. Use --base=<path>.`,
  );
}

function waitForExitKeyPress() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Press Enter to close...", () => {
      rl.close();
      resolve();
    });
  });
}

async function maybePauseBeforeExit(pauseOnExit) {
  if (!pauseOnExit) {
    return;
  }

  await waitForExitKeyPress();
}

function moveCursorUp(lines) {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}A`);
  }
}

function moveCursorDown(lines) {
  if (lines > 0) {
    process.stdout.write(`\x1b[${lines}B`);
  }
}

function clearCurrentLine() {
  process.stdout.write("\x1b[2K\r");
}

function clearScreen() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write("\x1b[2J\x1b[0f");
}

function hideTerminalCursor() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write("\x1b[?25l");
}

function showTerminalCursor() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write("\x1b[?25h");
}

function resolveAnsiColorOpen(colorValue) {
  if (!colorValue || typeof colorValue !== "string") {
    return "";
  }

  if (Object.prototype.hasOwnProperty.call(NAMED_ANSI_COLORS, colorValue)) {
    return NAMED_ANSI_COLORS[colorValue];
  }

  const hexMatch = colorValue.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `\x1b[38;2;${red};${green};${blue}m`;
  }

  const ansiMatch = colorValue.match(/^ansi:(\d{1,3})$/i);
  if (ansiMatch) {
    const code = Number.parseInt(ansiMatch[1], 10);
    if (code >= 0 && code <= 255) {
      return `\x1b[38;5;${code}m`;
    }
  }

  return "";
}

function colorText(text, colorValue) {
  if (!process.stdout.isTTY || !colorValue) {
    return text;
  }

  const openCode = resolveAnsiColorOpen(colorValue);
  if (!openCode) {
    return text;
  }

  return `${openCode}${text}\x1b[0m`;
}

function getCurrentAccentColor() {
  return activeAccentColor || uiColors.theme;
}

function setAccentColorForMode(isDeleteModeActive) {
  activeAccentColor = isDeleteModeActive
    ? uiColors.deleteModeTheme
    : uiColors.theme;
}

function colorDeleteModeLabel(text) {
  return colorText(text, uiColors.deleteModeTheme);
}

function colorMenuTitle(text) {
  return colorText(text, getCurrentAccentColor());
}

function withSelectedSuffix(baseLabel, isSelected, colorizeBase = null) {
  const label = colorizeBase ? colorizeBase(baseLabel) : baseLabel;
  if (!isSelected) {
    return label;
  }

  return `${label} ${colorText("(selected)", getCurrentAccentColor())}`;
}

function getOptionPrefix(isSelected) {
  return isSelected ? colorText("> ", getCurrentAccentColor()) : "  ";
}

function isSelectableOption(option) {
  return Boolean(option && option.type !== "separator");
}

function findFirstSelectableOptionIndex(options) {
  return options.findIndex((option) => isSelectableOption(option));
}

function findNextSelectableOptionIndex(options, currentIndex, direction) {
  let index = currentIndex;

  for (let i = 0; i < options.length; i += 1) {
    index = (index + direction + options.length) % options.length;
    if (isSelectableOption(options[index])) {
      return index;
    }
  }

  return currentIndex;
}

function resolvePromptOptions(optionsOrFactory) {
  const resolved =
    typeof optionsOrFactory === "function"
      ? optionsOrFactory()
      : optionsOrFactory;

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new Error("Menu requires at least one option.");
  }

  return resolved;
}

function normalizeSelectedIndex(options, preferredIndex) {
  if (
    Number.isInteger(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < options.length &&
    isSelectableOption(options[preferredIndex])
  ) {
    return preferredIndex;
  }

  const firstSelectableIndex = findFirstSelectableOptionIndex(options);
  if (firstSelectableIndex < 0) {
    throw new Error("Menu requires at least one selectable option.");
  }

  return firstSelectableIndex;
}

function renderOptionLine(option, isSelected) {
  if (!isSelectableOption(option)) {
    return "";
  }

  const prefix = getOptionPrefix(isSelected);
  return `${prefix}${option.label}`;
}

function renderOptions(options, selectedIndex) {
  for (let i = 0; i < options.length; i += 1) {
    process.stdout.write(
      `${renderOptionLine(options[i], i === selectedIndex)}\n`,
    );
  }
}

function rerenderOptions(previousLineCount, options, selectedIndex) {
  moveCursorUp(previousLineCount);

  const linesToRender = Math.max(previousLineCount, options.length);
  for (let i = 0; i < linesToRender; i += 1) {
    clearCurrentLine();
    if (i < options.length) {
      process.stdout.write(
        `${renderOptionLine(options[i], i === selectedIndex)}\n`,
      );
    } else {
      process.stdout.write("\n");
    }
  }
}

function stripAnsiCodes(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function getVisibleLength(text) {
  return stripAnsiCodes(text).length;
}

function rewriteOptionLineAt(
  optionsLength,
  lineIndex,
  nextLine,
  previousLine = "",
) {
  if (lineIndex < 0 || lineIndex >= optionsLength) {
    return;
  }

  const linesUp = optionsLength - lineIndex;
  moveCursorUp(linesUp);
  process.stdout.write("\r");
  process.stdout.write(nextLine);

  const previousVisibleLength = getVisibleLength(previousLine);
  const nextVisibleLength = getVisibleLength(nextLine);
  if (previousVisibleLength > nextVisibleLength) {
    process.stdout.write(" ".repeat(previousVisibleLength - nextVisibleLength));
  }

  process.stdout.write("\r");
  moveCursorDown(linesUp);
  process.stdout.write("\r");
}

function rewriteMenuTitleLineAt(
  optionsLength,
  nextTitleLine,
  previousTitleLine = "",
) {
  const linesUp = optionsLength + 1;
  moveCursorUp(linesUp);
  process.stdout.write("\r");
  process.stdout.write(nextTitleLine);

  const previousVisibleLength = getVisibleLength(previousTitleLine);
  const nextVisibleLength = getVisibleLength(nextTitleLine);
  if (previousVisibleLength > nextVisibleLength) {
    process.stdout.write(" ".repeat(previousVisibleLength - nextVisibleLength));
  }

  process.stdout.write("\r");
  moveCursorDown(linesUp);
  process.stdout.write("\r");
}

function rewriteOptionPrefixAt(optionsLength, lineIndex, isSelected) {
  if (lineIndex < 0 || lineIndex >= optionsLength) {
    return;
  }

  const linesUp = optionsLength - lineIndex;
  moveCursorUp(linesUp);
  process.stdout.write(getOptionPrefix(isSelected));
  process.stdout.write("\r");
  moveCursorDown(linesUp);
}

function rerenderSelectionOnly(
  optionsLength,
  previousSelectedIndex,
  selectedIndex,
) {
  rewriteOptionPrefixAt(optionsLength, previousSelectedIndex, false);
  if (selectedIndex !== previousSelectedIndex) {
    rewriteOptionPrefixAt(optionsLength, selectedIndex, true);
  }
}

function rerenderChangedOptionLinesOnly(
  previousOptions,
  previousSelectedIndex,
  nextOptions,
  nextSelectedIndex,
) {
  if (previousOptions.length !== nextOptions.length) {
    return false;
  }

  const optionsLength = nextOptions.length;
  for (let i = 0; i < optionsLength; i += 1) {
    const previousLine = renderOptionLine(
      previousOptions[i],
      i === previousSelectedIndex,
    );
    const nextLine = renderOptionLine(nextOptions[i], i === nextSelectedIndex);
    if (previousLine !== nextLine) {
      rewriteOptionLineAt(optionsLength, i, nextLine, previousLine);
    }
  }

  return true;
}

async function promptSingleSelect(title, optionsOrFactory, config = {}) {
  const onSubmit =
    typeof config.onSubmit === "function" ? config.onSubmit : null;

  return new Promise((resolve) => {
    let options = resolvePromptOptions(optionsOrFactory);
    let selectedIndex = normalizeSelectedIndex(
      options,
      config.initialSelectedIndex,
    );
    let renderedOptionLines = options.length;
    let renderedTitleLine = colorMenuTitle(title);

    const rerender = (preferredSelectedIndex = selectedIndex) => {
      const previousLineCount = renderedOptionLines;
      options = resolvePromptOptions(optionsOrFactory);
      selectedIndex = normalizeSelectedIndex(options, preferredSelectedIndex);
      rerenderOptions(previousLineCount, options, selectedIndex);
      renderedOptionLines = options.length;
    };

    const cleanup = () => {
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      showTerminalCursor();
    };

    const onData = (chunk) => {
      const key = chunk.toString("utf8");

      if (key === "\u0003") {
        cleanup();
        process.exit(1);
      }

      if (key === "\r" || key === "\n") {
        const chosenOption = options[selectedIndex];

        if (onSubmit) {
          const submitResult = onSubmit({
            value: chosenOption.value,
            option: chosenOption,
            selectedIndex,
          });

          if (submitResult && submitResult.continue) {
            const nextSelectedIndex = Number.isInteger(
              submitResult.selectedIndex,
            )
              ? submitResult.selectedIndex
              : selectedIndex;
            const previousOptions = options;
            const previousSelectedIndex = selectedIndex;
            const nextOptions = resolvePromptOptions(optionsOrFactory);
            const normalizedNextSelectedIndex = normalizeSelectedIndex(
              nextOptions,
              nextSelectedIndex,
            );
            const nextTitleLine = colorMenuTitle(title);

            if (renderedTitleLine !== nextTitleLine) {
              rewriteMenuTitleLineAt(
                previousOptions.length,
                nextTitleLine,
                renderedTitleLine,
              );
              renderedTitleLine = nextTitleLine;
            }

            const changedOnly = rerenderChangedOptionLinesOnly(
              previousOptions,
              previousSelectedIndex,
              nextOptions,
              normalizedNextSelectedIndex,
            );
            if (!changedOnly) {
              rerender(nextSelectedIndex);
            } else {
              options = nextOptions;
              selectedIndex = normalizedNextSelectedIndex;
              renderedOptionLines = nextOptions.length;
            }
            return;
          }
        }

        cleanup();
        resolve({
          value: chosenOption.value,
          selectedIndex,
        });
        return;
      }

      if (key === "\u001b[A") {
        const previousSelectedIndex = selectedIndex;
        selectedIndex = findNextSelectableOptionIndex(
          options,
          selectedIndex,
          -1,
        );
        rerenderSelectionOnly(
          options.length,
          previousSelectedIndex,
          selectedIndex,
        );
        return;
      }

      if (key === "\u001b[B") {
        const previousSelectedIndex = selectedIndex;
        selectedIndex = findNextSelectableOptionIndex(
          options,
          selectedIndex,
          1,
        );
        rerenderSelectionOnly(
          options.length,
          previousSelectedIndex,
          selectedIndex,
        );
      }
    };

    hideTerminalCursor();
    process.stdout.write(`${renderedTitleLine}\n`);
    renderOptions(options, selectedIndex);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function printSelectionSummary(referenceLocale, deleteMode, formatMode) {
  process.stdout.write(`Selected reference locale: ${referenceLocale}\n`);
  process.stdout.write(
    `Selected mode: ${deleteMode ? "delete mode" : "safe mode"}\n`,
  );
  process.stdout.write(`Selected format: ${formatMode} format\n`);
}

async function selectReferenceLocaleInteractive(
  baseDir,
  initialDeleteMode = DEFAULT_DELETE_MODE,
  initialFormatMode = DEFAULT_FORMAT_MODE,
) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const localeDirs = getLocaleDirs(baseDir);
  const otherMenuLocales = localeDirs
    .filter((locale) => locale !== "it" && locale !== "en")
    .sort(compareAlphabetical);
  let deleteMode = initialDeleteMode;
  let formatMode = initialFormatMode;
  let mainSelectedIndex = 0;
  setAccentColorForMode(deleteMode);

  const buildMainOptions = () => [
    { label: "it", value: { type: "locale", locale: "it" } },
    { label: "en", value: { type: "locale", locale: "en" } },
    {
      label: "other languages",
      value: { type: "menu", action: "other_languages" },
    },
    { type: "separator" },
    {
      label: withSelectedSuffix(
        "object format",
        formatMode === FORMAT_MODE_OBJECT,
      ),
      value: { type: "menu", action: "set_object_format" },
    },
    {
      label: withSelectedSuffix("flat format", formatMode === FORMAT_MODE_FLAT),
      value: { type: "menu", action: "set_flat_format" },
    },

    { type: "separator" },
    {
      label: withSelectedSuffix("safe mode", !deleteMode),
      value: { type: "menu", action: "set_safe_mode" },
    },
    {
      label: withSelectedSuffix(
        "delete mode",
        deleteMode,
        colorDeleteModeLabel,
      ),
      value: { type: "menu", action: "set_delete_mode" },
    },
  ];

  while (true) {
    const mainSelection = await promptSingleSelect(
      "Select reference locale, mode and format (Use arrows and Enter):",
      buildMainOptions,
      {
        initialSelectedIndex: mainSelectedIndex,
        onSubmit: ({ value, selectedIndex }) => {
          switch (value.action) {
            case "set_safe_mode":
              deleteMode = false;
              setAccentColorForMode(deleteMode);
              break;
            case "set_delete_mode":
              deleteMode = true;
              setAccentColorForMode(deleteMode);
              break;
            case "set_flat_format":
              formatMode = FORMAT_MODE_FLAT;
              break;
            case "set_object_format":
              formatMode = FORMAT_MODE_OBJECT;
              break;
            default:
              return null;
          }

          mainSelectedIndex = selectedIndex;
          return { continue: true, selectedIndex };
        },
      },
    );
    const mainChoice = mainSelection.value;
    mainSelectedIndex = mainSelection.selectedIndex;

    if (mainChoice.type === "locale") {
      printSelectionSummary(mainChoice.locale, deleteMode, formatMode);
      return {
        referenceLocale: mainChoice.locale,
        deleteMode,
        formatMode,
      };
    }

    clearScreen();

    const otherOptions = otherMenuLocales.map((locale) => ({
      label: locale,
      value: locale,
    }));
    otherOptions.push({ type: "separator" });
    otherOptions.push({ label: "go back", value: "__back__" });

    const otherSelection = await promptSingleSelect(
      "Select one of the other available languages (Use arrows and Enter):",
      otherOptions,
    );
    const otherChoice = otherSelection.value;

    if (otherChoice !== "__back__") {
      printSelectionSummary(otherChoice, deleteMode, formatMode);
      return {
        referenceLocale: otherChoice,
        deleteMode,
        formatMode,
      };
    }

    clearScreen();
  }
}

function runSync(options) {
  const localeDirs = getLocaleDirs(options.baseDir);

  if (localeDirs.length === 0) {
    throw new Error(`No locale folders found in ${options.baseDir}`);
  }

  for (const ref of options.referenceLocales) {
    if (!localeDirs.includes(ref)) {
      throw new Error(
        `Reference locale folder not found: ${path.join(options.baseDir, ref)}`,
      );
    }
  }

  const referenceSet = new Set(options.referenceLocales);
  const targetLocales = localeDirs.filter(
    (locale) => !referenceSet.has(locale),
  );

  if (targetLocales.length === 0 && !options.sortReferences) {
    throw new Error("No target locales found after excluding references.");
  }

  const fileSet = new Set();
  for (const ref of options.referenceLocales) {
    const refDir = path.join(options.baseDir, ref);
    const refFiles = fs
      .readdirSync(refDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);

    for (const fileName of refFiles) {
      fileSet.add(fileName);
    }
  }

  const files = Array.from(fileSet).sort(compareAlphabetical);
  if (files.length === 0) {
    throw new Error("No JSON files found in reference locale folders.");
  }

  const localesToProcess = options.sortReferences ? localeDirs : targetLocales;

  let filesWritten = 0;
  let totalMissingAdded = 0;
  let totalExtraRemoved = 0;
  let objectFormatFallbackFiles = 0;
  let sortOnlyFilesChanged = 0;
  let sortOnlyLinesChanged = 0;

  for (const fileName of files) {
    const referenceKeys = new Set();

    for (const ref of options.referenceLocales) {
      const refPath = path.join(options.baseDir, ref, fileName);
      if (!fs.existsSync(refPath)) {
        continue;
      }

      const refJson = readJsonObject(refPath);
      const refFlatEntries = flattenJsonToFlatEntries(refJson, refPath);
      for (const key of Object.keys(refFlatEntries)) {
        referenceKeys.add(key);
      }
    }

    const orderedReferenceKeys =
      Array.from(referenceKeys).sort(compareAlphabetical);

    for (const locale of localesToProcess) {
      const localeDir = path.join(options.baseDir, locale);
      const localePath = path.join(localeDir, fileName);
      const fileExists = fs.existsSync(localePath);
      const originalText = fileExists
        ? fs.readFileSync(localePath, "utf8")
        : "";
      const currentJson = fileExists ? readJsonObject(localePath) : {};
      const currentFlatEntries = fileExists
        ? flattenJsonToFlatEntries(currentJson, localePath)
        : {};
      const fileEol = fileExists ? detectFileEol(originalText) : "\n";
      const keepTrailingEol = fileExists ? hasTrailingEol(originalText) : true;

      let missingAdded = 0;
      let extraRemoved = 0;
      let objectFormatFallbackReason = null;

      if (!referenceSet.has(locale)) {
        if (options.deleteMode) {
          for (const key of Object.keys(currentFlatEntries)) {
            if (!referenceKeys.has(key)) {
              delete currentFlatEntries[key];
              extraRemoved += 1;
            }
          }
        }

        for (const key of orderedReferenceKeys) {
          if (!Object.prototype.hasOwnProperty.call(currentFlatEntries, key)) {
            currentFlatEntries[key] = options.placeholder;
            missingAdded += 1;
          }
        }
      }

      let sortedJson = null;
      if (options.formatMode === FORMAT_MODE_OBJECT) {
        try {
          sortedJson = convertFlatEntriesToObject(
            currentFlatEntries,
            localePath,
          );
        } catch (error) {
          if (error instanceof ObjectFormatConflictError) {
            objectFormatFallbackReason = error.message;
            objectFormatFallbackFiles += 1;
            sortedJson = sortObjectKeys(currentFlatEntries);
          } else {
            throw error;
          }
        }
      } else {
        sortedJson = sortObjectKeys(currentFlatEntries);
      }

      if (objectFormatFallbackReason) {
        console.warn(
          `Object format skipped for ${path.relative(process.cwd(), localePath)}: ${objectFormatFallbackReason}`,
        );
      }
      const nextText = stringifyJsonWithFormatting(
        sortedJson,
        fileEol,
        keepTrailingEol,
      );

      if (nextText !== originalText) {
        if (!options.dryRun) {
          ensureDirectoryExists(localeDir);
          fs.writeFileSync(localePath, nextText, "utf8");
        }

        filesWritten += 1;
        totalMissingAdded += missingAdded;
        totalExtraRemoved += extraRemoved;
        if (missingAdded === 0 && extraRemoved === 0) {
          sortOnlyFilesChanged += 1;
          sortOnlyLinesChanged += countChangedLines(originalText, nextText);
        }

        const action = options.dryRun ? "would update" : "updated";
        console.log(
          `${action} ${path.relative(process.cwd(), localePath)} (missing added: ${missingAdded}, extra removed: ${extraRemoved})`,
        );
      }
    }
  }

  const modeLabel = options.dryRun ? "Dry run completed" : "Sync completed";
  console.log(
    `${modeLabel} (${options.deleteMode ? "delete mode" : "safe mode"}, ${options.formatMode} format). Files changed: ${filesWritten}, missing keys added: ${totalMissingAdded}, extra keys removed: ${totalExtraRemoved}, object-format fallbacks: ${objectFormatFallbackFiles}, sort-only lines changed: ${sortOnlyLinesChanged} (files: ${sortOnlyFilesChanged}).`,
  );
}

async function run() {
  let options = null;

  try {
    options = parseArgs(process.argv.slice(2));
    applyUiColorsFromConfig(options.configPath);
    options.baseDir = resolveBaseDir(options.baseDir);

    if (!options.refsProvided) {
      const selected = await selectReferenceLocaleInteractive(
        options.baseDir,
        options.deleteMode,
        options.formatMode,
      );
      if (selected) {
        options.referenceLocales = [selected.referenceLocale];
        options.deleteMode = selected.deleteMode;
        options.formatMode = selected.formatMode;
      }
    }

    runSync(options);
    await maybePauseBeforeExit(options.pauseOnExit);
  } catch (error) {
    console.error(error.message);
    const pauseOnExit = options ? options.pauseOnExit : DEFAULT_PAUSE_ON_EXIT;
    await maybePauseBeforeExit(pauseOnExit);
    process.exit(1);
  }
}

run();
