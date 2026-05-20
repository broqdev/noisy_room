import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  FileJson,
  FolderOpen,
  Filter,
  PanelRight,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { ensureOpenAiEuphony } from "./openaiEuphony";
import "./styles.css";

type JsonObject = Record<string, unknown>;

type JsonRecord = {
  id: string;
  index: number;
  line: number | null;
  value: unknown;
  title: string;
  subtitle: string;
  preview: string;
};

type ParsedState =
  | {
      status: "ready";
      sourceKind: "json" | "jsonl";
      records: JsonRecord[];
      conversation: Conversation | null;
    }
  | {
      status: "empty";
      sourceKind: null;
      records: [];
      conversation: null;
    }
  | {
      status: "error";
      sourceKind: null;
      records: [];
      conversation: null;
      message: string;
    };

type Message = {
  id?: string | null;
  role: string;
  content: string | Array<Record<string, unknown>>;
  name?: string | null;
  metadata?: JsonObject;
  channel?: string | null;
  recipient?: string | null;
  create_time?: number | null;
};

type Conversation = {
  id?: string | null;
  messages: Message[];
  metadata?: JsonObject;
  create_time?: number | null;
};

type EuphonyEntry = {
  index: number;
  message: Message;
  payload: unknown;
  recordId: string | null;
  recordIndex: number | null;
  recordLine: number | null;
};

type EuphonyEntryDraft = Omit<EuphonyEntry, "index">;

type VirtualScrollTarget = {
  index: number;
  requestId: number;
};

type EuphonyScrollTarget = VirtualScrollTarget;

type GlobalSearchTask = {
  id: string;
  query: string;
  status: "queued" | "running" | "complete" | "error";
  createdAt: string;
  completedAt: string | null;
  root: string | null;
  error: string | null;
  matches: GlobalSearchMatch[];
  scannedFiles: number;
  scannedLines: number;
};

type GlobalSearchTaskSummary = Omit<GlobalSearchTask, "matches"> & {
  matchCount: number;
};

type GlobalSearchMatch = {
  file: CodexSessionFile;
  line: number | null;
  preview: string;
};

type EuphonyConversationElement = HTMLElement & {
  conversationData?: Conversation;
  conversationString?: string;
  allChildrenUpdateComplete?: () => Promise<unknown>;
  collapseBlockContents?: () => void;
  expandBlockContents?: () => void;
  updateComplete?: Promise<unknown>;
};

type EuphonyInlineCollapseBlock = {
  button: HTMLElement;
  container: HTMLElement;
  labelTextElement: HTMLElement | null;
  path: string;
};

type CachedInputState = {
  input: string;
  selectedSessionPath: string | null;
  restored: boolean;
  skippedLargeContent: boolean;
};

type StoredInputCache = {
  version: 1;
  input?: string;
  inputLength: number;
  selectedSessionPath: string | null;
  updatedAt: number;
};

type CodexSessionFile = {
  path: string;
  relativePath: string;
  displayPath: string;
  modifiedAt: string;
  size: number;
  lineCount: number | null;
  threadId: string | null;
  parentThreadId: string | null;
  agentNickname: string | null;
  agentRole: string | null;
};

type CodexSessionsState =
  | {
      status: "loading";
      root: null;
      files: [];
      message: null;
    }
  | {
      status: "ready";
      root: string;
      files: CodexSessionFile[];
      message: null;
    }
  | {
      status: "error";
      root: null;
      files: [];
      message: string;
    };

const MAX_TEXTAREA_CHARS = 120_000;
const CODEX_FILES_PAGE_SIZE = 25;
const RECORDS_PAGE_SIZE = 50;
const EUPHONY_PAGE_SIZE = 25;
const MANUAL_INPUT_STORAGE_SCOPE = "manual-input";
const INPUT_CACHE_STORAGE_KEY = "noisy-room.input.cache";
const INPUT_CACHE_MAX_CHARS = 1_000_000;
const EUPHONY_FEED_WINDOW_SIZE = 18;
const EUPHONY_FEED_OVERSCAN = 5;
const EUPHONY_FEED_ESTIMATED_ENTRY_HEIGHT = 340;
const SESSION_LIST_ESTIMATED_ROW_HEIGHT = 72;
const RECORD_LIST_ESTIMATED_ROW_HEIGHT = 78;
const SEARCH_TEXT_CHAR_LIMIT = 4_000;
const CODEX_TOP_LEVEL_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "turn_context",
  "compacted",
]);
const CODEX_RESPONSE_ITEM_TYPES = new Set([
  "message",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "reasoning",
]);
const CODEX_EVENT_MSG_TYPES = new Set([
  "user_message",
  "agent_message",
  "agent_reasoning",
  "context_compacted",
  "turn_aborted",
  "token_count",
  "tool_result",
]);

function App() {
  const [cachedInput] = useState(readCachedInput);
  const [input, setInput] = useState(cachedInput.input);
  const [query, setQuery] = useState("");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [viewerFilterQuery, setViewerFilterQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locationPath, setLocationPath] = useState(() => window.location.pathname);
  const [activeFileSourceTab, setActiveFileSourceTab] = useState<
    "codex" | "custom"
  >(cachedInput.input && !cachedInput.selectedSessionPath ? "custom" : "codex");
  const [activeInspectorTab, setActiveInspectorTab] = useState<
    "input" | "records"
  >(cachedInput.input ? "records" : "input");
  const [activeViewerTab, setActiveViewerTab] = useState<"euphony" | "payload">(
    "euphony",
  );
  const [sessionPageIndex, setSessionPageIndex] = useState(() =>
    readStoredNumber(sessionPageStorageKey(), 0),
  );
  const [recordPageIndex, setRecordPageIndex] = useState(() =>
    readStoredNumber(recordPageStorageKey(null), 0),
  );
  const [preferredRecordIndex, setPreferredRecordIndex] = useState(() =>
    readStoredNumber(recordIndexStorageKey(null), 0),
  );
  const [euphonyEntryIndex, setEuphonyEntryIndex] = useState(() =>
    readStoredNumber(euphonyEntryIndexStorageKey(null), 0),
  );
  const [copiedSessionPath, setCopiedSessionPath] = useState<string | null>(null);
  const [activeDrop, setActiveDrop] = useState(false);
  const [openingCustomFile, setOpeningCustomFile] = useState(false);
  const [customFileMessage, setCustomFileMessage] = useState<string | null>(
    null,
  );
  const [sessionQuery, setSessionQuery] = useState("");
  const [viewerRecordId, setViewerRecordId] = useState<string | null>(null);
  const [selectedSessionPath, setSelectedSessionPath] = useState<string | null>(
    cachedInput.selectedSessionPath,
  );
  const [loadingSessionPath, setLoadingSessionPath] = useState<string | null>(
    null,
  );
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [copiedViewerTab, setCopiedViewerTab] = useState<
    "euphony" | "payload" | null
  >(null);
  const [euphonyScrollTarget, setEuphonyScrollTarget] =
    useState<EuphonyScrollTarget | null>(null);
  const [recordScrollTarget, setRecordScrollTarget] =
    useState<VirtualScrollTarget | null>(null);
  const [sessionScrollTarget, setSessionScrollTarget] =
    useState<VirtualScrollTarget | null>(null);
  const [sessionsState, setSessionsState] = useState<CodexSessionsState>({
    status: "loading",
    root: null,
    files: [],
    message: null,
  });
  const rawJsonRef = useRef<HTMLPreElement | null>(null);
  const hasRunInputCacheEffectRef = useRef(false);
  const recordRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingRecordFocusIdRef = useRef<string | null>(null);

  const parsed = useMemo(() => parseInput(input), [input]);
  const records = parsed.status === "ready" ? parsed.records : [];
  const inputPreview = useMemo(() => createInputPreview(input), [input]);

  const refreshSessions = async () => {
    setSessionsState({
      status: "loading",
      root: null,
      files: [],
      message: null,
    });

    try {
      const response = await fetch("/api/codex-sessions");
      if (!response.ok) {
        throw new Error(`Codex scan failed with ${response.status}.`);
      }

      const data = (await response.json()) as {
        root: string;
        files: CodexSessionFile[];
      };
      setSessionsState({
        status: "ready",
        root: data.root,
        files: data.files,
        message: null,
      });
    } catch (error) {
      setSessionsState({
        status: "error",
        root: null,
        files: [],
        message:
          error instanceof Error ? error.message : "Unable to scan sessions.",
      });
    }
  };

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setLocationPath(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (
        !hasRunInputCacheEffectRef.current &&
        !input &&
        cachedInput.skippedLargeContent
      ) {
        hasRunInputCacheEffectRef.current = true;
        return;
      }

      hasRunInputCacheEffectRef.current = true;
      writeCachedInput(input, selectedSessionPath);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [input, selectedSessionPath]);

  useEffect(() => {
    if (records.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !records.some((record) => record.id === selectedId)) {
      const nextRecordIndex = clampNumber(
        preferredRecordIndex,
        0,
        records.length - 1,
      );
      setSelectedId(records[nextRecordIndex].id);
    }
  }, [records, selectedId, preferredRecordIndex]);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return records;
    }

    return records.filter((record) =>
      `${record.title} ${record.subtitle} ${record.preview}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [records, query]);

  const recordPageCount = Math.max(
    1,
    Math.ceil(filteredRecords.length / RECORDS_PAGE_SIZE),
  );
  const currentRecordPageIndex = clampNumber(
    recordPageIndex,
    0,
    recordPageCount - 1,
  );

  const recordPageStart =
    filteredRecords.length === 0
      ? 0
      : currentRecordPageIndex * RECORDS_PAGE_SIZE + 1;
  const recordPageEnd = Math.min(
    filteredRecords.length,
    (currentRecordPageIndex + 1) * RECORDS_PAGE_SIZE,
  );

  useEffect(() => {
    if (recordPageIndex !== currentRecordPageIndex) {
      setRecordPageIndex(currentRecordPageIndex);
    }
  }, [currentRecordPageIndex, recordPageIndex]);

  useEffect(() => {
    writeStoredNumber(
      recordPageStorageKey(selectedSessionPath),
      currentRecordPageIndex,
    );
  }, [currentRecordPageIndex, selectedSessionPath]);

  useEffect(() => {
    writeStoredNumber(
      recordIndexStorageKey(selectedSessionPath),
      preferredRecordIndex,
    );
  }, [preferredRecordIndex, selectedSessionPath]);

  const filteredSessions = useMemo(() => {
    if (sessionsState.status !== "ready") {
      return [];
    }

    const normalizedQuery = sessionQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return sessionsState.files;
    }

    return sessionsState.files.filter((file) =>
      `${file.relativePath} ${file.displayPath} ${file.threadId ?? ""} ${
        file.parentThreadId ?? ""
      } ${file.agentNickname ?? ""} ${file.agentRole ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [sessionQuery, sessionsState]);

  const sessionByThreadId = useMemo(() => {
    const sessions =
      sessionsState.status === "ready" ? sessionsState.files : [];
    return new Map(
      sessions.flatMap((file) => (file.threadId ? [[file.threadId, file]] : [])),
    );
  }, [sessionsState]);

  const childSessionsByThreadId = useMemo(() => {
    const children = new Map<string, CodexSessionFile[]>();
    const sessions =
      sessionsState.status === "ready" ? sessionsState.files : [];

    for (const file of sessions) {
      if (!file.parentThreadId) {
        continue;
      }

      const siblings = children.get(file.parentThreadId) ?? [];
      siblings.push(file);
      children.set(file.parentThreadId, siblings);
    }

    return children;
  }, [sessionsState]);

  const sessionPageCount = Math.max(
    1,
    Math.ceil(filteredSessions.length / CODEX_FILES_PAGE_SIZE),
  );
  const currentSessionPageIndex = clampNumber(
    sessionPageIndex,
    0,
    sessionPageCount - 1,
  );
  const sessionPageStart =
    filteredSessions.length === 0
      ? 0
      : currentSessionPageIndex * CODEX_FILES_PAGE_SIZE + 1;
  const sessionPageEnd = Math.min(
    filteredSessions.length,
    (currentSessionPageIndex + 1) * CODEX_FILES_PAGE_SIZE,
  );

  useEffect(() => {
    if (sessionPageIndex !== currentSessionPageIndex) {
      setSessionPageIndex(currentSessionPageIndex);
    }
  }, [currentSessionPageIndex, sessionPageIndex]);

  useEffect(() => {
    writeStoredNumber(sessionPageStorageKey(), currentSessionPageIndex);
  }, [currentSessionPageIndex]);

  const selectedRecord =
    records.find((record) => record.id === selectedId) ?? records[0] ?? null;
  const selectedSession =
    sessionsState.status === "ready"
      ? sessionsState.files.find((file) => file.path === selectedSessionPath)
      : null;
  const selectedRecordFilteredIndex = selectedRecord
    ? filteredRecords.findIndex((record) => record.id === selectedRecord.id)
    : -1;
  const recordFocusIndex =
    selectedRecordFilteredIndex >= 0
      ? selectedRecordFilteredIndex
      : Math.max(
          0,
          Math.min(
            filteredRecords.length - 1,
            currentRecordPageIndex * RECORDS_PAGE_SIZE,
          ),
        );
  const selectedSessionFilteredIndex = selectedSessionPath
    ? filteredSessions.findIndex((file) => file.path === selectedSessionPath)
    : -1;
  const sessionFocusIndex =
    selectedSessionFilteredIndex >= 0
      ? selectedSessionFilteredIndex
      : Math.max(
          0,
          Math.min(
            filteredSessions.length - 1,
            currentSessionPageIndex * CODEX_FILES_PAGE_SIZE,
          ),
        );

  const selectedConversation = useMemo(() => {
    if (parsed.status !== "ready") {
      return null;
    }

    if (parsed.conversation) {
      return parsed.conversation;
    }

    return normalizeConversation(selectedRecord?.value);
  }, [parsed, selectedRecord]);

  const euphonyEntries = useMemo(
    () => createEuphonyEntries(records, selectedConversation),
    [records, selectedConversation],
  );
  const euphonyEntryCount = euphonyEntries.length;
  const currentEuphonyEntryIndex = clampNumber(
    euphonyEntryIndex,
    0,
    Math.max(0, euphonyEntryCount - 1),
  );
  const viewerRecord = viewerRecordId
    ? records.find((record) => record.id === viewerRecordId) ?? null
    : null;
  const currentEuphonyEntry = viewerRecordId
    ? null
    : euphonyEntries[currentEuphonyEntryIndex] ?? null;
  const normalizedViewerFilterQuery = viewerFilterQuery.trim().toLowerCase();
  const filteredEuphonyEntries = useMemo(
    () =>
      normalizedViewerFilterQuery
        ? euphonyEntries.filter((entry) =>
            createEuphonyEntrySearchText(entry).includes(
              normalizedViewerFilterQuery,
            ),
          )
        : euphonyEntries,
    [euphonyEntries, normalizedViewerFilterQuery],
  );
  const filteredEuphonyEntryCount = filteredEuphonyEntries.length;
  const currentFilteredEuphonyPosition = Math.max(
    0,
    filteredEuphonyEntries.findIndex(
      (entry) => entry.index === currentEuphonyEntryIndex,
    ),
  );
  const currentEuphonyPageIndex =
    filteredEuphonyEntryCount > 0
      ? Math.floor(currentFilteredEuphonyPosition / EUPHONY_PAGE_SIZE)
      : 0;
  const euphonyPageCount = Math.max(
    1,
    Math.ceil(filteredEuphonyEntryCount / EUPHONY_PAGE_SIZE),
  );
  const euphonyPageStart =
    filteredEuphonyEntryCount === 0
      ? 0
      : currentEuphonyPageIndex * EUPHONY_PAGE_SIZE + 1;
  const euphonyPageEnd = Math.min(
    filteredEuphonyEntryCount,
    (currentEuphonyPageIndex + 1) * EUPHONY_PAGE_SIZE,
  );
  const canSelectPreviousEuphonyEntry = currentFilteredEuphonyPosition > 0;
  const canSelectNextEuphonyEntry =
    filteredEuphonyEntryCount > 0 &&
    currentFilteredEuphonyPosition < filteredEuphonyEntryCount - 1;

  const selectedRaw = useMemo(
    () =>
      currentEuphonyEntry
        ? stringifyRecordPreview(currentEuphonyEntry.payload)
        : viewerRecord
          ? stringifyRecordPreview(viewerRecord.value)
        : selectedRecord
          ? stringifyRecordPreview(selectedRecord.value)
          : "",
    [currentEuphonyEntry, selectedRecord, viewerRecord],
  );
  const viewerCopyText =
    activeViewerTab === "payload"
      ? selectedRaw
      : currentEuphonyEntry
        ? createEuphonyEntryCopyText(currentEuphonyEntry)
        : "";

  const requestEuphonyFeedScroll = useCallback((index: number) => {
    setEuphonyScrollTarget((currentTarget) => ({
      index,
      requestId: (currentTarget?.requestId ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (euphonyEntryIndex !== currentEuphonyEntryIndex) {
      setEuphonyEntryIndex(currentEuphonyEntryIndex);
    }
  }, [currentEuphonyEntryIndex, euphonyEntryIndex]);

  useEffect(() => {
    if (
      viewerRecordId ||
      filteredEuphonyEntryCount === 0 ||
      filteredEuphonyEntries.some((entry) => entry.index === currentEuphonyEntryIndex)
    ) {
      return;
    }

    const nextIndex = filteredEuphonyEntries[0].index;
    setEuphonyEntryIndex(nextIndex);
    requestEuphonyFeedScroll(nextIndex);
  }, [
    currentEuphonyEntryIndex,
    filteredEuphonyEntries,
    filteredEuphonyEntryCount,
    requestEuphonyFeedScroll,
    viewerRecordId,
  ]);

  useEffect(() => {
    writeStoredNumber(
      euphonyEntryIndexStorageKey(selectedSessionPath),
      currentEuphonyEntryIndex,
    );
  }, [currentEuphonyEntryIndex, selectedSessionPath]);

  useEffect(() => {
    if (viewerRecordId && !records.some((record) => record.id === viewerRecordId)) {
      setViewerRecordId(null);
    }
  }, [records, viewerRecordId]);

  const revealRecordInRecordsPane = useCallback(
    (record: JsonRecord) => {
      setSelectedId(record.id);
      setPreferredRecordIndex(record.index);
      pendingRecordFocusIdRef.current = record.id;
      setActiveInspectorTab("records");

      const filteredRecordIndex = filteredRecords.findIndex(
        (candidate) => candidate.id === record.id,
      );
      if (filteredRecordIndex >= 0) {
        setRecordPageIndex(Math.floor(filteredRecordIndex / RECORDS_PAGE_SIZE));
        setRecordScrollTarget((currentTarget) => ({
          index: filteredRecordIndex,
          requestId: (currentTarget?.requestId ?? 0) + 1,
        }));
        return;
      }

      if (query.trim()) {
        setQuery("");
      }
      setRecordPageIndex(Math.floor(record.index / RECORDS_PAGE_SIZE));
      setRecordScrollTarget((currentTarget) => ({
        index: record.index,
        requestId: (currentTarget?.requestId ?? 0) + 1,
      }));
    },
    [filteredRecords, query],
  );

  const focusRecordForEuphonyEntry = useCallback(
    (entry: EuphonyEntry | null) => {
      if (!entry?.recordId) {
        return;
      }

      const sourceRecord = records.find((record) => record.id === entry.recordId);
      if (!sourceRecord) {
        return;
      }

      revealRecordInRecordsPane(sourceRecord);
    },
    [records, revealRecordInRecordsPane],
  );

  useEffect(() => {
    if (viewerRecordId) {
      return;
    }

    focusRecordForEuphonyEntry(currentEuphonyEntry);
  }, [currentEuphonyEntry, focusRecordForEuphonyEntry, viewerRecordId]);

  useEffect(() => {
    if (activeInspectorTab !== "records") {
      return;
    }

    const focusId = pendingRecordFocusIdRef.current;
    if (!focusId) {
      return;
    }

    const recordRow = recordRowRefs.current.get(focusId);
    if (!recordRow) {
      return;
    }

    pendingRecordFocusIdRef.current = null;
    recordRow.focus({ preventScroll: true });
    recordRow.scrollIntoView({ block: "nearest" });
  }, [
    activeInspectorTab,
    currentRecordPageIndex,
    filteredRecords,
    recordScrollTarget,
    selectedId,
  ]);

  useEffect(() => {
    const rawJson = rawJsonRef.current;
    if (!rawJson) {
      return;
    }

    rawJson.scrollTop = 0;
    rawJson.scrollLeft = 0;
  }, [activeViewerTab, selectedRaw]);

  const restoreStoredRecordState = (scope: string | null) => {
    setRecordPageIndex(readStoredNumber(recordPageStorageKey(scope), 0));
    setPreferredRecordIndex(readStoredNumber(recordIndexStorageKey(scope), 0));
    setEuphonyEntryIndex(readStoredNumber(euphonyEntryIndexStorageKey(scope), 0));
    setViewerRecordId(null);
    setSelectedId(null);
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setInput(text);
    setActiveFileSourceTab("custom");
    setCustomFileMessage(`Loaded ${file.name}.`);
    setSelectedSessionPath(null);
    restoreStoredRecordState(null);
    setActiveInspectorTab("records");
  };

  const handleOpenCustomFile = async () => {
    if (openingCustomFile) {
      return;
    }

    setOpeningCustomFile(true);
    setCustomFileMessage(null);

    try {
      const response = await fetch("/api/custom-file/open", {
        method: "POST",
      });
      const data = (await response.json()) as unknown;

      if (!response.ok) {
        const message = isJsonObject(data)
          ? getString(data.error) ?? "Unable to open file."
          : "Unable to open file.";
        throw new Error(message);
      }

      if (isJsonObject(data) && data.canceled === true) {
        setCustomFileMessage("Open canceled.");
        return;
      }

      if (!isJsonObject(data)) {
        throw new Error("Open file response was invalid.");
      }

      if (typeof data.content !== "string") {
        throw new Error("Open file response did not include file content.");
      }

      const file = isJsonObject(data.file) ? data.file : null;
      const displayPath =
        getString(file?.displayPath) ?? getString(file?.path) ?? "custom file";

      setInput(data.content);
      setActiveFileSourceTab("custom");
      setCustomFileMessage(`Loaded ${displayPath}.`);
      setSelectedSessionPath(null);
      restoreStoredRecordState(null);
      setActiveInspectorTab("records");
    } catch (error) {
      setCustomFileMessage(
        error instanceof Error ? error.message : "Unable to open file.",
      );
    } finally {
      setOpeningCustomFile(false);
    }
  };

  const handleRecordPageChange = (nextPageIndex: number) => {
    const nextPage = clampNumber(nextPageIndex, 0, recordPageCount - 1);
    setRecordPageIndex(nextPage);
    setRecordScrollTarget((currentTarget) => ({
      index: Math.max(
        0,
        Math.min(filteredRecords.length - 1, nextPage * RECORDS_PAGE_SIZE),
      ),
      requestId: (currentTarget?.requestId ?? 0) + 1,
    }));
  };

  const handleSessionPageChange = (nextPageIndex: number) => {
    const nextPage = clampNumber(nextPageIndex, 0, sessionPageCount - 1);
    setSessionPageIndex(nextPage);
    setSessionScrollTarget((currentTarget) => ({
      index: Math.max(
        0,
        Math.min(filteredSessions.length - 1, nextPage * CODEX_FILES_PAGE_SIZE),
      ),
      requestId: (currentTarget?.requestId ?? 0) + 1,
    }));
  };

  const handleCurrentEuphonyEntryChange = useCallback(
    (nextIndex: number) => {
      setViewerRecordId(null);
      setEuphonyEntryIndex(
        clampNumber(nextIndex, 0, Math.max(0, euphonyEntryCount - 1)),
      );
    },
    [euphonyEntryCount],
  );

  const handleSelectRecord = (record: JsonRecord) => {
    setSelectedId(record.id);
    setPreferredRecordIndex(record.index);

    const filteredRecordIndex = filteredRecords.findIndex(
      (candidate) => candidate.id === record.id,
    );
    if (filteredRecordIndex >= 0) {
      setRecordPageIndex(
        Math.floor(filteredRecordIndex / RECORDS_PAGE_SIZE),
      );
    }

    const nextEuphonyIndex = euphonyEntries.findIndex(
      (entry) => entry.recordId === record.id,
    );
    if (nextEuphonyIndex >= 0) {
      const nextIndex = euphonyEntries[nextEuphonyIndex].index;
      setViewerRecordId(null);
      setEuphonyEntryIndex(nextIndex);
      requestEuphonyFeedScroll(nextIndex);
      setActiveViewerTab("euphony");
    } else if (normalizeConversation(record.value)?.messages.length) {
      setViewerRecordId(null);
      setEuphonyEntryIndex(0);
      requestEuphonyFeedScroll(0);
      setActiveViewerTab("euphony");
    } else {
      setViewerRecordId(record.id);
      setActiveViewerTab("payload");
    }
  };

  const handleSelectRelativeEuphonyEntry = (offset: number) => {
    if (filteredEuphonyEntryCount === 0) {
      return;
    }

    setViewerRecordId(null);
    setActiveViewerTab("euphony");
    const nextPosition = clampNumber(
      currentFilteredEuphonyPosition + offset,
      0,
      filteredEuphonyEntryCount - 1,
    );
    const nextIndex = filteredEuphonyEntries[nextPosition].index;
    setEuphonyEntryIndex(() => {
      const clampedIndex = clampNumber(
        nextIndex,
        0,
        Math.max(0, euphonyEntryCount - 1),
      );
      requestEuphonyFeedScroll(clampedIndex);
      return clampedIndex;
    });
  };

  const handleEuphonyPageChange = (nextPageIndex: number) => {
    if (filteredEuphonyEntryCount === 0) {
      return;
    }

    const nextPage = clampNumber(nextPageIndex, 0, euphonyPageCount - 1);
    const nextPosition = Math.min(
      filteredEuphonyEntryCount - 1,
      nextPage * EUPHONY_PAGE_SIZE,
    );
    const nextIndex = filteredEuphonyEntries[nextPosition].index;
    setViewerRecordId(null);
    setActiveViewerTab("euphony");
    setEuphonyEntryIndex(nextIndex);
    requestEuphonyFeedScroll(nextIndex);
  };

  const handleCodexSession = async (
    file: CodexSessionFile,
    options: { preserveSelection?: boolean } = {},
  ) => {
    setActiveFileSourceTab("codex");
    setLoadingSessionPath(file.path);

    try {
      const response = await fetch(
        `/api/codex-session?path=${encodeURIComponent(file.path)}`,
      );
      if (!response.ok) {
        throw new Error(`Unable to load ${file.relativePath}.`);
      }

      const data = (await response.json()) as {
        file: CodexSessionFile;
        content: string;
      };
      setInput(data.content);
      setSelectedSessionPath(data.file.path);
      if (!options.preserveSelection) {
        restoreStoredRecordState(data.file.path);
      }
      setActiveInspectorTab("records");
    } catch (error) {
      setInput(
        JSON.stringify(
          {
            error:
              error instanceof Error
                ? error.message
                : "Unable to load Codex session.",
          },
          null,
          2,
        ),
      );
      setSelectedSessionPath(null);
    } finally {
      setLoadingSessionPath(null);
    }
  };

  const handleRefreshRecords = async () => {
    if (!selectedSession) {
      return;
    }

    setRefreshingRecords(true);
    try {
      await handleCodexSession(selectedSession, { preserveSelection: true });
      await refreshSessions();
    } finally {
      setRefreshingRecords(false);
    }
  };

  const handleJumpToSession = (targetSession: CodexSessionFile) => {
    if (sessionsState.status !== "ready") {
      return;
    }

    const filteredIndex = filteredSessions.findIndex(
      (candidate) => candidate.path === targetSession.path,
    );
    if (filteredIndex >= 0) {
      setSessionPageIndex(Math.floor(filteredIndex / CODEX_FILES_PAGE_SIZE));
      setSessionScrollTarget((currentTarget) => ({
        index: filteredIndex,
        requestId: (currentTarget?.requestId ?? 0) + 1,
      }));
    } else {
      const unfilteredIndex = sessionsState.files.findIndex(
        (candidate) => candidate.path === targetSession.path,
      );
      setSessionQuery("");
      setSessionPageIndex(
        Math.floor(Math.max(0, unfilteredIndex) / CODEX_FILES_PAGE_SIZE),
      );
      setSessionScrollTarget((currentTarget) => ({
        index: Math.max(0, unfilteredIndex),
        requestId: (currentTarget?.requestId ?? 0) + 1,
      }));
    }

    void handleCodexSession(targetSession);
  };

  const handleJumpToParentSession = (file: CodexSessionFile) => {
    if (!file.parentThreadId) {
      return;
    }

    const parentSession = sessionByThreadId.get(file.parentThreadId);
    if (!parentSession) {
      return;
    }

    handleJumpToSession(parentSession);
  };

  const navigateToPath = (nextPath: string) => {
    window.history.pushState(null, "", nextPath);
    setLocationPath(window.location.pathname);
  };

  const handleCopyViewer = async () => {
    if (!viewerCopyText) {
      return;
    }

    const copiedTab = activeViewerTab;
    await copyTextToClipboard(viewerCopyText);
    setCopiedViewerTab(copiedTab);
    window.setTimeout(() => {
      setCopiedViewerTab((currentTab) =>
        currentTab === copiedTab ? null : currentTab,
      );
    }, 1400);
  };

  const handleCopySessionPath = async (path: string) => {
    await copyTextToClipboard(path);

    setCopiedSessionPath(path);
    window.setTimeout(() => {
      setCopiedSessionPath((currentPath) =>
        currentPath === path ? null : currentPath,
      );
    }, 1400);
  };

  if (locationPath === "/search") {
    return (
      <SearchTaskListPage
        onBack={() => navigateToPath("/")}
        onOpenTask={(taskId) => navigateToPath(`/search/${encodeURIComponent(taskId)}`)}
      />
    );
  }

  const searchTaskId = getSearchTaskId(locationPath);
  if (searchTaskId) {
    return (
      <SearchResultsPage
        taskId={searchTaskId}
        onBack={() => navigateToPath("/")}
        onOpenSession={(file) => {
          navigateToPath("/");
          void handleCodexSession(file);
        }}
      />
    );
  }

  return (
    <main
      className={`viewer-shell ${activeDrop ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setActiveDrop(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setActiveDrop(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setActiveDrop(false);
        const [file] = Array.from(event.dataTransfer.files);
        if (file) {
          void handleFile(file);
        }
      }}
    >
      <header className="topbar">
        <div>
          <p className="eyebrow">Noisy Room</p>
          <h1>JSONL viewer</h1>
        </div>
        <div className="status-strip">
          <div className="status-pills" aria-live="polite">
            {parsed.status === "error" ? (
              <span className="status-pill danger">
                <AlertCircle size={14} aria-hidden="true" />
                Parse error
              </span>
            ) : null}
          </div>
          <GlobalSearch
            value={globalSearchQuery}
            onChange={setGlobalSearchQuery}
            onClear={() => setGlobalSearchQuery("")}
          />
        </div>
      </header>

      <section className="workspace" aria-label="JSONL workspace">
        <aside className="sessions-pane" aria-label="Codex session files">
          <div className="pane-heading split">
            <div>
              <div className="inline-heading">
                <FolderOpen size={18} aria-hidden="true" />
                <h2>Codex files</h2>
              </div>
              <p>
                {activeFileSourceTab === "codex"
                  ? sessionsState.status === "ready"
                    ? `${filteredSessions.length} rollout files`
                    : "CODEX_HOME sessions"
                  : "Local JSON or JSONL file"}
              </p>
            </div>
            <div className="source-actions">
              {activeFileSourceTab === "codex" ? (
                <button
                  className="icon-only"
                  type="button"
                  aria-label="Refresh Codex sessions"
                  title="Refresh Codex sessions"
                  onClick={() => void refreshSessions()}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="source-tabs">
            <div
              className="tab-list"
              role="tablist"
              aria-label="File source tabs"
            >
              <button
                className={`tab-button ${
                  activeFileSourceTab === "codex" ? "is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={activeFileSourceTab === "codex"}
                aria-controls="codex-files-panel"
                id="codex-files-tab"
                onClick={() => setActiveFileSourceTab("codex")}
              >
                <FolderOpen size={14} aria-hidden="true" />
                <span>Codex</span>
              </button>
              <button
                className={`tab-button ${
                  activeFileSourceTab === "custom" ? "is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={activeFileSourceTab === "custom"}
                aria-controls="custom-file-panel"
                id="custom-file-tab"
                onClick={() => setActiveFileSourceTab("custom")}
              >
                <FileJson size={14} aria-hidden="true" />
                <span>Custom</span>
              </button>
            </div>
          </div>

          <div
            id="codex-files-panel"
            className={`source-panel ${
              activeFileSourceTab === "codex" ? "is-active" : ""
            }`}
            role="tabpanel"
            aria-labelledby="codex-files-tab"
            hidden={activeFileSourceTab !== "codex"}
          >
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                value={sessionQuery}
                placeholder="Filter sessions"
                onChange={(event) => setSessionQuery(event.target.value)}
              />
            </label>

            {sessionsState.status === "error" ? (
              <p className="session-message error">{sessionsState.message}</p>
            ) : sessionsState.status === "loading" ? (
              <p className="session-message">Scanning Codex rollouts...</p>
            ) : filteredSessions.length === 0 ? (
              <p className="session-message">
                No `rollout-*.jsonl` or `rollout-*.json` files found under{" "}
                {sessionsState.root}.
              </p>
            ) : (
              <>
                <div
                  className="record-pager session-pager"
                  aria-label="Codex file virtual regions"
                >
                  <button
                    className="icon-only"
                    type="button"
                    aria-label="Previous Codex files region"
                    title="Previous Codex files region"
                    disabled={currentSessionPageIndex === 0}
                    onClick={() =>
                      handleSessionPageChange(currentSessionPageIndex - 1)
                    }
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <span>
                    Region {currentSessionPageIndex + 1} of {sessionPageCount}
                  </span>
                  <small>
                    {sessionPageStart}-{sessionPageEnd} /{" "}
                    {filteredSessions.length}
                  </small>
                  <button
                    className="icon-only"
                    type="button"
                    aria-label="Next Codex files region"
                    title="Next Codex files region"
                    disabled={currentSessionPageIndex >= sessionPageCount - 1}
                    onClick={() =>
                      handleSessionPageChange(currentSessionPageIndex + 1)
                    }
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>

                <VirtualList
                  items={filteredSessions}
                  currentIndex={sessionFocusIndex}
                  scrollTarget={sessionScrollTarget}
                  estimatedItemHeight={SESSION_LIST_ESTIMATED_ROW_HEIGHT}
                  windowSize={34}
                  overscan={8}
                  className="session-list"
                  viewportClassName="session-list-viewport"
                  ariaLabel="Codex session files"
                  getKey={(file) => file.path}
                  onCurrentIndexChange={(index) => {
                    setSessionPageIndex(
                      Math.floor(index / CODEX_FILES_PAGE_SIZE),
                    );
                  }}
                  renderItem={(file) => {
                    const childSessions = file.threadId
                      ? childSessionsByThreadId.get(file.threadId) ?? []
                      : [];
                    const parentSession = file.parentThreadId
                      ? sessionByThreadId.get(file.parentThreadId) ?? null
                      : null;
                    const parentBadgeLabel = file.parentThreadId
                      ? formatParentSessionBadge(
                          parentSession,
                          file.parentThreadId,
                        )
                      : null;

                    return (
                      <div
                        className={`session-row ${
                          file.path === selectedSessionPath ? "is-selected" : ""
                        }`}
                      >
                        <button
                          className="session-open-region"
                          type="button"
                          aria-label={`Open Codex file ${file.relativePath}`}
                          onPointerDown={(event) => {
                            if (event.button !== 0) {
                              return;
                            }

                            void handleCodexSession(file);
                          }}
                          onClick={(event) => {
                            if (event.detail === 0) {
                              void handleCodexSession(file);
                            }
                          }}
                        />
                        <span className="session-date">
                          {formatSessionDate(file.modifiedAt)}
                        </span>
                        <span className="session-copy">
                          <span className="session-title-text">
                            <strong>{file.relativePath}</strong>
                          </span>
                          <span className="session-meta-line">
                            <small>
                              {file.lineCount ?? "?"} lines /{" "}
                              {formatBytes(file.size)}
                            </small>
                            <button
                              className="session-copy-path"
                              type="button"
                              aria-label={
                                copiedSessionPath === file.path
                                  ? `Copied path for ${file.relativePath}`
                                  : `Copy path for ${file.relativePath}`
                              }
                              title={
                                copiedSessionPath === file.path
                                  ? "Copied"
                                  : "Copy file path"
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleCopySessionPath(file.path);
                              }}
                            >
                              {copiedSessionPath === file.path ? (
                                <Check size={14} aria-hidden="true" />
                              ) : (
                                <Clipboard size={14} aria-hidden="true" />
                              )}
                            </button>
                          </span>
                        </span>
                        {file.parentThreadId || childSessions.length > 0 ? (
                          <div className="session-relations">
                            {file.parentThreadId ? (
                              <button
                                className="thread-badge is-parent-link"
                                type="button"
                                aria-label={
                                  parentSession
                                    ? `Jump to parent thread ${getSessionFileName(
                                        parentSession,
                                      )}`
                                    : `Parent thread ${file.parentThreadId} was not found`
                                }
                                title={
                                  parentSession
                                    ? `Jump to parent ${parentSession.relativePath}`
                                    : `Parent thread ${shortThreadId(
                                        file.parentThreadId,
                                      )} not found`
                              }
                              disabled={!parentSession}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleJumpToParentSession(file);
                              }}
                            >
                              {parentBadgeLabel}
                            </button>
                          ) : null}
                            {childSessions.length > 0 ? (
                              <details className="child-thread-dropdown">
                                <summary
                                  className="child-thread-trigger"
                                  aria-label={`${childSessions.length} child thread${
                                    childSessions.length === 1 ? "" : "s"
                                  }`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  <span>
                                    {childSessions.length} child
                                    {childSessions.length === 1 ? "" : "ren"}
                                  </span>
                                  <ChevronDown size={13} aria-hidden="true" />
                                </summary>
                                <div
                                  className="child-thread-menu"
                                  role="menu"
                                  aria-label="Child threads"
                                >
                                  {childSessions.map((childSession) => (
                                    <button
                                      key={childSession.path}
                                      className="child-thread-menu-item"
                                      type="button"
                                      role="menuitem"
                                      aria-label={`Jump to child thread ${getSessionFileName(
                                        childSession,
                                      )}`}
                                      title={`Jump to child ${childSession.relativePath}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleJumpToSession(childSession);
                                      }}
                                    >
                                      {formatChildSessionBadge(childSession)}
                                    </button>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                          </div>
                        ) : null}
                        {loadingSessionPath === file.path ? (
                          <span className="session-loading">Loading</span>
                        ) : null}
                      </div>
                    );
                  }}
                />
              </>
            )}
          </div>

          <div
            id="custom-file-panel"
            className={`source-panel custom-source-panel ${
              activeFileSourceTab === "custom" ? "is-active" : ""
            }`}
            role="tabpanel"
            aria-labelledby="custom-file-tab"
            hidden={activeFileSourceTab !== "custom"}
          >
            <div className="custom-source-card">
              <button
                className="icon-button custom-open-button"
                type="button"
                disabled={openingCustomFile}
                onClick={() => void handleOpenCustomFile()}
              >
                <FileJson size={16} aria-hidden="true" />
                <span>{openingCustomFile ? "Opening..." : "Open file"}</span>
              </button>
              <p>
                {customFileMessage ??
                (selectedSessionPath
                  ? "Choose a local file to leave the Codex session list."
                  : input
                    ? "Loaded custom input."
                    : "Open a JSON or JSONL file from disk.")}
              </p>
            </div>
          </div>
        </aside>

        <section className="inspector-pane" aria-label="JSONL input and records">
          <div className="pane-heading split inspector-heading">
            <div>
              <div className="inline-heading">
                {activeInspectorTab === "input" ? (
                  <FileJson size={18} aria-hidden="true" />
                ) : (
                  <Filter size={18} aria-hidden="true" />
                )}
                <h2>{activeInspectorTab === "input" ? "Input" : "Records"}</h2>
              </div>
              <p>
                {activeInspectorTab === "input"
                  ? parsed.status === "ready"
                    ? `${records.length} parsed records`
                    : "JSON or JSONL source"
                  : `${recordPageStart}-${recordPageEnd} of ${filteredRecords.length} visible`}
              </p>
            </div>
            <div className="inspector-actions">
              {activeInspectorTab === "records" ? (
                <button
                  className="icon-only"
                  type="button"
                  aria-label="Refresh records"
                  title={
                    selectedSession
                      ? "Refresh records from selected Codex file"
                      : "Select a Codex file to refresh records"
                  }
                  disabled={!selectedSession || refreshingRecords}
                  onClick={() => void handleRefreshRecords()}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                </button>
              ) : null}
              <div
                className="tab-list"
                role="tablist"
                aria-label="Inspector tabs"
              >
                <button
                  className={`tab-button ${
                    activeInspectorTab === "input" ? "is-active" : ""
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={activeInspectorTab === "input"}
                  aria-controls="input-panel"
                  id="input-tab"
                  onClick={() => setActiveInspectorTab("input")}
                >
                  <FileJson size={14} aria-hidden="true" />
                  <span>Input</span>
                </button>
                <button
                  className={`tab-button ${
                    activeInspectorTab === "records" ? "is-active" : ""
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={activeInspectorTab === "records"}
                  aria-controls="records-panel"
                  id="records-tab"
                  onClick={() => setActiveInspectorTab("records")}
                >
                  <Filter size={14} aria-hidden="true" />
                  <span>Records</span>
                </button>
              </div>
            </div>
          </div>

          <div
            id="input-panel"
            className={`tab-panel ${
              activeInspectorTab === "input" ? "is-active" : ""
            }`}
            role="tabpanel"
            aria-labelledby="input-tab"
            hidden={activeInspectorTab !== "input"}
          >
            <textarea
              value={inputPreview.text}
              readOnly={inputPreview.truncated}
              spellCheck={false}
              aria-label="JSON or JSONL input"
              onChange={(event) => {
                if (!inputPreview.truncated) {
                  setInput(event.target.value);
                  if (selectedSessionPath) {
                    restoreStoredRecordState(null);
                  }
                  setActiveFileSourceTab("custom");
                  setSelectedSessionPath(null);
                }
              }}
            />

            {parsed.status === "error" ? (
              <p className="parse-message error">{parsed.message}</p>
            ) : selectedSession ? (
              <p className="parse-message">
                Loaded from {selectedSession.displayPath}
                {inputPreview.truncated ? "; input preview truncated." : "."}
              </p>
            ) : inputPreview.truncated ? (
              <p className="parse-message">
                Input preview truncated; records use the full text.
              </p>
            ) : cachedInput.restored && input ? (
              <p className="parse-message">Restored cached input.</p>
            ) : (
              cachedInput.skippedLargeContent && !input ? (
                <p className="parse-message">
                  Previous input was too large for local cache; open it again
                  from Codex files or disk.
                </p>
              ) : (
                <p className="parse-message">
                  Drop a `.jsonl` file anywhere on the page, or paste JSON/JSONL.
                </p>
              )
            )}
          </div>

          <div
            id="records-panel"
            className={`tab-panel ${
              activeInspectorTab === "records" ? "is-active" : ""
            }`}
            role="tabpanel"
            aria-labelledby="records-tab"
            hidden={activeInspectorTab !== "records"}
          >
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                placeholder="Filter records"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="record-pager" aria-label="Record virtual regions">
              <button
                className="icon-only"
                type="button"
                aria-label="Previous records region"
                title="Previous records region"
                disabled={currentRecordPageIndex === 0}
                onClick={() => handleRecordPageChange(currentRecordPageIndex - 1)}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span>
                Region {currentRecordPageIndex + 1} of {recordPageCount}
              </span>
              <small>
                {recordPageStart}-{recordPageEnd} / {filteredRecords.length}
              </small>
              <button
                className="icon-only"
                type="button"
                aria-label="Next records region"
                title="Next records region"
                disabled={currentRecordPageIndex >= recordPageCount - 1}
                onClick={() => handleRecordPageChange(currentRecordPageIndex + 1)}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>

            <VirtualList
              items={filteredRecords}
              currentIndex={recordFocusIndex}
              scrollTarget={recordScrollTarget}
              estimatedItemHeight={RECORD_LIST_ESTIMATED_ROW_HEIGHT}
              windowSize={42}
              overscan={10}
              className="record-list"
              viewportClassName="record-list-viewport"
              ariaLabel="Records"
              getKey={(record) => record.id}
              onCurrentIndexChange={(index) => {
                setRecordPageIndex(Math.floor(index / RECORDS_PAGE_SIZE));
              }}
              renderItem={(record) => (
                <button
                  ref={(element) => {
                    if (element) {
                      recordRowRefs.current.set(record.id, element);
                      if (pendingRecordFocusIdRef.current === record.id) {
                        pendingRecordFocusIdRef.current = null;
                        window.requestAnimationFrame(() => {
                          element.focus({ preventScroll: true });
                          element.scrollIntoView({ block: "nearest" });
                        });
                      }
                    } else {
                      recordRowRefs.current.delete(record.id);
                    }
                  }}
                  type="button"
                  className={`record-row ${
                    record.id === selectedRecord?.id ? "is-selected" : ""
                  }`}
                  onClick={() => handleSelectRecord(record)}
                >
                  <span className="record-index">
                    {record.line ? `L${record.line}` : `#${record.index + 1}`}
                  </span>
                  <span className="record-copy">
                    <strong>{record.title}</strong>
                    <small>{record.subtitle}</small>
                    <span>{record.preview}</span>
                  </span>
                </button>
              )}
            />
          </div>
        </section>

        <section className="render-pane" aria-label="Selected record viewer">
          <div className="pane-heading split">
            <div>
              <div className="inline-heading">
                <PanelRight size={18} aria-hidden="true" />
                <h2>Viewer</h2>
              </div>
              <p>
                {currentEuphonyEntry
                  ? `${formatEuphonyEntryRecordLabel(
                      currentEuphonyEntry,
                    )} in Euphony ${currentFilteredEuphonyPosition + 1} of ${
                      filteredEuphonyEntryCount || euphonyEntryCount
                    }`
                  : viewerRecord
                    ? `Record ${viewerRecord.index + 1} of ${records.length}`
                  : selectedRecord
                    ? `Record ${selectedRecord.index + 1} of ${records.length}`
                    : "No entry selected"}
              </p>
            </div>
            <div className="viewer-actions">
              <div
                className="tab-list"
                role="tablist"
                aria-label="Viewer tabs"
              >
                <button
                  className={`tab-button ${
                    activeViewerTab === "euphony" ? "is-active" : ""
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={activeViewerTab === "euphony"}
                  aria-controls="euphony-panel"
                  id="euphony-tab"
                  onClick={() => setActiveViewerTab("euphony")}
                >
                  <PanelRight size={14} aria-hidden="true" />
                  <span>Euphony</span>
                </button>
                <button
                  className={`tab-button ${
                    activeViewerTab === "payload" ? "is-active" : ""
                  }`}
                  type="button"
                  role="tab"
                  aria-selected={activeViewerTab === "payload"}
                  aria-controls="payload-panel"
                  id="payload-tab"
                  onClick={() => setActiveViewerTab("payload")}
                >
                  <FileJson size={14} aria-hidden="true" />
                  <span>Payload</span>
                </button>
              </div>
              <button
                className="icon-only"
                type="button"
                aria-label="Previous Euphony entry"
                title="Previous Euphony entry"
                disabled={!canSelectPreviousEuphonyEntry}
                onClick={() => handleSelectRelativeEuphonyEntry(-1)}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-only"
                type="button"
                aria-label="Next Euphony entry"
                title="Next Euphony entry"
                disabled={!canSelectNextEuphonyEntry}
                onClick={() => handleSelectRelativeEuphonyEntry(1)}
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
              <button
                className="icon-only"
                type="button"
                aria-label={
                  copiedViewerTab === activeViewerTab
                    ? "Copied viewer content"
                    : activeViewerTab === "payload"
                      ? "Copy payload JSON"
                      : "Copy Euphony entry"
                }
                title={
                  copiedViewerTab === activeViewerTab
                    ? "Copied"
                    : activeViewerTab === "payload"
                      ? "Copy payload JSON"
                      : "Copy Euphony entry"
                }
                disabled={!viewerCopyText}
                onClick={() => void handleCopyViewer()}
              >
                {copiedViewerTab === activeViewerTab ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <Clipboard size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div
            id="euphony-panel"
            className="viewer-tab-panel"
            role="tabpanel"
            aria-labelledby="euphony-tab"
            hidden={activeViewerTab !== "euphony"}
          >
            {euphonyEntries.length > 0 ? (
              <div className="viewer-filter-row">
                <label className="content-filter">
                  <Filter size={15} aria-hidden="true" />
                  <input
                    value={viewerFilterQuery}
                    placeholder="Filter viewer content"
                    aria-label="Filter viewer content"
                    onChange={(event) => setViewerFilterQuery(event.target.value)}
                  />
                  <button
                    className="mini-clear"
                    type="button"
                    aria-label="Clear viewer filter"
                    title="Clear viewer filter"
                    disabled={!viewerFilterQuery}
                    onClick={() => setViewerFilterQuery("")}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </label>
                <div className="record-pager viewer-pager" aria-label="Euphony pages">
                  <button
                    className="icon-only"
                    type="button"
                    aria-label="Previous Euphony page"
                    title="Previous Euphony page"
                    disabled={currentEuphonyPageIndex === 0}
                    onClick={() =>
                      handleEuphonyPageChange(currentEuphonyPageIndex - 1)
                    }
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <span>
                    Page {currentEuphonyPageIndex + 1} of {euphonyPageCount}
                  </span>
                  <small>
                    {euphonyPageStart}-{euphonyPageEnd} /{" "}
                    {filteredEuphonyEntryCount}
                  </small>
                  <button
                    className="icon-only"
                    type="button"
                    aria-label="Next Euphony page"
                    title="Next Euphony page"
                    disabled={currentEuphonyPageIndex >= euphonyPageCount - 1}
                    onClick={() =>
                      handleEuphonyPageChange(currentEuphonyPageIndex + 1)
                    }
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
            {!viewerRecordId && filteredEuphonyEntries.length > 0 ? (
              <EuphonyFeed
                entries={filteredEuphonyEntries}
                collapseScope={selectedSessionPath}
                currentIndex={currentEuphonyEntryIndex}
                scrollTarget={euphonyScrollTarget}
                onCurrentIndexChange={handleCurrentEuphonyEntryChange}
                onSelectEntry={(index) => {
                  handleCurrentEuphonyEntryChange(index);
                  requestEuphonyFeedScroll(index);
                }}
              />
            ) : (
              <div className="empty-render">
                <FileJson size={28} aria-hidden="true" />
                <p>
                  {viewerFilterQuery && euphonyEntries.length > 0
                    ? "No Euphony entries match the current filter."
                    : "Select a record with a `messages` array, or paste JSONL chat messages."}
                </p>
              </div>
            )}
          </div>

          <div
            id="payload-panel"
            className="viewer-tab-panel"
            role="tabpanel"
            aria-labelledby="payload-tab"
            hidden={activeViewerTab !== "payload"}
          >
            <pre ref={rawJsonRef} className="raw-json" aria-label="Payload JSON">
              {selectedRaw || "No record selected."}
            </pre>
          </div>
        </section>
      </section>
    </main>
  );
}

function GlobalSearch({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openSearchWindow = (query: string) => {
    const searchUrl = new URL("/search/new", window.location.href);
    searchUrl.searchParams.set("q", query);
    window.open(searchUrl.href, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <form
      className="viewer-search"
      role="search"
      aria-label="Global search"
      action="/search/new"
      method="GET"
      target="_blank"
      onSubmit={(event) => {
        const formData = new FormData(event.currentTarget);
        const query = formData.get("q");
        if (typeof query !== "string" || !query.trim()) {
          event.preventDefault();
        }
      }}
    >
      <label className="viewer-search-box">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          value={value}
          name="q"
          placeholder="Search all Codex files"
          aria-label="Search all Codex files"
          aria-keyshortcuts="Meta+K Control+K"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const query = event.currentTarget.value.trim();
              if (query) {
                openSearchWindow(query);
              }
            }

            if (event.key === "Escape" && value) {
              event.preventDefault();
              onClear();
            }
          }}
        />
        <kbd className="viewer-search-hotkey" aria-hidden="true">
          ⌘K
        </kbd>
      </label>
      <a
        className="viewer-search-results-link"
        href="/search"
        target="_blank"
        rel="noreferrer"
        aria-label="Open search result tasks"
        title="Open search result tasks"
      >
        <PanelRight size={14} aria-hidden="true" />
        <span>Results</span>
      </a>
    </form>
  );
}

function getSearchTaskId(pathname: string) {
  const match = pathname.match(/^\/search\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function SearchTaskListPage({
  onBack,
  onOpenTask,
}: {
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<GlobalSearchTaskSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadTasks = async () => {
      try {
        const response = await fetch("/api/search-tasks");
        if (!response.ok) {
          throw new Error(`Search tasks failed with ${response.status}.`);
        }

        const data = (await response.json()) as {
          tasks: GlobalSearchTaskSummary[];
        };
        if (!cancelled) {
          setTasks(data.tasks);
          setMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load search tasks.",
          );
        }
      }
    };

    void loadTasks();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  return (
    <main className="viewer-shell search-results-shell">
      <header className="topbar search-results-topbar">
        <div>
          <p className="eyebrow">Noisy Room</p>
          <h1>Search tasks</h1>
        </div>
        <div className="search-result-actions">
          <button className="icon-button" type="button" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Back</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            <RefreshCcw size={15} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <section className="search-results-pane" aria-label="Global search tasks">
        <div className="pane-heading split">
          <div>
            <div className="inline-heading">
              <Search size={18} aria-hidden="true" />
              <h2>Global search tasks</h2>
            </div>
            <p>{tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {message ? (
          <p className="session-message error">{message}</p>
        ) : tasks.length === 0 ? (
          <p className="session-message">No search tasks yet.</p>
        ) : (
          <div className="search-task-list" aria-label="Search task list">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className="search-task-row"
                onClick={() => onOpenTask(task.id)}
              >
                <span className="record-index">{task.id.slice(0, 8)}</span>
                <span className="record-copy">
                  <strong>{task.id}</strong>
                  <small>
                    {task.status} • {task.matchCount} matches •{" "}
                    {task.scannedFiles} files • {formatSearchTaskTime(task)}
                  </small>
                  <span>{task.query}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SearchResultsPage({
  taskId,
  onBack,
  onOpenSession,
}: {
  taskId: string;
  onBack: () => void;
  onOpenSession: (file: CodexSessionFile) => void;
}) {
  const [task, setTask] = useState<GlobalSearchTask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [resultFocusIndex, setResultFocusIndex] = useState(0);
  const [resultScrollTarget, setResultScrollTarget] =
    useState<VirtualScrollTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;
    let shouldPoll = true;

    const loadTask = async () => {
      try {
        const response = await fetch(`/api/search-tasks/${encodeURIComponent(taskId)}`);
        if (!response.ok) {
          throw new Error(`Search task failed with ${response.status}.`);
        }

        const data = (await response.json()) as { task: GlobalSearchTask };
        if (cancelled) {
          return;
        }

        setTask(data.task);
        setMessage(null);
        if (
          (data.task.status === "complete" || data.task.status === "error") &&
          interval !== null
        ) {
          shouldPoll = false;
          window.clearInterval(interval);
          interval = null;
        } else if (
          data.task.status === "complete" ||
          data.task.status === "error"
        ) {
          shouldPoll = false;
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Unable to load search results.",
          );
        }
      }
    };

    void loadTask();
    interval = window.setInterval(() => {
      if (shouldPoll) {
        void loadTask();
      }
    }, 1200);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [refreshNonce, taskId]);

  const matches = task?.matches ?? [];
  const resultPageSize = 50;
  const resultPageCount = Math.max(1, Math.ceil(matches.length / resultPageSize));
  const currentResultPageIndex =
    matches.length > 0
      ? clampNumber(
          Math.floor(resultFocusIndex / resultPageSize),
          0,
          resultPageCount - 1,
        )
      : 0;
  const resultPageStart =
    matches.length === 0 ? 0 : currentResultPageIndex * resultPageSize + 1;
  const resultPageEnd = Math.min(
    matches.length,
    (currentResultPageIndex + 1) * resultPageSize,
  );

  const handleResultPageChange = (nextPageIndex: number) => {
    const nextPage = clampNumber(nextPageIndex, 0, resultPageCount - 1);
    const nextIndex = Math.max(
      0,
      Math.min(matches.length - 1, nextPage * resultPageSize),
    );
    setResultFocusIndex(nextIndex);
    setResultScrollTarget((currentTarget) => ({
      index: nextIndex,
      requestId: (currentTarget?.requestId ?? 0) + 1,
    }));
  };

  return (
    <main className="viewer-shell search-results-shell">
      <header className="topbar search-results-topbar">
        <div>
          <p className="eyebrow">Noisy Room</p>
          <h1>Search results</h1>
        </div>
        <div className="search-result-actions">
          <button className="icon-button" type="button" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Back</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            <RefreshCcw size={15} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <section className="search-results-pane" aria-label="Global search results">
        <div className="pane-heading split">
          <div>
            <div className="inline-heading">
              <Search size={18} aria-hidden="true" />
              <h2>{task ? task.query : "Loading search"}</h2>
            </div>
            <p>
              {task
                ? `${task.status} • ${matches.length} matches • ${task.scannedFiles} files`
                : "Starting task"}
            </p>
          </div>
          <div className="status-pills">
            <span className="status-pill neutral">{taskId.slice(0, 8)}</span>
            {task?.status === "complete" ? (
              <span className="status-pill good">
                <Check size={14} aria-hidden="true" />
                Complete
              </span>
            ) : null}
            {task?.status === "error" ? (
              <span className="status-pill danger">
                <AlertCircle size={14} aria-hidden="true" />
                Failed
              </span>
            ) : null}
          </div>
        </div>

        {message || task?.error ? (
          <p className="session-message error">{message ?? task?.error}</p>
        ) : matches.length === 0 ? (
          <p className="session-message">
            {task?.status === "complete"
              ? "No matching Codex rollout lines found."
              : "Scanning Codex rollouts..."}
          </p>
        ) : (
          <>
            <div className="record-pager" aria-label="Search result pages">
              <button
                className="icon-only"
                type="button"
                aria-label="Previous search results page"
                title="Previous search results page"
                disabled={currentResultPageIndex === 0}
                onClick={() => handleResultPageChange(currentResultPageIndex - 1)}
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span>
                Page {currentResultPageIndex + 1} of {resultPageCount}
              </span>
              <small>
                {resultPageStart}-{resultPageEnd} / {matches.length}
              </small>
              <button
                className="icon-only"
                type="button"
                aria-label="Next search results page"
                title="Next search results page"
                disabled={currentResultPageIndex >= resultPageCount - 1}
                onClick={() => handleResultPageChange(currentResultPageIndex + 1)}
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>

            <VirtualList
              items={matches}
              currentIndex={resultFocusIndex}
              scrollTarget={resultScrollTarget}
              estimatedItemHeight={84}
              windowSize={44}
              overscan={10}
              className="search-result-list"
              viewportClassName="search-result-viewport"
              ariaLabel="Search results"
              getKey={(match, index) =>
                `${match.file.path}:${match.line ?? "file"}:${index}`
              }
              onCurrentIndexChange={setResultFocusIndex}
              renderItem={(match) => (
                <button
                  type="button"
                  className="search-result-row"
                  onClick={() => onOpenSession(match.file)}
                >
                  <span className="record-index">
                    {match.line ? `L${match.line}` : "File"}
                  </span>
                  <span className="record-copy">
                    <strong>{match.file.relativePath}</strong>
                    <small>
                      {formatSessionDate(match.file.modifiedAt)} •{" "}
                      {formatBytes(match.file.size)}
                    </small>
                    <span>{match.preview}</span>
                  </span>
                </button>
              )}
            />
          </>
        )}
      </section>
    </main>
  );
}

function VirtualList<T>({
  items,
  currentIndex,
  scrollTarget,
  estimatedItemHeight,
  windowSize = 28,
  overscan = 6,
  className,
  viewportClassName,
  ariaLabel,
  renderItem,
  getKey,
  onCurrentIndexChange,
}: {
  items: T[];
  currentIndex: number;
  scrollTarget: VirtualScrollTarget | null;
  estimatedItemHeight: number;
  windowSize?: number;
  overscan?: number;
  className: string;
  viewportClassName: string;
  ariaLabel: string;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  onCurrentIndexChange: (index: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const scrollFrameRef = useRef<number | null>(null);
  const targetScrollFrameRef = useRef<number | null>(null);
  const suppressScrollSelectionUntilRef = useRef(0);
  const totalItems = items.length;
  const safeCurrentIndex = clampNumber(currentIndex, 0, Math.max(0, totalItems - 1));
  const currentIndexRef = useRef(currentIndex);
  const [heightVersion, setHeightVersion] = useState(0);
  const [windowStart, setWindowStart] = useState(() =>
    getVirtualWindowStart(currentIndex, items.length, windowSize),
  );

  const averageHeight = useMemo(() => {
    const heights = Array.from(measuredHeightsRef.current.values());
    if (heights.length === 0) {
      return estimatedItemHeight;
    }

    return clampNumber(
      heights.reduce((total, height) => total + height, 0) / heights.length,
      Math.max(32, estimatedItemHeight * 0.5),
      Math.max(64, estimatedItemHeight * 2.5),
    );
  }, [estimatedItemHeight, heightVersion]);

  const windowEnd = Math.min(totalItems, windowStart + windowSize);
  const visibleItems = useMemo(
    () => items.slice(windowStart, windowEnd),
    [items, windowEnd, windowStart],
  );
  const topSpacerHeight = estimateVirtualRangeHeight(
    0,
    windowStart,
    measuredHeightsRef.current,
    averageHeight,
  );
  const bottomSpacerHeight = estimateVirtualRangeHeight(
    windowEnd,
    totalItems,
    measuredHeightsRef.current,
    averageHeight,
  );

  useEffect(() => {
    currentIndexRef.current = safeCurrentIndex;
  }, [safeCurrentIndex]);

  useEffect(() => {
    measuredHeightsRef.current.clear();
    setHeightVersion((version) => version + 1);
    setWindowStart(getVirtualWindowStart(currentIndexRef.current, totalItems, windowSize));
  }, [items, totalItems, windowSize]);

  useEffect(() => {
    setWindowStart((start) => {
      const maxStart = Math.max(0, totalItems - windowSize);
      if (safeCurrentIndex < start || safeCurrentIndex >= start + windowSize) {
        return getVirtualWindowStart(safeCurrentIndex, totalItems, windowSize);
      }

      return clampNumber(start, 0, maxStart);
    });
  }, [safeCurrentIndex, totalItems, windowSize]);

  useEffect(() => {
    if (!scrollTarget || totalItems === 0) {
      return;
    }

    const targetIndex = clampNumber(scrollTarget.index, 0, totalItems - 1);
    suppressScrollSelectionUntilRef.current = Date.now() + 700;
    currentIndexRef.current = targetIndex;
    onCurrentIndexChange(targetIndex);
    setWindowStart(getVirtualWindowStart(targetIndex, totalItems, windowSize));

    let scrollFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }

        const targetTop = estimateVirtualRangeHeight(
          0,
          targetIndex,
          measuredHeightsRef.current,
          averageHeight,
        );
        const centeredTop = Math.max(
          0,
          targetTop - Math.max(0, viewport.clientHeight - averageHeight) / 2,
        );
        viewport.scrollTo({ top: centeredTop, behavior: "auto" });
      });

      targetScrollFrameRef.current = scrollFrame;
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (scrollFrame !== null) {
        window.cancelAnimationFrame(scrollFrame);
      }
    };
  }, [averageHeight, scrollTarget, totalItems, windowSize]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (targetScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(targetScrollFrameRef.current);
      }
    },
    [],
  );

  const handleItemHeightChange = useCallback((index: number, height: number) => {
    const normalizedHeight = Math.max(1, Math.round(height));
    const previousHeight = measuredHeightsRef.current.get(index);
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - normalizedHeight) < 4
    ) {
      return;
    }

    measuredHeightsRef.current.set(index, normalizedHeight);
    setHeightVersion((version) => version + 1);
  }, []);

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport || totalItems === 0) {
        return;
      }

      const firstVisibleIndex = getVirtualIndexAtOffset(
        viewport.scrollTop,
        totalItems,
        measuredHeightsRef.current,
        averageHeight,
      );
      const nextWindowStart = clampNumber(
        firstVisibleIndex - overscan,
        0,
        Math.max(0, totalItems - windowSize),
      );
      setWindowStart((start) =>
        start === nextWindowStart ? start : nextWindowStart,
      );

      if (Date.now() <= suppressScrollSelectionUntilRef.current) {
        return;
      }

      const activeIndex = getVirtualIndexAtOffset(
        viewport.scrollTop + viewport.clientHeight * 0.42,
        totalItems,
        measuredHeightsRef.current,
        averageHeight,
      );
      if (activeIndex !== currentIndexRef.current) {
        currentIndexRef.current = activeIndex;
        onCurrentIndexChange(activeIndex);
      }
    });
  };

  return (
    <div className={className}>
      <div
        ref={viewportRef}
        className={viewportClassName}
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div
          className="virtual-list-spacer"
          style={{ height: topSpacerHeight }}
        />
        {visibleItems.map((item, offset) => {
          const itemIndex = windowStart + offset;
          return (
            <VirtualListItem
              key={getKey(item, itemIndex)}
              index={itemIndex}
              onHeightChange={handleItemHeightChange}
            >
              {renderItem(item, itemIndex)}
            </VirtualListItem>
          );
        })}
        <div
          className="virtual-list-spacer"
          style={{ height: bottomSpacerHeight }}
        />
      </div>
    </div>
  );
}

function VirtualListItem({
  children,
  index,
  onHeightChange,
}: {
  children: ReactNode;
  index: number;
  onHeightChange: (index: number, height: number) => void;
}) {
  const itemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const item = itemRef.current;
    if (!item) {
      return;
    }

    const reportHeight = () => {
      onHeightChange(index, item.offsetHeight);
    };
    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", reportHeight);
      return () => {
        window.removeEventListener("resize", reportHeight);
      };
    }

    const observer = new ResizeObserver(reportHeight);
    observer.observe(item);
    return () => {
      observer.disconnect();
    };
  }, [index, onHeightChange]);

  return (
    <div ref={itemRef} className="virtual-list-item">
      {children}
    </div>
  );
}

function EuphonyFeed({
  entries,
  collapseScope,
  currentIndex,
  scrollTarget,
  onCurrentIndexChange,
  onSelectEntry,
}: {
  entries: EuphonyEntry[];
  collapseScope: string | null;
  currentIndex: number;
  scrollTarget: EuphonyScrollTarget | null;
  onCurrentIndexChange: (index: number) => void;
  onSelectEntry: (index: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const scrollFrameRef = useRef<number | null>(null);
  const currentIndexRef = useRef(currentIndex);
  const suppressScrollSelectionUntilRef = useRef(0);
  const totalEntries = entries.length;
  const matchedCurrentPosition = entries.findIndex(
    (entry) => entry.index === currentIndex,
  );
  const currentPosition =
    matchedCurrentPosition >= 0 ? matchedCurrentPosition : 0;
  const [heightVersion, setHeightVersion] = useState(0);
  const [windowStart, setWindowStart] = useState(() =>
    getEuphonyFeedWindowStart(currentPosition, totalEntries),
  );

  const averageHeight = useMemo(() => {
    const heights = Array.from(measuredHeightsRef.current.values());
    if (heights.length === 0) {
      return EUPHONY_FEED_ESTIMATED_ENTRY_HEIGHT;
    }

    const average =
      heights.reduce((total, height) => total + height, 0) / heights.length;
    return clampNumber(average, 64, 900);
  }, [heightVersion]);

  const windowEnd = Math.min(totalEntries, windowStart + EUPHONY_FEED_WINDOW_SIZE);
  const visibleEntries = useMemo(
    () => entries.slice(windowStart, windowEnd),
    [entries, windowEnd, windowStart],
  );
  const topSpacerHeight = estimateEuphonyFeedRangeHeight(
    0,
    windowStart,
    measuredHeightsRef.current,
    averageHeight,
  );
  const bottomSpacerHeight = estimateEuphonyFeedRangeHeight(
    windowEnd,
    totalEntries,
    measuredHeightsRef.current,
    averageHeight,
  );

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    measuredHeightsRef.current.clear();
    setHeightVersion((version) => version + 1);
    const nextPosition = Math.max(
      0,
      entries.findIndex((entry) => entry.index === currentIndexRef.current),
    );
    setWindowStart(
      getEuphonyFeedWindowStart(nextPosition, totalEntries),
    );
  }, [entries, totalEntries]);

  useEffect(() => {
    setWindowStart((start) => {
      const maxStart = Math.max(0, totalEntries - EUPHONY_FEED_WINDOW_SIZE);
      if (
        currentPosition < start ||
        currentPosition >= start + EUPHONY_FEED_WINDOW_SIZE
      ) {
        return getEuphonyFeedWindowStart(currentPosition, totalEntries);
      }

      return clampNumber(start, 0, maxStart);
    });
  }, [currentPosition, totalEntries]);

  useEffect(() => {
    if (!scrollTarget || totalEntries === 0) {
      return;
    }

    const targetIndex = scrollTarget.index;
    const targetPosition = entries.findIndex((entry) => entry.index === targetIndex);
    if (targetPosition < 0) {
      return;
    }

    suppressScrollSelectionUntilRef.current = Date.now() + 900;
    setWindowStart(getEuphonyFeedWindowStart(targetPosition, totalEntries));

    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const targetTop = estimateEuphonyFeedRangeHeight(
        0,
        targetPosition,
        measuredHeightsRef.current,
        averageHeight,
      );
      const centeredTop = Math.max(
        0,
        targetTop - Math.max(0, viewport.clientHeight - averageHeight) / 2,
      );
      viewport.scrollTo({ top: centeredTop, behavior: "auto" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [averageHeight, entries, scrollTarget, totalEntries]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  const handleEntryHeightChange = useCallback((index: number, height: number) => {
    const normalizedHeight = Math.max(1, Math.round(height));
    const previousHeight = measuredHeightsRef.current.get(index);
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - normalizedHeight) < 4
    ) {
      return;
    }

    measuredHeightsRef.current.set(index, normalizedHeight);
    setHeightVersion((version) => version + 1);
  }, []);

  const handleScroll = () => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport || totalEntries === 0) {
        return;
      }

      if (Date.now() <= suppressScrollSelectionUntilRef.current) {
        return;
      }

      const firstVisibleIndex = getEuphonyFeedIndexAtOffset(
        viewport.scrollTop,
        totalEntries,
        measuredHeightsRef.current,
        averageHeight,
      );
      const activePosition = getEuphonyFeedIndexAtOffset(
        viewport.scrollTop + viewport.clientHeight * 0.42,
        totalEntries,
        measuredHeightsRef.current,
        averageHeight,
      );
      const nextWindowStart = clampNumber(
        firstVisibleIndex - EUPHONY_FEED_OVERSCAN,
        0,
        Math.max(0, totalEntries - EUPHONY_FEED_WINDOW_SIZE),
      );

      setWindowStart((start) =>
        start === nextWindowStart ? start : nextWindowStart,
      );

      if (
        Date.now() > suppressScrollSelectionUntilRef.current &&
        entries[activePosition] &&
        entries[activePosition].index !== currentIndexRef.current
      ) {
        currentIndexRef.current = entries[activePosition].index;
        onCurrentIndexChange(entries[activePosition].index);
      }
    });
  };

  return (
    <div className="euphony-feed">
      <div
        ref={viewportRef}
        className="euphony-feed-viewport"
        aria-label="Euphony entries feed"
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div
          className="euphony-feed-spacer"
          style={{ height: topSpacerHeight }}
        />
        {visibleEntries.map((entry, offset) => {
          const position = windowStart + offset;
          return (
            <EuphonyFeedItem
              key={entry.index}
              entry={entry}
              collapseScope={collapseScope}
              measurementIndex={position}
              totalEntries={totalEntries}
              isActive={entry.index === currentIndex}
              onHeightChange={handleEntryHeightChange}
              onSelectEntry={onSelectEntry}
            />
          );
        })}
        <div
          className="euphony-feed-spacer"
          style={{ height: bottomSpacerHeight }}
        />
      </div>
    </div>
  );
}

function EuphonyFeedItem({
  entry,
  collapseScope,
  measurementIndex,
  totalEntries,
  isActive,
  onHeightChange,
  onSelectEntry,
}: {
  entry: EuphonyEntry;
  collapseScope: string | null;
  measurementIndex: number;
  totalEntries: number;
  isActive: boolean;
  onHeightChange: (index: number, height: number) => void;
  onSelectEntry: (index: number) => void;
}) {
  const itemRef = useRef<HTMLElement | null>(null);
  const conversationView = useMemo(
    () => createConversationView(entry, totalEntries),
    [entry, totalEntries],
  );
  const entryLabel = formatEuphonyEntryRecordLabel(entry);
  const collapseStoragePrefix = useMemo(
    () => euphonyInlineCollapseStoragePrefix(collapseScope, entry),
    [collapseScope, entry],
  );

  useEffect(() => {
    const item = itemRef.current;
    if (!item) {
      return;
    }

    const reportHeight = () => {
      onHeightChange(measurementIndex, item.offsetHeight);
    };
    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", reportHeight);
      return () => {
        window.removeEventListener("resize", reportHeight);
      };
    }

    const observer = new ResizeObserver(reportHeight);
    observer.observe(item);
    return () => {
      observer.disconnect();
    };
  }, [measurementIndex, onHeightChange]);

  if (!conversationView) {
    return null;
  }

  return (
    <article
      ref={itemRef}
      className={`euphony-feed-entry ${isActive ? "is-active" : ""}`}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="euphony-feed-entry-bar">
        <span className="euphony-feed-entry-main">
          <button
            type="button"
            className="feed-focus-button"
            onClick={() => onSelectEntry(entry.index)}
          >
            {entryLabel}
          </button>
        </span>
        <span className="euphony-feed-entry-meta">
          {entry.recordIndex !== null
            ? `Record ${entry.recordIndex + 1}`
            : "Conversation"}
        </span>
      </div>
      <EuphonyConversation
        conversation={conversationView.conversation}
        inlineCollapseLabel={conversationView.inlineCollapseLabel}
        inlineCollapseStoragePrefix={collapseStoragePrefix}
        variant="feed"
      />
    </article>
  );
}

function EuphonyConversation({
  conversation,
  inlineCollapseLabel = null,
  inlineCollapseStoragePrefix = null,
  variant = "standalone",
}: {
  conversation: Conversation;
  inlineCollapseLabel?: string | null;
  inlineCollapseStoragePrefix?: string | null;
  variant?: "standalone" | "feed";
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    ensureOpenAiEuphony()
      .then(() => {
        if (!cancelled) {
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }

    let cancelled = false;
    let cleanupInlineCollapse: (() => void) | null = null;
    const scrollHost = scrollRef.current;
    const host = hostRef.current;
    if (!host) {
      return;
    }

    if (scrollHost) {
      scrollHost.scrollTop = 0;
      scrollHost.scrollLeft = 0;
    }

    host.replaceChildren();
    const element = document.createElement(
      "euphony-conversation",
    ) as EuphonyConversationElement;

    element.conversationData = conversation;
    element.conversationString = JSON.stringify(conversation);
    element.setAttribute("conversation-string", JSON.stringify(conversation));
    element.setAttribute("theme", "light");
    element.setAttribute("should-render-markdown", "true");
    element.setAttribute("disable-token-window", "true");
    element.setAttribute("conversation-label", "JSONL");
    host.appendChild(element);

    if (inlineCollapseStoragePrefix) {
      void installEuphonyInlineCollapsePersistence(element, {
        blockLabel: inlineCollapseLabel,
        storagePrefix: inlineCollapseStoragePrefix,
      }).then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }

        cleanupInlineCollapse = cleanup;
      });
    }

    return () => {
      cancelled = true;
      cleanupInlineCollapse?.();
    };
  }, [conversation, inlineCollapseLabel, inlineCollapseStoragePrefix, loadState]);

  return (
    <div
      ref={scrollRef}
      className={`euphony-host ${variant === "feed" ? "is-feed-item" : ""}`}
    >
      {loadState === "loading" ? (
        <EuphonyLoadingSkeleton />
      ) : null}
      {loadState === "error" ? (
        <div className="euphony-loader error">
          OpenAI Euphony could not be loaded.
        </div>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}

async function installEuphonyInlineCollapsePersistence(
  element: EuphonyConversationElement,
  {
    blockLabel,
    storagePrefix,
  }: { blockLabel: string | null; storagePrefix: string },
) {
  let stopped = false;
  const controller = new AbortController();
  const timeoutIds: number[] = [];
  const frameIds: number[] = [];
  const wiredHosts = new WeakSet<EventTarget>();

  const cleanup = () => {
    stopped = true;
    controller.abort();
    timeoutIds.forEach((id) => window.clearTimeout(id));
    frameIds.forEach((id) => window.cancelAnimationFrame(id));
  };

  await waitForEuphonyRender(element);
  if (stopped) {
    return cleanup;
  }

  const sync = () => {
    if (stopped) {
      return;
    }

    const blockHosts = collectEuphonyInlineBlockHosts(element);
    const hostStates = blockHosts.map((host, componentIndex) => {
      const blocks = collectEuphonyInlineBlocks(host);
      return {
        blocks: blocks.map((block) => ({
          block,
          collapsed:
            readStoredBooleanValue(
              euphonyInlineCollapseStorageKey(
                storagePrefix,
                componentIndex,
                block.path,
              ),
            ) === true,
        })),
        componentIndex,
        host,
      };
    });

    const allBlocks = hostStates.flatMap((state) => state.blocks);
    if (allBlocks.length > 0) {
      if (allBlocks.every(({ collapsed }) => collapsed)) {
        element.collapseBlockContents?.();
      } else {
        element.expandBlockContents?.();
      }
    }

    const applyDomState = () => {
      if (stopped) {
        return;
      }

      hostStates.forEach(({ componentIndex, host }) => {
        const blocks = collectEuphonyInlineBlocks(host);
        blocks.forEach((block) => {
          if (blockLabel && blocks.length === 1 && block.labelTextElement) {
            block.labelTextElement.textContent = blockLabel;
          }

          const collapsed =
            readStoredBooleanValue(
              euphonyInlineCollapseStorageKey(
                storagePrefix,
                componentIndex,
                block.path,
              ),
            ) === true;
          setEuphonyInlineBlockCollapsed(block, collapsed);

          wireEuphonyInlineCollapseRoot(host, {
            componentIndex,
            controller,
            storagePrefix,
            stopped: () => stopped,
            wiredHosts,
          });
        });
      });
    };

    applyDomState();
    frameIds.push(window.requestAnimationFrame(applyDomState));
  };

  sync();
  for (const delay of [120, 500, 1200]) {
    timeoutIds.push(window.setTimeout(sync, delay));
  }

  return cleanup;
}

async function waitForEuphonyRender(element: EuphonyConversationElement) {
  await Promise.resolve(element.updateComplete);
  await Promise.resolve(element.allChildrenUpdateComplete?.());
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function collectEuphonyInlineBlockHosts(element: Element) {
  const blockHosts: HTMLElement[] = [];

  const visitElement = (currentElement: Element) => {
    const shadowRoot = (currentElement as HTMLElement).shadowRoot;
    if (!shadowRoot) {
      return;
    }

    if (shadowRoot.querySelector(".content-block button.collapse-icon")) {
      blockHosts.push(currentElement as HTMLElement);
    }

    for (const child of Array.from(shadowRoot.querySelectorAll("*"))) {
      visitElement(child);
    }
  };

  visitElement(element);
  return blockHosts;
}

function collectEuphonyInlineBlocks(host: HTMLElement) {
  const contentBlocks = Array.from(
    host.shadowRoot?.querySelectorAll(".content-block") ?? [],
  );

  return contentBlocks.flatMap((contentBlock, index) => {
    const label = getDirectClassChild(contentBlock, "label");
    const button = label?.querySelector<HTMLElement>("button.collapse-icon");
    const container = getDirectClassChild(
      contentBlock,
      "message-text-container",
    );
    const labelTextElement = label?.querySelector<HTMLElement>("span") ?? null;

    if (!button || !container) {
      return [];
    }

    return [
      {
        button,
        container,
        labelTextElement,
        path: String(index),
      },
    ];
  });
}

function getDirectClassChild(parent: Element, className: string) {
  return (
    Array.from(parent.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains(className),
    ) ?? null
  );
}

function setEuphonyInlineBlockCollapsed(
  block: EuphonyInlineCollapseBlock,
  collapsed: boolean,
) {
  block.button.toggleAttribute("is-collapsed", collapsed);
  block.container.toggleAttribute("is-hidden", collapsed);
}

function isEuphonyInlineBlockCollapsed(block: EuphonyInlineCollapseBlock) {
  return (
    block.button.hasAttribute("is-collapsed") ||
    block.container.hasAttribute("is-hidden")
  );
}

function wireEuphonyInlineCollapseRoot(
  host: HTMLElement,
  {
    componentIndex,
    controller,
    storagePrefix,
    stopped,
    wiredHosts,
  }: {
    componentIndex: number;
    controller: AbortController;
    storagePrefix: string;
    stopped: () => boolean;
    wiredHosts: WeakSet<EventTarget>;
  },
) {
  if (wiredHosts.has(host)) {
    return;
  }

  wiredHosts.add(host);
  host.addEventListener(
    "click",
    (event) => {
      const clickedButton = event
        .composedPath()
        .find(
          (target): target is HTMLElement =>
            target instanceof HTMLElement &&
            target.matches("button.collapse-icon"),
        );
      if (!clickedButton) {
        return;
      }

      const clickedBlock = collectEuphonyInlineBlocks(host).find(
        (block) =>
          block.button === clickedButton || block.button.contains(clickedButton),
      );
      if (!clickedBlock) {
        return;
      }

      const nextCollapsed = !isEuphonyInlineBlockCollapsed(clickedBlock);
      window.setTimeout(() => {
        if (!stopped()) {
          persistEuphonyInlineBlockStates(host, {
            componentIndex,
            fallbackToggle: {
              nextCollapsed,
              path: clickedBlock.path,
            },
            storagePrefix,
          });
        }
      }, 50);
    },
    { capture: true, signal: controller.signal },
  );
}

function persistEuphonyInlineBlockStates(
  host: HTMLElement,
  {
    componentIndex,
    fallbackToggle,
    storagePrefix,
  }: {
    componentIndex: number;
    fallbackToggle?: {
      nextCollapsed: boolean;
      path: string;
    };
    storagePrefix: string;
  },
) {
  for (const block of collectEuphonyInlineBlocks(host)) {
    if (
      fallbackToggle &&
      block.path === fallbackToggle.path &&
      isEuphonyInlineBlockCollapsed(block) !== fallbackToggle.nextCollapsed
    ) {
      setEuphonyInlineBlockCollapsed(block, fallbackToggle.nextCollapsed);
    }

    writeStoredBoolean(
      euphonyInlineCollapseStorageKey(
        storagePrefix,
        componentIndex,
        block.path,
      ),
      isEuphonyInlineBlockCollapsed(block),
    );
  }
}

function EuphonyLoadingSkeleton() {
  return (
    <div
      className="euphony-loader"
      role="status"
      aria-live="polite"
      aria-label="Loading Euphony"
    >
      <div className="euphony-skeleton" aria-hidden="true">
        <div className="euphony-skeleton-topline">
          <span />
          <span />
        </div>
        <div className="euphony-skeleton-message is-assistant">
          <span />
          <span />
          <span />
        </div>
        <div className="euphony-skeleton-message is-user">
          <span />
          <span />
        </div>
        <div className="euphony-skeleton-message is-assistant is-short">
          <span />
          <span />
        </div>
      </div>
      <span className="euphony-loading-text">Loading Euphony</span>
    </div>
  );
}

function createInputPreview(input: string) {
  if (input.length <= MAX_TEXTAREA_CHARS) {
    return {
      text: input,
      truncated: false,
    };
  }

  return {
    text: `${input.slice(0, MAX_TEXTAREA_CHARS)}\n\n... truncated ${formatBytes(
      input.length - MAX_TEXTAREA_CHARS,
    )} from input preview ...`,
    truncated: true,
  };
}

function createEuphonyEntrySearchText(entry: EuphonyEntry) {
  return normalizeSearchText([
    "euphony",
    `entry ${entry.index + 1}`,
    formatEuphonyEntryRecordLabel(entry),
    entry.recordIndex !== null ? `record ${entry.recordIndex + 1}` : null,
    entry.recordLine !== null ? `l${entry.recordLine}` : null,
    entry.message.role,
    entry.message.name,
    entry.message.channel,
    entry.message.recipient,
    limitSearchText(messageContentToText(entry.message.content)),
    collectBoundedSearchText(entry.message.metadata),
    collectBoundedSearchText(entry.payload),
  ]);
}

function normalizeSearchText(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function limitSearchText(value: string) {
  return value.length > SEARCH_TEXT_CHAR_LIMIT
    ? value.slice(0, SEARCH_TEXT_CHAR_LIMIT)
    : value;
}

function collectBoundedSearchText(value: unknown) {
  const parts: string[] = [];
  const seen = new Set<object>();
  let length = 0;

  const push = (part: string) => {
    if (!part || length >= SEARCH_TEXT_CHAR_LIMIT) {
      return;
    }

    const remaining = SEARCH_TEXT_CHAR_LIMIT - length;
    const normalizedPart =
      part.length > remaining ? part.slice(0, remaining) : part;
    parts.push(normalizedPart);
    length += normalizedPart.length;
  };

  const visit = (item: unknown, depth: number) => {
    if (length >= SEARCH_TEXT_CHAR_LIMIT || depth > 4) {
      return;
    }

    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      push(String(item));
      return;
    }

    if (!item || typeof item !== "object") {
      return;
    }

    if (seen.has(item)) {
      return;
    }
    seen.add(item);

    if (Array.isArray(item)) {
      for (const child of item.slice(0, 24)) {
        visit(child, depth + 1);
        if (length >= SEARCH_TEXT_CHAR_LIMIT) {
          return;
        }
      }
      return;
    }

    for (const [key, child] of Object.entries(item).slice(0, 40)) {
      push(key);
      visit(child, depth + 1);
      if (length >= SEARCH_TEXT_CHAR_LIMIT) {
        return;
      }
    }
  };

  visit(value, 0);
  return parts.join("\n");
}

function createEuphonyEntries(
  records: JsonRecord[],
  conversation: Conversation | null,
) {
  const codexEntries = createCodexSessionEntryDrafts(
    records.map((record) => record.value),
    records,
  );
  if (codexEntries.length > 0) {
    return codexEntries.map((entry, index): EuphonyEntry => ({
      ...entry,
      index,
    }));
  }

  const entries = records.flatMap((record) => {
    const recordConversation = normalizeConversation(record.value);
    if (!recordConversation) {
      return [];
    }

    return recordConversation.messages.map((message, messageIndex) => ({
      message,
      payload: getEuphonyEntryPayload(record.value, messageIndex, message),
      recordId: record.id,
      recordIndex: record.index,
      recordLine: record.line,
    }));
  });

  if (entries.length > 0) {
    return entries.map((entry, index): EuphonyEntry => ({ ...entry, index }));
  }

  if (!conversation) {
    return [];
  }

  return conversation.messages.map((message, index): EuphonyEntry => ({
    index,
    message,
    payload: message,
    recordId: null,
    recordIndex: null,
    recordLine: null,
  }));
}

function getEuphonyEntryPayload(
  payload: unknown,
  messageIndex: number,
  message: Message,
) {
  if (isJsonObject(payload) && Array.isArray(payload.messages)) {
    return payload.messages[messageIndex] ?? message;
  }

  return payload;
}

function createConversationView(
  entry: EuphonyEntry | null,
  totalMessages: number,
) {
  if (!entry) {
    return null;
  }

  const inlineMessage = createInlineCollapsibleMessage(entry);

  return {
    conversation: {
      id: `euphony-entry-${entry.index + 1}`,
      metadata: {
        record_index: entry.recordIndex,
        total_messages: totalMessages,
        view: "euphony-entry",
      },
      messages: [inlineMessage.message],
    },
    inlineCollapseLabel: inlineMessage.inlineCollapseLabel,
  };
}

function createInlineCollapsibleMessage(entry: EuphonyEntry): {
  message: Message;
  inlineCollapseLabel: string | null;
} {
  if (hasNativeEuphonyBlockContent(entry.message.content)) {
    return {
      message: entry.message,
      inlineCollapseLabel: null,
    };
  }

  return {
    message: {
      ...entry.message,
      content: [{ instructions: messageContentToMarkdown(entry.message.content) }],
      metadata: {
        ...(entry.message.metadata ?? {}),
        noisy_room_inline_collapse: true,
      },
    },
    inlineCollapseLabel: formatEuphonyEntryRecordLabel(entry),
  };
}

function hasNativeEuphonyBlockContent(content: Message["content"]) {
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  const [firstPart] = content;
  return "instructions" in firstPart || "model_identity" in firstPart;
}

function messageContentToMarkdown(content: Message["content"]) {
  if (typeof content === "string") {
    return content;
  }

  const parts = content.map((part) => messageContentPartToMarkdown(part));
  const text = parts.filter(Boolean).join("\n\n").trim();
  return text || JSON.stringify(content, null, 2);
}

function messageContentPartToMarkdown(part: Record<string, unknown>) {
  const contentType = getString(part.content_type) ?? getString(part.type);
  const text =
    getString(part.text) ??
    getString(part.content) ??
    getString(part.instructions);

  if (contentType === "code" || getString(part.language)) {
    return createMarkdownCodeFence(text ?? JSON.stringify(part, null, 2), {
      language: getString(part.language) ?? "",
    });
  }

  if (text) {
    return text;
  }

  return createMarkdownCodeFence(JSON.stringify(part, null, 2), {
    language: "json",
  });
}

function createMarkdownCodeFence(
  code: string,
  { language }: { language: string },
) {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(code.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

function getVirtualWindowStart(
  anchorIndex: number,
  totalItems: number,
  windowSize: number,
) {
  if (totalItems <= windowSize) {
    return 0;
  }

  const centeredStart = anchorIndex - Math.floor(windowSize / 2);
  return clampNumber(
    centeredStart,
    0,
    Math.max(0, totalItems - windowSize),
  );
}

function estimateVirtualRangeHeight(
  start: number,
  end: number,
  measuredHeights: ReadonlyMap<number, number>,
  fallbackHeight: number,
) {
  let total = 0;
  for (let index = start; index < end; index += 1) {
    total += measuredHeights.get(index) ?? fallbackHeight;
  }

  return total;
}

function getVirtualIndexAtOffset(
  offset: number,
  totalItems: number,
  measuredHeights: ReadonlyMap<number, number>,
  fallbackHeight: number,
) {
  if (totalItems <= 0) {
    return 0;
  }

  let cursor = 0;
  for (let index = 0; index < totalItems; index += 1) {
    cursor += measuredHeights.get(index) ?? fallbackHeight;
    if (cursor >= offset) {
      return index;
    }
  }

  return totalItems - 1;
}

function getEuphonyFeedWindowStart(anchorIndex: number, totalEntries: number) {
  return getVirtualWindowStart(
    anchorIndex,
    totalEntries,
    EUPHONY_FEED_WINDOW_SIZE,
  );
}

function estimateEuphonyFeedRangeHeight(
  start: number,
  end: number,
  measuredHeights: ReadonlyMap<number, number>,
  fallbackHeight: number,
) {
  return estimateVirtualRangeHeight(start, end, measuredHeights, fallbackHeight);
}

function getEuphonyFeedIndexAtOffset(
  offset: number,
  totalEntries: number,
  measuredHeights: ReadonlyMap<number, number>,
  fallbackHeight: number,
) {
  return getVirtualIndexAtOffset(
    offset,
    totalEntries,
    measuredHeights,
    fallbackHeight,
  );
}

function parseInput(rawInput: string): ParsedState {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {
      status: "empty",
      sourceKind: null,
      records: [],
      conversation: null,
    };
  }

  const parsedJson = tryParseJson(trimmed);
  if (parsedJson.ok) {
    const values = Array.isArray(parsedJson.value)
      ? parsedJson.value
      : [parsedJson.value];

    return {
      status: "ready",
      sourceKind: "json",
      records: values.map((value, index) => createRecord(value, index, null)),
      conversation: normalizeConversation(parsedJson.value),
    };
  }

  const lines = rawInput.split(/\r?\n/);
  const values: Array<{ value: unknown; line: number }> = [];

  for (const [lineIndex, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }

    const parsedLine = tryParseJson(line);
    if (!parsedLine.ok) {
      return {
        status: "error",
        sourceKind: null,
        records: [],
        conversation: null,
        message: `Line ${lineIndex + 1}: ${parsedLine.message}`,
      };
    }

    values.push({ value: parsedLine.value, line: lineIndex + 1 });
  }

  return {
    status: "ready",
    sourceKind: "jsonl",
    records: values.map(({ value, line }, index) =>
      createRecord(value, index, line),
    ),
    conversation: normalizeConversation(values.map(({ value }) => value)),
  };
}

function tryParseJson(raw: string):
  | { ok: true; value: unknown }
  | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function createRecord(value: unknown, index: number, line: number | null): JsonRecord {
  const title = getRecordTitle(value, index);
  const subtitle = getRecordSubtitle(value);
  const preview = compactPreview(value);

  return {
    id: `${line ?? "json"}-${index}`,
    index,
    line,
    value,
    title,
    subtitle,
    preview,
  };
}

function normalizeConversation(value: unknown): Conversation | null {
  if (isCodexSessionEntry(value)) {
    return normalizeCodexSession([value]);
  }

  if (isMessageLike(value)) {
    return {
      id: getString(value.id) ?? "message",
      messages: [normalizeMessage(value)],
      metadata: { source: "message" },
    };
  }

  if (isJsonObject(value)) {
    const candidate =
      getObjectValue(value, "conversation") ??
      getObjectValue(value, "data") ??
      getObjectValue(value, "payload");

    if (hasMessages(value)) {
      return normalizeConversationObject(value);
    }

    if (candidate) {
      const nested = normalizeConversation(candidate);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(value)) {
    if (value.some(isCodexSessionEntry)) {
      return normalizeCodexSession(value);
    }

    if (value.every(isMessageLike)) {
      return {
        id: "jsonl-lines",
        messages: value.map(normalizeMessage),
        metadata: { source: "jsonl" },
      };
    }

    const firstConversation = value
      .map((item) => normalizeConversation(item))
      .find((conversation): conversation is Conversation => Boolean(conversation));

    if (firstConversation) {
      return firstConversation;
    }
  }

  return null;
}

function normalizeCodexSession(values: unknown[]): Conversation | null {
  const entries = createCodexSessionEntryDrafts(values);
  const messages = entries.map((entry) => entry.message);

  if (messages.length === 0) {
    return null;
  }

  const metadata = createCodexSessionMetadata(values, messages.length);
  const sessionId = getString(metadata.codex_session_id) ?? "codex-session";

  return {
    id: sessionId,
    create_time: getNumber(metadata.codex_first_timestamp),
    metadata,
    messages,
  };
}

type CodexSessionEvent = {
  raw: JsonObject;
  payload: JsonObject;
  eventType: string;
  payloadType: string | null;
  timestamp: number | null;
  recordId: string | null;
  recordIndex: number | null;
  recordLine: number | null;
  sourcePayload: unknown;
  arrayIndex: number;
};

function createCodexSessionEntryDrafts(
  values: unknown[],
  records?: JsonRecord[],
): EuphonyEntryDraft[] {
  const events = collectCodexSessionEvents(values, records);
  if (events.length === 0) {
    return [];
  }

  const sessionMetaEvent = events.find((event) => event.eventType === "session_meta");
  const turnContextEvent = events.find((event) => event.eventType === "turn_context");
  const sessionMetaPayload = sessionMetaEvent?.payload ?? {};
  const turnContextPayload = turnContextEvent?.payload ?? {};
  const sessionId = getString(sessionMetaPayload.id) ?? "codex-session";
  const baseInstructionsText = getBaseInstructionsText(
    sessionMetaPayload.base_instructions,
  );
  const drafts: EuphonyEntryDraft[] = [];

  if (sessionMetaEvent) {
    const summaryLines = createCodexSessionSummaryLines(
      sessionMetaPayload,
      turnContextPayload,
    );
    if (summaryLines.length > 1) {
      drafts.push({
        message: {
          id: `${sessionId}-summary`,
          role: "system",
          name: "codex",
          create_time: sessionMetaEvent.timestamp,
          content: [{ text: summaryLines.join("\n") }],
          metadata: createCodexMessageMetadata(sessionMetaEvent),
        },
        payload: sessionMetaEvent.sourcePayload,
        recordId: sessionMetaEvent.recordId,
        recordIndex: sessionMetaEvent.recordIndex,
        recordLine: sessionMetaEvent.recordLine,
      });
    }

    if (baseInstructionsText) {
      drafts.push({
        message: {
          id: `${sessionId}-base-instructions`,
          role: "developer",
          name: "base_instructions",
          create_time: sessionMetaEvent.timestamp,
          content: [{ instructions: baseInstructionsText }],
          metadata: {
            ...createCodexMessageMetadata(sessionMetaEvent),
            codex_source: "session_meta.base_instructions.text",
          },
        },
        payload: sessionMetaEvent.sourcePayload,
        recordId: sessionMetaEvent.recordId,
        recordIndex: sessionMetaEvent.recordIndex,
        recordLine: sessionMetaEvent.recordLine,
      });
    }
  }

  const hasResponseItemUserMessages = events.some(
    (event) =>
      event.eventType === "response_item" &&
      event.payloadType === "message" &&
      event.payload.role === "user",
  );
  const hasResponseItemAssistantMessages = events.some(
    (event) =>
      event.eventType === "response_item" &&
      event.payloadType === "message" &&
      event.payload.role === "assistant",
  );
  const hasResponseItemReasoning = events.some(
    (event) => event.eventType === "response_item" && event.payloadType === "reasoning",
  );
  const callIdToToolName = new Map<string, string>();

  for (const event of events) {
    if (event.eventType === "response_item") {
      const draft = createCodexResponseItemEntry(
        event,
        sessionId,
        callIdToToolName,
      );
      if (draft) {
        drafts.push(draft);
      }
      continue;
    }

    if (event.eventType === "event_msg") {
      const draft = createCodexEventMessageEntry(event, sessionId, {
        hasResponseItemAssistantMessages,
        hasResponseItemReasoning,
        hasResponseItemUserMessages,
      });
      if (draft) {
        drafts.push(draft);
      }
    }
  }

  return drafts;
}

function collectCodexSessionEvents(
  values: unknown[],
  records?: JsonRecord[],
): CodexSessionEvent[] {
  const events: CodexSessionEvent[] = [];

  for (const [index, value] of values.entries()) {
    const sourcePayload = records?.[index]?.value ?? value;
    if (!isJsonObject(sourcePayload) || !isCodexSessionEntry(sourcePayload)) {
      continue;
    }

    events.push({
      raw: sourcePayload,
      payload: isJsonObject(sourcePayload.payload) ? sourcePayload.payload : {},
      eventType: getString(sourcePayload.type) ?? "unknown",
      payloadType: isJsonObject(sourcePayload.payload)
        ? getString(sourcePayload.payload.type)
        : null,
      timestamp: normalizeTimestamp(sourcePayload.timestamp),
      recordId: records?.[index]?.id ?? null,
      recordIndex: records?.[index]?.index ?? null,
      recordLine: records?.[index]?.line ?? null,
      sourcePayload,
      arrayIndex: index,
    });
  }

  return events;
}

function createCodexResponseItemEntry(
  event: CodexSessionEvent,
  sessionId: string,
  callIdToToolName: Map<string, string>,
): EuphonyEntryDraft | null {
  const payload = event.payload;
  const payloadType =
    event.payloadType ?? (Array.isArray(payload.content) ? "message" : "unknown");
  const metadata = createCodexMessageMetadata(event);

  if (payloadType === "message") {
    const text = flattenCodexContent(payload.content) ?? "[empty message]";
    return createCodexTextEntry(event, {
      id: `${sessionId}-message-${event.arrayIndex}`,
      role: normalizeRole(getString(payload.role) ?? "assistant"),
      text,
      metadata,
    });
  }

  if (payloadType === "reasoning") {
    const summaryText = flattenCodexContent(payload.summary);
    if (!summaryText) {
      return null;
    }

    return createCodexTextEntry(event, {
      id: `${sessionId}-reasoning-${event.arrayIndex}`,
      role: "assistant",
      text: summaryText,
      metadata,
      channel: "analysis",
    });
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    const toolName = getString(payload.name) ?? "tool";
    const callId =
      getString(payload.call_id) ?? `${sessionId}-call-${event.arrayIndex}`;
    callIdToToolName.set(callId, toolName);

    const execCommand =
      toolName === "exec_command"
        ? getExecCommandFromArguments(payload.arguments)
        : null;
    const customInput = getString(payload.input);
    const code =
      execCommand ??
      customInput ??
      stringifyCodexArguments(payload.arguments ?? payload.input) ??
      JSON.stringify(payload, null, 2);

    return createCodexCodeEntry(event, {
      id: `${sessionId}-call-${callId}`,
      role: "tool",
      code,
      language: execCommand ? "bash" : customInput ? "text" : "json",
      metadata,
      name: toolName,
      recipient: toolName,
      channel: "call",
    });
  }

  if (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output"
  ) {
    const callId =
      getString(payload.call_id) ?? `${sessionId}-call-${event.arrayIndex}`;
    const toolName = getString(payload.name) ?? callIdToToolName.get(callId) ?? "tool";
    return createCodexCodeEntry(event, {
      id: `${sessionId}-output-${callId}`,
      role: "tool",
      code: formatCodexOutput(payload.output),
      language: "text",
      metadata,
      name: toolName,
      recipient: toolName,
      channel: "output",
    });
  }

  return createCodexCodeEntry(event, {
    id: `${sessionId}-response-${event.arrayIndex}`,
    role: "system",
    code: JSON.stringify(payload, null, 2),
    language: "json",
    metadata,
    name: "codex",
    channel: "response",
  });
}

function createCodexEventMessageEntry(
  event: CodexSessionEvent,
  sessionId: string,
  duplicateGuards: {
    hasResponseItemAssistantMessages: boolean;
    hasResponseItemReasoning: boolean;
    hasResponseItemUserMessages: boolean;
  },
): EuphonyEntryDraft | null {
  const payload = event.payload;
  const payloadType = event.payloadType ?? "unknown";
  const metadata = createCodexMessageMetadata(event);

  if (!duplicateGuards.hasResponseItemUserMessages && payloadType === "user_message") {
    return createCodexTextEntry(event, {
      id: `${sessionId}-user-${event.arrayIndex}`,
      role: "user",
      text: getString(payload.message) ?? "[empty message]",
      metadata,
    });
  }

  if (
    !duplicateGuards.hasResponseItemAssistantMessages &&
    payloadType === "agent_message"
  ) {
    return createCodexTextEntry(event, {
      id: `${sessionId}-assistant-${event.arrayIndex}`,
      role: "assistant",
      text: getString(payload.message) ?? getString(payload.text) ?? "[empty message]",
      metadata,
    });
  }

  if (!duplicateGuards.hasResponseItemReasoning && payloadType === "agent_reasoning") {
    return createCodexTextEntry(event, {
      id: `${sessionId}-reasoning-${event.arrayIndex}`,
      role: "assistant",
      text: getString(payload.text) ?? "[empty reasoning]",
      metadata,
      channel: "analysis",
    });
  }

  if (payloadType === "tool_result") {
    const callId = getString(payload.call_id) ?? getString(payload.id);
    return createCodexCodeEntry(event, {
      id: `${sessionId}-tool-result-${callId ?? event.arrayIndex}`,
      role: "tool",
      code: toolOutputText(callId, formatCodexOutput(payload.output ?? payload.result)),
      language: "text",
      metadata,
      name: getString(payload.name) ?? "tool",
      recipient: getString(payload.name) ?? "tool",
      channel: "output",
    });
  }

  if (payloadType === "context_compacted") {
    return createCodexTextEntry(event, {
      id: `${sessionId}-compacted-${event.arrayIndex}`,
      role: "system",
      text: "Context compacted",
      metadata,
      name: "codex",
    });
  }

  return null;
}

function createCodexTextEntry(
  event: CodexSessionEvent,
  options: {
    id: string;
    role: string;
    text: string;
    metadata: JsonObject;
    name?: string;
    recipient?: string;
    channel?: string;
  },
): EuphonyEntryDraft {
  return {
    message: {
      id: options.id,
      role: options.role,
      name: options.name,
      recipient: options.recipient,
      channel: options.channel,
      create_time: event.timestamp,
      content: [{ text: options.text }],
      metadata: options.metadata,
    },
    payload: event.sourcePayload,
    recordId: event.recordId,
    recordIndex: event.recordIndex,
    recordLine: event.recordLine,
  };
}

function createCodexCodeEntry(
  event: CodexSessionEvent,
  options: {
    id: string;
    role: string;
    code: string;
    language: string;
    metadata: JsonObject;
    name?: string;
    recipient?: string;
    channel?: string;
  },
): EuphonyEntryDraft {
  return {
    message: {
      id: options.id,
      role: options.role,
      name: options.name,
      recipient: options.recipient,
      channel: options.channel,
      create_time: event.timestamp,
      content: [
        {
          content_type: "code",
          text: options.code,
          language: options.language,
        },
      ],
      metadata: options.metadata,
    },
    payload: event.sourcePayload,
    recordId: event.recordId,
    recordIndex: event.recordIndex,
    recordLine: event.recordLine,
  };
}

function createCodexMessageMetadata(event: CodexSessionEvent): JsonObject {
  return {
    codex_event_type: event.eventType,
    codex_payload_type: event.payloadType,
    codex_event: sanitizeCodexEvent(event.raw),
    codex_function_name: getString(event.payload.name),
  };
}

function createCodexSessionMetadata(
  values: unknown[],
  messageCount: number,
): JsonObject {
  const events = collectCodexSessionEvents(values);
  const sessionMetaPayload =
    events.find((event) => event.eventType === "session_meta")?.payload ?? {};
  const turnContextPayload =
    events.find((event) => event.eventType === "turn_context")?.payload ?? {};
  const firstTimestamp = events
    .map((event) => event.timestamp)
    .find((timestamp): timestamp is number => timestamp !== null);

  return {
    source: "codex-session",
    codex_session_id: getString(sessionMetaPayload.id) ?? "codex-session",
    codex_first_timestamp: firstTimestamp,
    codex_session_meta: sessionMetaPayload,
    codex_turn_context: turnContextPayload,
    codex_event_counts: {
      events: events.length,
      messages: messageCount,
    },
  };
}

function createCodexSessionSummaryLines(
  sessionMetaPayload: JsonObject,
  turnContextPayload: JsonObject,
) {
  const summaryLines = ["Codex session"];
  const sessionId = getDisplayString(sessionMetaPayload.id);
  const sessionTimestamp = getDisplayString(sessionMetaPayload.timestamp);
  const cwd = getDisplayString(sessionMetaPayload.cwd);
  const originator = getDisplayString(sessionMetaPayload.originator);
  const cliVersion = getDisplayString(sessionMetaPayload.cli_version);
  const modelName = getDisplayString(turnContextPayload.model);

  if (sessionId) {
    summaryLines.push(`id: ${sessionId}`);
  }
  if (sessionTimestamp) {
    summaryLines.push(`started: ${sessionTimestamp}`);
  }
  if (cwd) {
    summaryLines.push(`cwd: ${cwd}`);
  }
  if (originator) {
    summaryLines.push(`originator: ${originator}`);
  }
  if (cliVersion) {
    summaryLines.push(`cli_version: ${cliVersion}`);
  }
  if (modelName) {
    summaryLines.push(`model: ${modelName}`);
  }
  if (isJsonObject(sessionMetaPayload.git)) {
    const branch = getDisplayString(sessionMetaPayload.git.branch) ?? "unknown";
    const commitHash =
      getDisplayString(sessionMetaPayload.git.commit_hash) ?? "unknown";
    if (branch !== "unknown" || commitHash !== "unknown") {
      summaryLines.push(`git: ${branch}@${commitHash}`);
    }
  }

  return summaryLines;
}

function getBaseInstructionsText(value: unknown) {
  if (isJsonObject(value) && "text" in value) {
    return extractCodexText(value.text).trim();
  }

  return extractCodexText(value).trim();
}

function extractCodexText(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractCodexText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (isJsonObject(value)) {
    for (const key of ["text", "content", "value", "message", "instructions"]) {
      if (key in value) {
        return extractCodexText(value[key]);
      }
    }
  }

  return "";
}

function getDisplayString(value: unknown) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return null;
}

function getExecCommandFromArguments(value: unknown): string | null {
  if (isJsonObject(value) && typeof value.cmd === "string") {
    return value.cmd;
  }
  if (typeof value !== "string") {
    return null;
  }

  const parsed = tryParseJson(value);
  if (!parsed.ok) {
    return value;
  }

  if (isJsonObject(parsed.value) && typeof parsed.value.cmd === "string") {
    return parsed.value.cmd;
  }

  return null;
}

function formatCodexOutput(value: unknown) {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    return parsed.ok ? JSON.stringify(parsed.value, null, 2) : value;
  }

  if (value === null || value === undefined) {
    return "[empty output]";
  }

  return JSON.stringify(value, null, 2);
}

function sanitizeCodexEvent(event: JsonObject): JsonObject {
  try {
    const clone = JSON.parse(JSON.stringify(event)) as JsonObject;
    if (isJsonObject(clone.payload) && "encrypted_content" in clone.payload) {
      clone.payload.encrypted_content = "[omitted]";
    }
    return clone;
  } catch {
    return event;
  }
}

function flattenCodexContent(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!isJsonObject(part)) {
        return "";
      }

      const type = getString(part.type);
      if (!type || type === "text" || type === "input_text" || type === "output_text") {
        return getString(part.text) ?? "";
      }

      if (type === "tool_use") {
        const toolName = getString(part.name) ?? "unknown";
        const input = isJsonObject(part.input) ? part.input : null;
        const detail =
          getString(input?.description) ??
          getString(input?.file_path) ??
          getString(input?.path) ??
          getString(input?.command);

        return detail ? `[Tool: ${toolName} - ${detail}]` : `[Tool: ${toolName}]`;
      }

      return "";
    })
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n") : null;
}

function stringifyCodexArguments(value: unknown) {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (parsed.ok) {
      return JSON.stringify(parsed.value, null, 2);
    }

    return value.trim();
  }

  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value, null, 2);
}

function toolOutputText(callId: string | null, output: string) {
  const label = callId ? `[Tool output: ${callId}]` : "[Tool output]";
  const trimmed = output.trim();
  return trimmed ? `${label}\n${trimmed}` : label;
}

function normalizeRole(role: string) {
  return role === "agent" ? "assistant" : role;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 1000);
}

function normalizeConversationObject(value: JsonObject): Conversation {
  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isMessageLike).map(normalizeMessage)
    : [];

  return {
    id: getString(value.id),
    create_time: getNumber(value.create_time),
    metadata: isJsonObject(value.metadata) ? value.metadata : undefined,
    messages,
  };
}

function normalizeMessage(value: unknown): Message {
  if (!isJsonObject(value)) {
    return {
      role: "user",
      content: [{ text: String(value) }],
    };
  }

  return {
    id: getString(value.id),
    role: getString(value.role) ?? "user",
    name: getString(value.name),
    channel: getString(value.channel),
    recipient: getString(value.recipient),
    create_time: getNumber(value.create_time),
    metadata: isJsonObject(value.metadata) ? value.metadata : undefined,
    content: normalizeContent(value.content ?? value.text),
  };
}

function normalizeContent(value: unknown): Message["content"] {
  if (typeof value === "string") {
    return [{ text: value }];
  }

  if (Array.isArray(value) && value.length > 0) {
    return value.map((part) => {
      if (typeof part === "string") {
        return { text: part };
      }

      if (isJsonObject(part)) {
        return part;
      }

      return { text: String(part) };
    });
  }

  if (isJsonObject(value)) {
    return [value];
  }

  return [{ text: "" }];
}

function hasMessages(value: JsonObject) {
  return Array.isArray(value.messages) && value.messages.some(isMessageLike);
}

function isMessageLike(value: unknown): value is JsonObject {
  return (
    isJsonObject(value) &&
    typeof value.role === "string" &&
    ("content" in value || "text" in value)
  );
}

function isCodexSessionEntry(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }

  const entryType = getString(value.type);
  if (!entryType) {
    return false;
  }

  if (!CODEX_TOP_LEVEL_TYPES.has(entryType)) {
    return entryType.startsWith("response_") || entryType.startsWith("event_");
  }

  if (entryType === "response_item" && isJsonObject(value.payload)) {
    const payloadType = getString(value.payload.type);
    return payloadType ? CODEX_RESPONSE_ITEM_TYPES.has(payloadType) : true;
  }

  if (entryType === "event_msg" && isJsonObject(value.payload)) {
    const payloadType = getString(value.payload.type);
    return payloadType ? CODEX_EVENT_MSG_TYPES.has(payloadType) : true;
  }

  return true;
}

function getRecordTitle(value: unknown, index: number) {
  if (!isJsonObject(value)) {
    return `Record ${index + 1}`;
  }

  const role = getString(value.role);
  const id = getString(value.id);
  const type = getString(value.type);

  if (role && id) {
    return `${role} / ${id}`;
  }

  return role ?? type ?? id ?? `Record ${index + 1}`;
}

function getRecordSubtitle(value: unknown) {
  if (!isJsonObject(value)) {
    return typeof value;
  }

  const keys = Object.keys(value);
  if (Array.isArray(value.messages)) {
    return `${value.messages.length} messages`;
  }

  return keys.slice(0, 4).join(", ") || "object";
}

function compactPreview(value: unknown) {
  const text = compactCodexPreview(value) ?? JSON.stringify(value);
  if (!text) {
    return "";
  }

  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function stringifyRecordPreview(value: unknown) {
  return JSON.stringify(
    value,
    (_key, nestedValue: unknown) => {
      if (typeof nestedValue === "string" && nestedValue.length > 20_000) {
        return `${nestedValue.slice(0, 20_000)}\n... truncated ${formatBytes(
          nestedValue.length - 20_000,
        )} from string field ...`;
      }

      return nestedValue;
    },
    2,
  );
}

function compactCodexPreview(value: unknown) {
  if (!isCodexSessionEntry(value)) {
    return null;
  }

  const entryType = getString(value.type);
  const payload = isJsonObject(value.payload) ? value.payload : {};
  const payloadType = getString(payload.type);

  if (entryType === "session_meta") {
    return createCodexSessionSummaryLines(payload, {}).join("\n");
  }

  if (entryType === "turn_context") {
    const model = getDisplayString(payload.model);
    return model ? `model: ${model}` : "Turn context";
  }

  if (entryType === "response_item" && (!payloadType || payloadType === "message")) {
    return flattenCodexContent(payload.content);
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    return `[Tool: ${getString(payload.name) ?? "unknown"}]`;
  }

  if (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output"
  ) {
    return toolOutputPreview(
      getString(payload.call_id),
      formatCodexOutput(payload.output),
    );
  }

  if (entryType === "event_msg" && payloadType === "agent_message") {
    return getString(payload.message) ?? getString(payload.text);
  }

  if (entryType === "event_msg" && payloadType === "user_message") {
    return getString(payload.message);
  }

  if (entryType === "event_msg" && payloadType === "agent_reasoning") {
    return getString(payload.text);
  }

  if (entryType === "event_msg" && payloadType === "tool_result") {
    return toolOutputPreview(
      getString(payload.call_id) ?? getString(payload.id),
      formatCodexOutput(payload.output ?? payload.result),
    );
  }

  return null;
}

function getObjectValue(value: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSessionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const month = padTwoDigits(date.getMonth() + 1);
  const day = padTwoDigits(date.getDate());
  const hour = padTwoDigits(date.getHours());
  const minute = padTwoDigits(date.getMinutes());
  return `${month}/${day} ${hour}:${minute}`;
}

function formatSearchTaskTime(task: Pick<GlobalSearchTask, "createdAt" | "completedAt">) {
  return formatSessionDate(task.completedAt ?? task.createdAt);
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortThreadId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatParentSessionBadge(
  parentSession: CodexSessionFile | null,
  fallbackThreadId: string,
) {
  const source = parentSession
    ? getSessionRelationBadgeSource(parentSession)
    : fallbackThreadId;
  return compactMiddle(source, 18, 8, 7);
}

function formatChildSessionBadge(childSession: CodexSessionFile) {
  const source = getSessionRelationBadgeSource(childSession);
  return compactMiddle(source, 18, 8, 7);
}

function getSessionRelationBadgeSource(file: CodexSessionFile) {
  return getSessionFileStem(file)
    .replace(/^rollout-/, "")
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function getSessionFileName(file: CodexSessionFile) {
  return file.relativePath.split(/[\\/]/).pop() ?? file.relativePath;
}

function getSessionFileStem(file: CodexSessionFile) {
  return getSessionFileName(file).replace(/\.(jsonl|json)$/i, "");
}

function compactMiddle(
  value: string,
  maxLength: number,
  prefixLength: number,
  suffixLength: number,
) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, prefixLength)}...${value.slice(-suffixLength)}`;
}

function toolOutputPreview(callId: string | null, output: string) {
  const label = callId ? `[Tool output: ${callId}]` : "[Tool output]";
  const trimmed = output.trim();
  return trimmed ? `${label}\n${trimmed.slice(0, 180)}` : label;
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function createEuphonyEntryCopyText(entry: EuphonyEntry) {
  return formatMessageCopyText(entry.message, entry.index);
}

function formatEuphonyEntryRecordLabel(entry: EuphonyEntry) {
  if (entry.recordLine !== null) {
    return `L${entry.recordLine}`;
  }

  if (entry.recordIndex !== null) {
    return `#${entry.recordIndex + 1}`;
  }

  return `#${entry.index + 1}`;
}

function formatMessageCopyText(message: Message, index: number) {
  const labelParts = [
    `#${index + 1}`,
    message.role,
    message.name,
    message.channel,
    message.recipient,
  ].filter(Boolean);
  const timestamp = message.create_time
    ? ` @ ${new Date(message.create_time * 1000).toISOString()}`
    : "";
  const content = messageContentToText(message.content).trim();

  return `${labelParts.join(" / ")}${timestamp}\n${content || "[empty]"}`;
}

function messageContentToText(content: Message["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content.map(contentPartToText).join("\n");
}

function contentPartToText(part: string | Record<string, unknown>) {
  if (typeof part === "string") {
    return part;
  }

  const text =
    getString(part.text) ??
    getString(part.input_text) ??
    getString(part.output_text) ??
    getString(part.instructions);
  if (text) {
    return text;
  }

  return JSON.stringify(part, null, 2);
}

function readCachedInput(): CachedInputState {
  try {
    const rawCache = window.localStorage.getItem(INPUT_CACHE_STORAGE_KEY);
    if (!rawCache) {
      return emptyCachedInput();
    }

    const parsed = JSON.parse(rawCache) as unknown;
    if (!isStoredInputCache(parsed)) {
      window.localStorage.removeItem(INPUT_CACHE_STORAGE_KEY);
      return emptyCachedInput();
    }

    const input = parsed.input ?? "";
    return {
      input,
      selectedSessionPath: input ? parsed.selectedSessionPath : null,
      restored: input.length > 0,
      skippedLargeContent:
        input.length === 0 && parsed.inputLength > INPUT_CACHE_MAX_CHARS,
    };
  } catch {
    return emptyCachedInput();
  }
}

function writeCachedInput(input: string, selectedSessionPath: string | null) {
  try {
    if (!input.trim()) {
      window.localStorage.removeItem(INPUT_CACHE_STORAGE_KEY);
      return;
    }

    const cache: StoredInputCache = {
      version: 1,
      inputLength: input.length,
      selectedSessionPath,
      updatedAt: Date.now(),
    };

    if (input.length <= INPUT_CACHE_MAX_CHARS) {
      cache.input = input;
    }

    try {
      window.localStorage.setItem(INPUT_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch {
      delete cache.input;
      window.localStorage.setItem(INPUT_CACHE_STORAGE_KEY, JSON.stringify(cache));
    }
  } catch {
    // Input cache is best-effort; parsing and viewing still work without it.
  }
}

function emptyCachedInput(): CachedInputState {
  return {
    input: "",
    selectedSessionPath: null,
    restored: false,
    skippedLargeContent: false,
  };
}

function isStoredInputCache(value: unknown): value is StoredInputCache {
  return (
    isJsonObject(value) &&
    value.version === 1 &&
    typeof value.inputLength === "number" &&
    value.inputLength >= 0 &&
    typeof value.updatedAt === "number" &&
    (value.input === undefined || typeof value.input === "string") &&
    (value.selectedSessionPath === null ||
      value.selectedSessionPath === undefined ||
      typeof value.selectedSessionPath === "string")
  );
}

function recordPageStorageKey(scope: string | null) {
  return `noisy-room.records.page:${scope ?? MANUAL_INPUT_STORAGE_SCOPE}`;
}

function recordIndexStorageKey(scope: string | null) {
  return `noisy-room.records.index:${scope ?? MANUAL_INPUT_STORAGE_SCOPE}`;
}

function sessionPageStorageKey() {
  return "noisy-room.sessions.page";
}

function euphonyEntryIndexStorageKey(scope: string | null) {
  return `noisy-room.euphony.index:${scope ?? MANUAL_INPUT_STORAGE_SCOPE}`;
}

function euphonyInlineCollapseStoragePrefix(
  scope: string | null,
  entry: EuphonyEntry,
) {
  const sourceId =
    entry.recordLine !== null
      ? `entry:${entry.index}:line:${entry.recordLine}`
      : entry.recordId
        ? `entry:${entry.index}:record:${entry.recordId}`
        : `entry:${entry.index}`;
  return `noisy-room.euphony.inline-collapsed:${
    scope ?? MANUAL_INPUT_STORAGE_SCOPE
  }:${sourceId}`;
}

function euphonyInlineCollapseStorageKey(
  storagePrefix: string,
  componentIndex: number,
  blockPath: string,
) {
  return `${storagePrefix}:component:${componentIndex}:block:${blockPath}`;
}

function readStoredNumber(key: string, fallback: number) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return fallback;
    }

    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? Math.floor(number)
      : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
  } catch {
    // Local storage is best-effort; the viewer still works without it.
  }
}

function readStoredBooleanValue(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) {
      return null;
    }

    return value === "1";
  } catch {
    return null;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  try {
    if (value) {
      window.localStorage.setItem(key, "1");
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Local storage is best-effort; the viewer still works without it.
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function wrapSearchIndex(value: number, count: number) {
  if (count <= 0) {
    return 0;
  }

  return ((value % count) + count) % count;
}

export default App;
